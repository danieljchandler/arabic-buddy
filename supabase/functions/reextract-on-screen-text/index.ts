// Read a video's on-screen text again, after the fact.
//
// The first read happens in the browser at upload time: the admin form samples
// frames off the file it already has and posts them to extract-visual-context.
// That leaves two gaps. A video added before the vision pass existed has no
// screen text at all, and a pass that came back empty — a low-contrast caption,
// a punchline on a frame the sampler stepped over — leaves a video whose joke
// is invisible to the learner. Neither can be fixed from the admin's browser,
// because by then nobody has the file any more.
//
// So this fetches the video back from where it came from and asks Gemini to
// read the whole thing, not a handful of stills. Callers that DO still hold the
// file can post `frames` instead and skip the download.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { chatFetch, hasAnyProvider } from "../_shared/aiGateway.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import {
  ON_SCREEN_TEXT_PROMPT,
  buildVisualContextText,
  normalizeOnScreenSegments,
  stripOnScreenLines,
  toVisualTimeline,
  type OnScreenSegment,
} from "../_shared/onScreenText.ts";

interface VideoFrame {
  dataUri: string;
  timestampSeconds: number;
}

interface VisionReply {
  onScreenTextSegments?: unknown;
  sceneContext?: unknown;
  culturalContext?: unknown;
}

/**
 * Gemini's inline-data path carries the file inside the request, so the whole
 * body has to stay under the API's 20 MB limit — and base64 costs a third on
 * top of the raw bytes. Anything bigger has to come in as frames from a caller
 * that still holds the file.
 */
const MAX_INLINE_VIDEO_BYTES = 13 * 1024 * 1024;

const GEMINI_MODEL = "gemini-2.5-flash";

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  return first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;
}

function safeJsonParse<T>(content: string): T | null {
  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch {
    console.error("reextract-on-screen-text: JSON parse failed, preview:", content.slice(0, 300));
    return null;
  }
}

/** Read the overlays off sampled frames, through whichever provider serves the vision model. */
async function readFromFrames(
  frames: VideoFrame[],
  durationSeconds?: number,
): Promise<VisionReply> {
  const capped = frames.slice(0, 16);
  const content: Array<Record<string, unknown>> = capped.map((frame) => ({
    type: "image_url",
    image_url: {
      url: frame.dataUri.startsWith("data:") ? frame.dataUri : `data:image/jpeg;base64,${frame.dataUri}`,
    },
  }));
  content.push({
    type: "text",
    text: `Re-read the on-screen text in these ${capped.length} sampled frames`
      + `${durationSeconds ? ` from a ${durationSeconds}s video` : ""}.\n\n`
      + `Frame timestamps: ${capped.map((f, i) => `Frame ${i + 1}: ${f.timestampSeconds}s`).join(", ")}\n\n`
      + `A previous pass may have missed text or read it wrongly. Capture every overlay you can see.`,
  });

  const response = await chatFetch(MODEL_IDS.GEMINI_FLASH, {
    messages: [
      { role: "system", content: ON_SCREEN_TEXT_PROMPT },
      { role: "user", content },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  }, { signal: AbortSignal.timeout(90_000), label: "reextract-on-screen-text" });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 402) throw new Error("AI credits exhausted");
    if (response.status === 429) throw new Error("Rate limit exceeded");
    throw new Error(`Vision provider error (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  if (!raw) throw new Error("Vision model returned an empty response");
  const parsed = safeJsonParse<VisionReply>(raw);
  if (!parsed) throw new Error("Could not parse the vision model's reply");
  return parsed;
}

/**
 * Read the overlays off the whole video, through the Gemini API directly.
 *
 * Sampled frames are a compromise the browser is stuck with; given the file
 * itself Gemini watches all of it, which is what catches the caption that only
 * appears between two samples — the usual reason a first pass came back empty.
 */
async function readFromVideo(
  base64: string,
  mimeType: string,
  apiKey: string,
  durationSeconds?: number,
): Promise<VisionReply> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ON_SCREEN_TEXT_PROMPT }] },
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            {
              text: `Read every piece of text shown on screen in this`
                + `${durationSeconds ? ` ${durationSeconds}-second` : ""} video, with the seconds each one is visible.`,
            },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini video read failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
  if (!raw) throw new Error("Gemini returned no text for this video");
  const parsed = safeJsonParse<VisionReply>(raw);
  if (!parsed) throw new Error("Could not parse Gemini's reply");
  return parsed;
}

/** Fetch the source video back through download-media's video mode. */
async function fetchSourceVideo(
  sourceUrl: string,
  projectUrl: string,
  serviceRoleKey: string,
): Promise<{ base64: string; contentType: string; size: number }> {
  const response = await fetch(`${projectUrl}/functions/v1/download-media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl, wantVideo: true, bypassCache: true }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(body?.error ?? `Could not download the source video (${response.status})`));
  }
  const base64 = String(body?.mediaBase64 ?? body?.audioBase64 ?? "");
  const contentType = String(body?.contentType ?? "");
  if (!base64) throw new Error("The source video came back empty");
  if (!contentType.startsWith("video/")) {
    throw new Error(
      `Only the audio track could be retrieved from this source (${contentType || "unknown type"}). `
      + "Re-upload the video file so its frames can be read.",
    );
  }
  const size = Number(body?.size ?? 0) || Math.floor(base64.length * 0.75);
  if (size > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(
      `The source video is ${(size / 1048576).toFixed(1)} MB, past the ${(MAX_INLINE_VIDEO_BYTES / 1048576).toFixed(0)} MB `
      + "the vision model accepts in one request. Re-upload the file so its frames can be sampled instead.",
    );
  }
  return { base64, contentType, size };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401, corsHeaders);
  }

  try {
    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.slice("Bearer ".length).trim();

    // Rewriting another admin's video row is an admin action; the pipeline
    // calling itself with the service-role key is the one exception.
    if (token !== serviceRoleKey) {
      const supabaseAuth = createClient(projectUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) return json({ error: "Unauthorized" }, 401, corsHeaders);
      const { data: isAdmin, error: adminError } = await supabaseAuth.rpc("is_admin");
      if (adminError || !isAdmin) return json({ error: "Admin access required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const videoId = typeof body?.videoId === "string" ? body.videoId : "";
    const frames: VideoFrame[] = Array.isArray(body?.frames) ? body.frames : [];
    if (!videoId) return json({ error: "videoId is required" }, 400, corsHeaders);

    const admin = createClient(projectUrl, serviceRoleKey);
    const { data: video, error: videoError } = await admin
      .from("discover_videos")
      .select("id, source_url, title, duration_seconds, is_meme, transcript_lines, cultural_context")
      .eq("id", videoId)
      .maybeSingle();
    if (videoError) return json({ error: `Could not load the video: ${videoError.message}` }, 500, corsHeaders);
    if (!video) return json({ error: "Video not found" }, 404, corsHeaders);

    const durationSeconds = typeof video.duration_seconds === "number" ? video.duration_seconds : undefined;

    let reply: VisionReply;
    let readFrom: "frames" | "video";
    if (frames.length > 0) {
      if (!hasAnyProvider()) return json({ error: "AI service not configured" }, 500, corsHeaders);
      readFrom = "frames";
      reply = await readFromFrames(frames, durationSeconds);
    } else {
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) {
        return json(
          { error: "Re-reading a stored video needs GEMINI_API_KEY. Re-upload the file to read its frames instead." },
          500,
          corsHeaders,
        );
      }
      const sourceUrl = typeof video.source_url === "string" ? video.source_url : "";
      if (!sourceUrl) {
        return json(
          { error: "This video has no source URL to fetch, so it can only be re-read by re-uploading the file." },
          400,
          corsHeaders,
        );
      }
      readFrom = "video";
      const media = await fetchSourceVideo(sourceUrl, projectUrl, serviceRoleKey);
      console.log(`reextract-on-screen-text: read ${(media.size / 1048576).toFixed(1)} MB of ${media.contentType}`);
      reply = await readFromVideo(media.base64, media.contentType.split(";")[0], geminiKey, durationSeconds);
    }

    const segments: OnScreenSegment[] = normalizeOnScreenSegments(
      reply.onScreenTextSegments,
      durationSeconds ?? 0,
    );
    const sceneContext = typeof reply.sceneContext === "string" ? reply.sceneContext : "";
    const culturalContext = typeof reply.culturalContext === "string" ? reply.culturalContext : "";
    console.log(`reextract-on-screen-text: ${segments.length} segment(s) from the ${readFrom}`);

    // Stage the blob the pipeline reads, so a later re-run of the transcription
    // sees the same text this run found.
    const { error: uploadError } = await admin.storage
      .from("video-audio")
      .upload(
        `${videoId}.visual.json`,
        JSON.stringify({
          onScreenTextSegments: segments,
          sceneContext,
          culturalContext,
          detectedDialectCues: [],
        }),
        { contentType: "application/json", upsert: true },
      );
    if (uploadError) console.warn("reextract-on-screen-text: staging the visual blob failed:", uploadError.message);

    // Anything an older run left inside the transcript comes out at the same
    // time. Leaving it there would show the learner the same caption twice —
    // once as screen text and once as a line somebody supposedly said.
    const existingLines = Array.isArray(video.transcript_lines) ? video.transcript_lines : [];
    const cleanedLines = stripOnScreenLines(existingLines);
    const removed = existingLines.length - cleanedLines.length;

    const visualContext = buildVisualContextText(segments, sceneContext, culturalContext);
    const update: Record<string, unknown> = {
      visual_timeline: toVisualTimeline(segments, sceneContext),
    };
    if (removed > 0) update.transcript_lines = cleanedLines;
    // Only a meme hangs its whole meaning on the screen text, so only a meme's
    // cultural notes are rewritten from this pass. On an ordinary video those
    // notes came from the transcript analysis and are not this pass's to replace.
    if (video.is_meme && visualContext) update.cultural_context = visualContext;
    if (video.is_meme) {
      update.transcription_error = segments.length === 0
        ? "Re-reading the video found no readable on-screen text."
        : null;
    }

    const { error: updateError } = await admin.from("discover_videos").update(update).eq("id", videoId);
    if (updateError) return json({ error: `Could not save the result: ${updateError.message}` }, 500, corsHeaders);

    return json({
      success: true,
      readFrom,
      segments,
      sceneContext,
      onScreenTextCount: segments.length,
      removedTranscriptLines: removed,
    }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("reextract-on-screen-text error:", message);
    return json({ error: message }, 500, corsHeaders);
  }
});
