// Clip pipeline: the no-terminal caption-indexing path.
//
// The cloud-friendly alternative to scripts/fetch-captions.ts: instead of
// yt-dlp on a residential connection, each harvested video's Arabic caption
// track comes through the Supadata transcript API (which handles YouTube's
// anti-bot measures on its side; free tier ≈ 100 videos/month, then a few
// dollars per thousand). Lines are normalized and dialect-scored with the
// same shared modules the local script uses, so both paths fill the index
// identically and channel rollups agree.
//
// Bounded per invoke (default 8 videos, sequential). The response reports
// how many un-indexed videos remain, and the /admin/channels button says
// "click again". A video with no Arabic captions is marked
// caption_status='none' — the ASR-fallback pool.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import { normalizeArabic } from "../_shared/msaLeakDetector.ts";
import {
  aggregateChannelScores,
  scoreLineForDialect,
  type MarkerDialect,
} from "../_shared/dialectMarkers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPADATA_URL = "https://api.supadata.ai/v1/youtube/transcript";

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isContentManager(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user?.id) return false;
  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "content_reviewer"]);
  return Array.isArray(roles) && roles.length > 0;
}

async function hasPipelineSecret(req: Request): Promise<boolean> {
  return await hasSharedSecret(req, "x-pipeline-secret", "CLIP_PIPELINE_SECRET");
}

interface TranscriptSegment {
  text?: string;
  offset?: number;
  duration?: number;
}

/**
 * Fetch the Arabic caption track for one video. Returns null when the video
 * has no (Arabic) captions; throws on auth/quota errors so a bad key stops
 * the run loudly instead of marking the whole corpus caption-less.
 */
async function fetchTranscript(
  apiKey: string,
  ytVideoId: string,
): Promise<Array<{ startMs: number; endMs: number; text: string }> | null> {
  const url = new URL(SUPADATA_URL);
  url.searchParams.set("url", `https://www.youtube.com/watch?v=${ytVideoId}`);
  url.searchParams.set("lang", "ar");
  // Existing caption tracks only — AI transcription is a deliberate,
  // costed choice that belongs to the ASR stage, not the index sweep.
  url.searchParams.set("mode", "native");
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new Error(`Supadata ${res.status}: ${await res.text()}`);
  }
  if (!res.ok) return null; // 404/206-style: no transcript available
  const data = await res.json().catch(() => null) as { content?: TranscriptSegment[] } | null;
  const segments = data?.content;
  if (!Array.isArray(segments) || segments.length === 0) return null;

  const lines: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (const seg of segments) {
    const text = (seg.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || /^[[(♪♫]/.test(text)) continue;
    const start = Math.round(seg.offset ?? 0);
    lines.push({
      startMs: start,
      endMs: start + Math.max(Math.round(seg.duration ?? 2000), 1),
      text,
    });
  }
  return lines.length > 0 ? lines : null;
}

interface VideoRow {
  id: string;
  yt_video_id: string;
  channel_id: string;
  content_channels: { id: string; name: string; dialect: string };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!(await hasPipelineSecret(req)) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }
    const apiKey = Deno.env.get("SUPADATA_API_KEY");
    if (!apiKey) {
      return json(
        {
          error:
            "SUPADATA_API_KEY is not configured. Create a free key at supadata.ai and add it " +
            "as an edge-function secret, or use scripts/fetch-captions.ts locally.",
        },
        500,
        corsHeaders,
      );
    }

    const body = await req.json().catch(() => ({}));
    const channelId = typeof body.channelId === "string" ? body.channelId : null;
    const limit = Math.max(1, Math.min(15, Number(body.limit) || 8));

    // Un-indexed videos of approved channels: 'unknown' was never fetched;
    // 'manual' is the harvester's hint that a track exists, indexed first.
    let query = admin()
      .from("channel_videos")
      .select("id, yt_video_id, channel_id, content_channels!inner(id, name, dialect, status)")
      .eq("content_channels.status", "approved")
      .in("caption_status", ["unknown", "manual"])
      .neq("availability", "unavailable")
      .order("published_at", { ascending: false })
      .limit(limit * 4);
    if (channelId) query = query.eq("channel_id", channelId);
    const { data, error } = await query;
    if (error) throw new Error(`channel_videos fetch failed: ${error.message}`);
    let videos = (data ?? []) as unknown as VideoRow[];

    // 'manual'-hinted rows may already be indexed from a previous partial
    // run; skip anything that has lines.
    if (videos.length > 0) {
      const { data: doneRows } = await admin()
        .from("caption_lines")
        .select("video_id")
        .in("video_id", videos.map((v) => v.id));
      const done = new Set(
        ((doneRows ?? []) as Array<{ video_id: string }>).map((r) => r.video_id),
      );
      // Self-heal: a re-harvest resets caption_status on rows that already
      // have lines; flip them to 'auto' so they leave the un-indexed pool
      // instead of inflating "remaining" forever.
      const alreadyIndexed = videos.filter((v) => done.has(v.id)).map((v) => v.id);
      if (alreadyIndexed.length > 0) {
        await admin()
          .from("channel_videos")
          .update({ caption_status: "auto" } as unknown as never)
          .in("id", alreadyIndexed);
      }
      videos = videos.filter((v) => !done.has(v.id)).slice(0, limit);
    }

    if (videos.length === 0) {
      return json(
        { indexed: 0, noCaptions: 0, remaining: 0, note: "nothing left to index — harvest more videos or approve more channels" },
        200,
        corsHeaders,
      );
    }

    let indexed = 0;
    let noCaptions = 0;
    const touchedChannels = new Map<string, { name: string; dialect: string }>();

    for (const video of videos) {
      const dialect = video.content_channels.dialect as MarkerDialect;
      const lines = await fetchTranscript(apiKey, video.yt_video_id);

      if (!lines) {
        noCaptions += 1;
        await admin()
          .from("channel_videos")
          .update({ caption_status: "none" } as unknown as never)
          .eq("id", video.id);
        continue;
      }

      const rows = lines.map((line) => {
        const scores = scoreLineForDialect(line.text, dialect);
        return {
          video_id: video.id,
          start_ms: line.startMs,
          end_ms: line.endMs,
          text: line.text,
          text_normalized: normalizeArabic(line.text),
          source: "auto",
          dialect_score: scores.dialectScore,
          msa_score: scores.msaScore,
        };
      });
      await admin().from("caption_lines").delete().eq("video_id", video.id);
      for (let i = 0; i < rows.length; i += 500) {
        const { error: insertErr } = await admin()
          .from("caption_lines")
          .insert(rows.slice(i, i + 500) as unknown as never);
        if (insertErr) throw new Error(`caption_lines insert failed: ${insertErr.message}`);
      }
      await admin()
        .from("channel_videos")
        .update({ caption_status: "auto" } as unknown as never)
        .eq("id", video.id);
      touchedChannels.set(video.channel_id, video.content_channels);
      indexed += 1;
    }

    // Channel-level rollup over everything indexed so far — the machine half
    // of channel vetting, and the score badges on /admin/channels.
    for (const [id, info] of touchedChannels) {
      const { data: lineRows } = await admin()
        .from("caption_lines")
        .select("text, channel_videos!inner(channel_id)")
        .eq("channel_videos.channel_id", id)
        .limit(5000);
      const texts = ((lineRows ?? []) as Array<{ text: string }>).map((l) => l.text);
      const agg = aggregateChannelScores(texts, info.dialect as MarkerDialect);
      await admin()
        .from("content_channels")
        .update({
          dialect_score: agg.dialectScore,
          msa_score: agg.msaScore,
          updated_at: new Date().toISOString(),
        } as unknown as never)
        .eq("id", id);
    }

    // What still waits, so the UI can say "click again".
    let remainingQuery = admin()
      .from("channel_videos")
      .select("id, content_channels!inner(status)", { count: "exact", head: true })
      .eq("content_channels.status", "approved")
      .in("caption_status", ["unknown", "manual"])
      .neq("availability", "unavailable");
    if (channelId) remainingQuery = remainingQuery.eq("channel_id", channelId);
    const { count: remaining } = await remainingQuery;

    return json(
      {
        indexed,
        noCaptions,
        remaining: remaining ?? 0,
        note: (remaining ?? 0) > 0 ? `${remaining} video(s) still un-indexed — run again.` : undefined,
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("[index-channel-captions] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
