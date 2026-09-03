// ingest-shared-video — one-step admin ingestion of a shared video link.
//
// An admin shares a TikTok (or YouTube/Instagram) link to the app; this
// function turns that single action into the full Discover pipeline:
//   1. resolve short links (vt./vm.tiktok.com) to the canonical video URL
//   2. fetch oEmbed metadata (title, author, thumbnail) when available
//   3. create the discover_videos row (unpublished, pending)
//   4. kick off process-approved-video, which extracts + downloads the audio
//      via download-media/Cobalt and runs the multi-engine ASR pipeline
//
// Admin-only: verify_jwt = true in config.toml gets a valid JWT to the door;
// the role check here decides whether it may pass.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { resolveUserId, isAdminUser } from "../_shared/usageCap.ts";
import { ensureDurableThumbnail } from "../_shared/thumbnailMirror.ts";

interface ParsedVideo {
  platform: "tiktok" | "youtube" | "instagram";
  videoId: string;
  embedUrl: string;
  canonicalUrl: string;
}

/**
 * Escape the LIKE metacharacters in a literal before it is interpolated into
 * an ilike pattern. Backslash is Postgres's default LIKE escape character.
 */
export function escapeLikePattern(literal: string): string {
  return literal.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function json(status: number, body: unknown, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Server-side twin of src/lib/videoEmbed.ts's parseVideoUrl (that one touches
// window.location, so it can't be imported into Deno).
function parseVideoUrl(url: string): ParsedVideo | null {
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) {
    return {
      platform: "tiktok",
      videoId: ttMatch[1],
      embedUrl: `https://www.tiktok.com/player/v1/${ttMatch[1]}`,
      canonicalUrl: url.split("?")[0],
    };
  }
  const ttBare = url.match(/tiktok\.com\/(?:video|embed\/v2|player\/v1|v)\/(\d{8,})/);
  if (ttBare) {
    return {
      platform: "tiktok",
      videoId: ttBare[1],
      embedUrl: `https://www.tiktok.com/player/v1/${ttBare[1]}`,
      canonicalUrl: `https://www.tiktok.com/video/${ttBare[1]}`,
    };
  }

  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (ytMatch) {
    return {
      platform: "youtube",
      videoId: ytMatch[1],
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1`,
      canonicalUrl: `https://www.youtube.com/watch?v=${ytMatch[1]}`,
    };
  }

  const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  if (igMatch) {
    return {
      platform: "instagram",
      videoId: igMatch[1],
      embedUrl: `https://www.instagram.com/p/${igMatch[1]}/embed`,
      canonicalUrl: `https://www.instagram.com/reel/${igMatch[1]}/`,
    };
  }

  return null;
}

function isShortTikTokUrl(url: string): boolean {
  try {
    return /^(?:vt|vm)\.tiktok\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Follow a vt./vm.tiktok.com short link to the canonical video URL. */
async function resolveShortLink(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; arabic-buddy/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    return resp.url || url;
  } catch {
    // Some hosts reject HEAD; retry once with GET.
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; arabic-buddy/1.0)" },
        signal: AbortSignal.timeout(10_000),
      });
      resp.body?.cancel();
      return resp.url || url;
    } catch {
      return url;
    }
  }
}

interface OembedMeta {
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

async function fetchOembed(parsed: ParsedVideo): Promise<OembedMeta> {
  const endpoint =
    parsed.platform === "tiktok"
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}`
      : parsed.platform === "youtube"
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`
        : null; // Instagram oEmbed needs an app token — skip.
  if (!endpoint) return { title: null, authorName: null, thumbnailUrl: null };

  try {
    const resp = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; arabic-buddy/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { title: null, authorName: null, thumbnailUrl: null };
    const data = await resp.json();
    return {
      title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 200) : null,
      authorName: typeof data.author_name === "string" ? data.author_name : null,
      thumbnailUrl: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
    };
  } catch {
    return { title: null, authorName: null, thumbnailUrl: null };
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      return json(401, { error: "auth_required", message: "Please sign in." }, corsHeaders);
    }
    if (!(await isAdminUser(userId))) {
      return json(403, { error: "admin_only", message: "Video ingestion is admin-only." }, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    const dialect = ["Gulf", "Egyptian", "Yemeni"].includes(body?.dialect) ? body.dialect : "Gulf";
    if (!/^https?:\/\//i.test(rawUrl)) {
      return json(400, { error: "invalid_url", message: "Provide an http(s) video URL." }, corsHeaders);
    }

    const resolvedUrl = isShortTikTokUrl(rawUrl) ? await resolveShortLink(rawUrl) : rawUrl;
    const parsed = parseVideoUrl(resolvedUrl);
    if (!parsed) {
      return json(
        400,
        {
          error: "unsupported_url",
          message: "Couldn't recognise a TikTok, YouTube, or Instagram video in that link.",
        },
        corsHeaders,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Dedup: the same video re-shared should open the existing row, not fork a
    // second pipeline run. Match by video id (source_url formats vary).
    //
    // The id is escaped first: YouTube ids and Instagram shortcodes legally
    // contain "_", which LIKE reads as "any single character" — so an
    // unescaped `abc_defghij` also matches a *different* video's `abc-defghij`
    // and the share would be dropped as a duplicate of the wrong row.
    const { data: existing } = await supabase
      .from("discover_videos")
      .select("id, title, transcription_status")
      .eq("platform", parsed.platform)
      .ilike("source_url", `%${escapeLikePattern(parsed.videoId)}%`)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json(
        200,
        {
          success: true,
          alreadyExists: true,
          videoId: existing.id,
          title: existing.title,
          transcriptionStatus: existing.transcription_status,
        },
        corsHeaders,
      );
    }

    const meta = await fetchOembed(parsed);

    // TikTok's oEmbed hands back a *signed* still whose `x-expires` is about
    // forty-eight hours out, so a row that stored it verbatim went blank two
    // days after it was shared. Keep our own copy while the signature is still
    // good; a YouTube still passes through untouched, being permanent already.
    const durableThumbnail = meta.thumbnailUrl
      ? await ensureDurableThumbnail(supabase, {
          key: `${parsed.platform}-${parsed.videoId}`,
          url: meta.thumbnailUrl,
        })
      : null;

    const fallbackTitle = `${parsed.platform === "tiktok" ? "TikTok" : parsed.platform === "youtube" ? "YouTube" : "Instagram"} ${parsed.videoId}`;

    const { data: inserted, error: insertErr } = await supabase
      .from("discover_videos")
      .insert({
        title: meta.title ?? fallbackTitle,
        source_url: parsed.canonicalUrl,
        platform: parsed.platform,
        embed_url: parsed.embedUrl,
        thumbnail_url: durableThumbnail?.url ?? null,
        dialect,
        difficulty: "Intermediate",
        published: false,
        created_by: userId,
        transcription_status: "pending",
        is_meme: false,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      return json(500, { error: "insert_failed", detail: insertErr?.message }, corsHeaders);
    }
    const videoId = inserted.id as string;

    // Fire-and-forget import log, same as the Transcribe URL flow.
    supabase
      .from("content_import_logs")
      .insert({ user_id: userId, url: rawUrl, platform: parsed.platform })
      .then(({ error }) => {
        if (error) console.warn("[ingest-shared-video] import log failed:", error.message);
      });

    // Kick off the pipeline server-to-server. It finds no staged audio for
    // this row, so it falls back to download-media (Cobalt) — which is exactly
    // the audio extraction step the share is meant to trigger.
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pipelineResp = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-approved-video`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId }),
      },
    );
    if (!pipelineResp.ok) {
      const detail = await pipelineResp.text().catch(() => "");
      await supabase
        .from("discover_videos")
        .update({
          transcription_status: "failed",
          transcription_error: `Failed to start processing: ${detail.slice(0, 300)}`,
        })
        .eq("id", videoId);
      return json(
        502,
        { error: "pipeline_start_failed", videoId, detail: detail.slice(0, 300) },
        corsHeaders,
      );
    }

    return json(
      200,
      {
        success: true,
        alreadyExists: false,
        videoId,
        title: meta.title ?? fallbackTitle,
        authorName: meta.authorName,
        platform: parsed.platform,
        adminPath: `/admin/videos/${videoId}/edit`,
      },
      corsHeaders,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-shared-video] error", msg);
    return json(500, { error: "server_error", detail: msg.slice(0, 400) }, corsHeaders);
  }
});
