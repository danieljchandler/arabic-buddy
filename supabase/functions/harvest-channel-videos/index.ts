// Clip pipeline: the no-terminal harvest path.
//
// The same enumeration scripts/harvest-channels.ts does locally, as an edge
// function behind a button on /admin/channels: resolve the channel's YouTube
// id from its handle where needed, page the uploads playlist (1 quota unit
// per 50 videos), and upsert channel_videos with duration, embeddability and
// a caption hint. The official Data API is cloud-friendly, so unlike caption
// scraping this stage loses nothing by running server-side.
//
// Bounded per invoke: a couple of channels per call, oldest-harvested first;
// the response reports how many approved channels still wait, and the UI
// says "click again". search.list is never called — it is quota-capped
// ~100/day; a channel with neither id nor handle is reported for a human to
// fill in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YT = "https://www.googleapis.com/youtube/v3";

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

function hasPipelineSecret(req: Request): boolean {
  const secret = Deno.env.get("CLIP_PIPELINE_SECRET");
  if (!secret) return false;
  return req.headers.get("x-pipeline-secret") === secret;
}

async function yt(apiKey: string, endpoint: string, params: Record<string, string>): Promise<{
  items?: Array<Record<string, unknown>>;
  nextPageToken?: string;
}> {
  const url = new URL(`${YT}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** PT#H#M#S → seconds. */
function parseDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

interface Channel {
  id: string;
  name: string;
  handle: string | null;
  yt_channel_id: string | null;
}

/** Loose title match: same letters, any case/spacing/punctuation. */
function titlesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

/**
 * Last-resort channel resolution for rows with neither an id nor a handle:
 * one search.list call (100 quota units) for the channel name, accepted only
 * when a result's title actually matches the name — a guess that lands on the
 * wrong channel is worse than no harvest. Non-matching candidates are
 * reported so an admin can fill the handle by hand.
 */
async function resolveChannelBySearch(
  apiKey: string,
  name: string,
): Promise<{ channelId: string; handle: string | null } | { candidates: string[] }> {
  const data = await yt(apiKey, "search", {
    part: "snippet",
    type: "channel",
    q: name,
    maxResults: "5",
  });
  const items = (data.items ?? []) as Array<{
    snippet?: { channelId?: string; channelTitle?: string; customUrl?: string };
  }>;
  const candidates = items
    .map((i) => i.snippet?.channelTitle ?? "")
    .filter(Boolean);
  for (const item of items) {
    const snippet = item.snippet ?? {};
    if (snippet.channelId && snippet.channelTitle && titlesMatch(snippet.channelTitle, name)) {
      const handle = snippet.customUrl?.startsWith("@") ? snippet.customUrl : null;
      return { channelId: snippet.channelId, handle };
    }
  }
  return { candidates };
}

async function harvestOne(
  apiKey: string,
  channel: Channel,
  maxVideos: number,
  minSeconds: number,
  maxSeconds: number,
): Promise<{ videos: number; enumerated: number } | { unresolved: true; candidates?: string[] }> {
  let channelId = channel.yt_channel_id;
  let resolvedHandle: string | null = null;
  if (!channelId && channel.handle) {
    const data = await yt(apiKey, "channels", {
      part: "id",
      forHandle: channel.handle.replace(/^@/, ""),
    });
    channelId = (data.items?.[0]?.id as string | undefined) ?? null;
  }
  if (!channelId) {
    const found = await resolveChannelBySearch(apiKey, channel.name);
    if ("candidates" in found) return { unresolved: true, candidates: found.candidates };
    channelId = found.channelId;
    resolvedHandle = found.handle;
  }
  if (!channelId) return { unresolved: true };
  if (!channel.yt_channel_id) {
    await admin()
      .from("content_channels")
      .update({
        yt_channel_id: channelId,
        // A handle recovered from search makes future re-resolution free.
        ...(resolvedHandle && !channel.handle ? { handle: resolvedHandle } : {}),
      } as unknown as never)
      .eq("id", channel.id);
  }

  const uploads = channelId.replace(/^UC/, "UU");
  const videoIds: string[] = [];
  const meta = new Map<string, { title: string; publishedAt: string | null }>();
  let pageToken: string | undefined;
  while (videoIds.length < maxVideos) {
    const data = await yt(apiKey, "playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploads,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of data.items ?? []) {
      const details = item.contentDetails as { videoId?: string; videoPublishedAt?: string };
      const snippet = item.snippet as { title?: string };
      if (!details?.videoId) continue;
      videoIds.push(details.videoId);
      meta.set(details.videoId, {
        title: snippet?.title ?? "",
        publishedAt: details.videoPublishedAt ?? null,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const data = await yt(apiKey, "videos", {
      part: "contentDetails,status",
      id: videoIds.slice(i, i + 50).join(","),
      maxResults: "50",
    });
    for (const item of data.items ?? []) {
      const id = item.id as string;
      const details = item.contentDetails as { duration?: string; caption?: string };
      const status = item.status as { embeddable?: boolean };
      const seconds = parseDuration(details?.duration);
      if (seconds === null || seconds < minSeconds || seconds > maxSeconds) continue;
      rows.push({
        channel_id: channel.id,
        yt_video_id: id,
        title: meta.get(id)?.title ?? "",
        published_at: meta.get(id)?.publishedAt,
        duration_seconds: seconds,
        embeddable: status?.embeddable ?? null,
        availability: "available",
        caption_status: details?.caption === "true" ? "manual" : "unknown",
        last_checked_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await admin()
      .from("channel_videos")
      .upsert(rows as unknown as never, { onConflict: "yt_video_id" });
    if (error) throw new Error(`channel_videos upsert failed: ${error.message}`);
  }
  await admin()
    .from("content_channels")
    .update({
      last_harvested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as never)
    .eq("id", channel.id);

  return { videos: rows.length, enumerated: videoIds.length };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!hasPipelineSecret(req) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }
    const apiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!apiKey) {
      return json({ error: "YOUTUBE_API_KEY is not configured" }, 500, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const channelId = typeof body.channelId === "string" ? body.channelId : null;
    const maxVideos = Math.max(10, Math.min(200, Number(body.maxVideos) || 100));
    const minSeconds = Math.max(10, Number(body.minSeconds) || 45);
    const maxSeconds = Math.min(3600, Number(body.maxSeconds) || 900);

    // Never-harvested first, then stalest; two channels per invoke keeps a
    // call comfortably inside the runtime budget.
    let query = admin()
      .from("content_channels")
      .select("id, name, handle, yt_channel_id, last_harvested_at")
      .eq("status", "approved")
      .order("last_harvested_at", { ascending: true, nullsFirst: true });
    if (channelId) query = query.eq("id", channelId);
    const { data, error } = await query;
    if (error) throw new Error(`content_channels fetch failed: ${error.message}`);
    const channels = (data ?? []) as Array<Channel & { last_harvested_at: string | null }>;
    if (channels.length === 0) {
      return json(
        { harvested: [], remaining: 0, note: "no approved channels — approve some first" },
        200,
        corsHeaders,
      );
    }

    const batch = channelId ? channels : channels.filter((c) => !c.last_harvested_at).slice(0, 2);
    const toProcess = batch.length > 0 ? batch : channels.slice(0, 2);

    const harvested: Array<Record<string, unknown>> = [];
    for (const channel of toProcess.slice(0, 2)) {
      const result = await harvestOne(apiKey, channel, maxVideos, minSeconds, maxSeconds);
      harvested.push(
        "unresolved" in result
          ? {
              channel: channel.name,
              unresolved: true,
              // What YouTube search suggested, so the admin can confirm the
              // right one instead of guessing at a handle.
              ...(result.candidates?.length ? { searchCandidates: result.candidates } : {}),
            }
          : { channel: channel.name, videos: result.videos, enumerated: result.enumerated },
      );
    }

    const remaining = channelId
      ? 0
      : channels.filter((c) => !c.last_harvested_at).length - toProcess.filter((c) => !c.last_harvested_at).length;
    const unresolvedNames = harvested.filter((h) => h.unresolved).map((h) => h.channel);

    return json(
      {
        harvested,
        remaining: Math.max(0, remaining),
        note: unresolvedNames.length > 0
          ? `No YouTube id or handle for: ${unresolvedNames.join(", ")} — fill the handle on the channel and retry.`
          : remaining > 0
            ? `${remaining} channel(s) still un-harvested — run again.`
            : undefined,
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("[harvest-channel-videos] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
