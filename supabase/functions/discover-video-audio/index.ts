/**
 * discover-video-audio — a short-lived URL for a published video's own audio.
 *
 * The Discover player treats the TikTok embed as a muted visual companion and
 * plays *our* audio copy from the private `video-audio` bucket as the master
 * clock, for slow-listen and for shadowing. The client used to mint that
 * signed URL itself, which only reviewers and admins can do under the
 * bucket's policies, so every learner fell back to silent timer-synced
 * playback after twelve failing storage calls (six extensions × two keys).
 *
 * This runs under the service role and answers a signed-in caller with a
 * ten-minute signed URL for a *published* video, or `{ url: null, reason }`
 * when nothing is staged so the client drops into timer mode without an
 * error. The bucket stays private; nothing here references the TikTok source.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** The staged-audio naming convention process-approved-video and the admin uploader use, in the order both pick. */
const AUDIO_EXTENSIONS = ["wav", "mp4", "m4a", "webm", "mp3", "opus"];
const URL_TTL_SECONDS = 600;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** The first staged object for a key, by the shared extension order. */
async function findAudioPath(key: string): Promise<string | null> {
  const { data, error } = await admin().storage
    .from("video-audio")
    .list("", { search: key, limit: 20 });
  if (error || !data) return null;
  const names = new Set((data as Array<{ name: string }>).map((o) => o.name));
  for (const ext of AUDIO_EXTENSIONS) {
    if (names.has(`${key}.${ext}`)) return `${key}.${ext}`;
  }
  return null;
}

/** Legacy staging keyed by the YouTube id rather than the row id. */
function youtubeIdOf(...urls: Array<string | null | undefined>): string | null {
  for (const url of urls) {
    const match = (url ?? "").match(/(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (match) return match[1];
  }
  return null;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // The authorization decision: a signed-in caller (401 otherwise) under a
  // per-learner daily ceiling. The client memoises a URL per video for its
  // lifetime, so a real session needs a handful of these; the ceiling is for a
  // script minting URLs in a loop with a signup account.
  const cap = await enforceDailyCap(req, "discover-video-audio", 300, cors);
  if (cap.limited) return cap.response;

  let videoId = "";
  try {
    const body = await req.json();
    videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  } catch {
    /* fall through to the validation below */
  }
  if (!/^[0-9a-f-]{36}$/i.test(videoId)) return json({ error: "videoId is required" }, 400, cors);

  try {
    const { data: video, error } = await admin()
      .from("discover_videos")
      .select("id, published, source_url, embed_url")
      .eq("id", videoId)
      .maybeSingle();
    if (error) throw error;
    // An unpublished video is invisible to learners under RLS; keep it that way here.
    if (!video || !video.published) return json({ error: "not_found" }, 404, cors);

    let path = await findAudioPath(video.id as string);
    if (!path) {
      const legacy = youtubeIdOf(video.source_url as string | null, video.embed_url as string | null);
      if (legacy) path = await findAudioPath(legacy);
    }
    if (!path) return json({ url: null, reason: "no_audio" }, 200, cors);

    const { data: signed, error: signError } = await admin().storage
      .from("video-audio")
      .createSignedUrl(path, URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) throw signError ?? new Error("could not sign the audio URL");

    return json(
      { url: signed.signedUrl, path, expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString() },
      200,
      cors,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("discover-video-audio error:", message);
    return json({ error: message }, 500, cors);
  }
});
