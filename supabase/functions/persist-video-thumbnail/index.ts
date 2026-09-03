/**
 * persist-video-thumbnail — give one video a still that will not expire.
 *
 * TikTok's oEmbed answers with a signed CDN URL that dies in about forty-eight
 * hours, so a row that stores it verbatim shows a picture until the weekend
 * and a broken image afterwards. Fetching it again only restarts the clock.
 * This copies the bytes into our own bucket while the signature is still good
 * and writes *that* URL to the row, which is the end of it.
 *
 * The copy has to happen here rather than in the admin's browser: the CDN
 * sends no CORS headers, so the page can display those bytes but cannot read
 * them. It is also the write path for `discover_videos.thumbnail_url` from
 * the review pages, which is why the role check is the same set RLS grants
 * content writes to.
 *
 * Body: { videoId: string, thumbnailUrl?: string }
 *   thumbnailUrl — a still the caller already has (a freshly parsed oEmbed, a
 *   frame captured from an upload). Omitted, the platform is asked instead.
 * Response: { thumbnailUrl, source: "stored" | "derived" | "platform" | "given",
 *             mirrored: boolean }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  ensureDurableThumbnail,
  fetchTikTokThumbnail,
  youTubeThumbnail,
} from "../_shared/thumbnailMirror.ts";
import { isEphemeralThumbnailUrl } from "../_shared/thumbnailUrlCore.ts";

/** Who RLS lets write `discover_videos` — `can_manage_content()`. */
const CONTENT_ROLES = ["admin", "content_reviewer"] as const;

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

function json(status: number, body: unknown, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The caller's id, if they hold a role that may write video content. */
async function resolveContentManager(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const supa = admin();
  const { data: userData, error } = await supa.auth.getUser(token);
  if (error || !userData?.user?.id) return null;

  const { data: roles } = await supa
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", [...CONTENT_ROLES]);

  return Array.isArray(roles) && roles.length > 0 ? userData.user.id : null;
}

interface VideoRow {
  id: string;
  platform: string | null;
  source_url: string | null;
  embed_url: string | null;
  thumbnail_url: string | null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userId = await resolveContentManager(req);
    if (!userId) {
      return json(403, { error: "forbidden", message: "Video thumbnails are staff-only." }, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const videoId = typeof body?.videoId === "string" ? body.videoId : "";
    const given = typeof body?.thumbnailUrl === "string" && body.thumbnailUrl ? body.thumbnailUrl : null;
    if (!videoId) {
      return json(400, { error: "invalid_request", message: "videoId is required." }, corsHeaders);
    }

    const supa = admin();
    const { data, error: readErr } = await supa
      .from("discover_videos")
      .select("id, platform, source_url, embed_url, thumbnail_url")
      .eq("id", videoId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!data) {
      return json(404, { error: "not_found", message: "No such video." }, corsHeaders);
    }
    const video = data as unknown as VideoRow;

    // What to make durable, best first. A still the caller is holding wins:
    // it is either fresher than the row's (they just pressed Fetch) or the
    // only one there is (a frame captured from an upload).
    let source: "given" | "stored" | "derived" | "platform" = "given";
    let candidate = given;

    if (!candidate && video.thumbnail_url && !isEphemeralThumbnailUrl(video.thumbnail_url)) {
      // Already permanent — nothing to do, and saying so is cheaper than
      // re-asking the platform for a picture we already have.
      return json(
        200,
        { thumbnailUrl: video.thumbnail_url, source: "stored", mirrored: false },
        corsHeaders,
      );
    }

    if (!candidate) {
      // A YouTube still is a pure function of the video id and never expires,
      // so it is worth deriving before spending a network call.
      candidate = youTubeThumbnail(video.source_url, video.embed_url);
      if (candidate) source = "derived";
    }

    if (!candidate) {
      const isTikTok =
        video.platform === "tiktok" || (video.source_url ?? "").includes("tiktok.com");
      if (isTikTok && video.source_url) {
        candidate = await fetchTikTokThumbnail(video.source_url);
        if (candidate) source = "platform";
      }
    }

    if (!candidate) {
      return json(
        422,
        {
          error: "no_thumbnail",
          message:
            video.platform === "instagram"
              ? "Instagram has no public thumbnail — upload the video file and capture a frame."
              : "No thumbnail could be found — the video may be private or deleted.",
        },
        corsHeaders,
      );
    }

    const durable = await ensureDurableThumbnail(supa, { key: video.id, url: candidate });
    if (!durable) {
      return json(422, { error: "no_thumbnail", message: "Nothing to store." }, corsHeaders);
    }

    const { error: writeErr } = await supa
      .from("discover_videos")
      .update({ thumbnail_url: durable.url })
      .eq("id", video.id);
    if (writeErr) throw writeErr;

    return json(200, { thumbnailUrl: durable.url, source, mirrored: durable.mirrored }, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("persist-video-thumbnail error:", message);
    return json(500, { error: "internal_error", message }, corsHeaders);
  }
});
