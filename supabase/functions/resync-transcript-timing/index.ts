// resync-transcript-timing — lock a transcript's timings to the audio.
//
// The ingest pipeline times lines against whatever the ASR engines heard,
// which is only as good as their transcript. Once a human reviewer has
// corrected the text, the text is ground truth and the timing is not — and
// forced alignment (trusted text + audio in, word timings out) is a far more
// accurate problem than ASR ever was, because the aligner no longer has to
// guess the words. This function runs that pass: it sends the stored Arabic
// and the staged audio to ElevenLabs' forced-alignment endpoint, maps the
// timed words back onto the stored lines through the same text-anchoring
// module the pipeline uses, and returns the re-timed lines.
//
// By default nothing is written: the transcript editor shows the proposal
// through its diff preview and persists an accepted one via transcript-review
// `save_lines` (source "resync"), which is the audited write path. A caller
// holding the service role — the backfill job — may pass `persist: true` to
// write directly; the same revision diff is logged either way.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireRole, TRANSCRIPT_EDITOR_ROLES } from "../_shared/requireRole.ts";
import { alignLinesToAsrWords, type TimedAsrWord } from "../_shared/transcriptTimingAlign.ts";
import { diffTranscriptRevisions } from "../_shared/transcriptRevisionCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

interface TranscriptLine {
  id?: string;
  arabic?: string;
  startMs?: number;
  endMs?: number;
  segmentType?: string;
  [key: string]: unknown;
}

/** One word from the forced-alignment response. */
interface ForcedAlignmentWord {
  text?: string;
  start?: number;
  end?: number;
  loss?: number;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/**
 * The staged audio for a video, tried against the same six extensions the
 * pipeline stages and the Discover player streams (`src/lib/videoAudioStaging.ts`).
 * The audio the aligner hears must be the audio the player plays — aligning
 * against a different rendition would bake its offset into every timestamp.
 */
async function loadStagedAudio(
  videoId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string; path: string } | null> {
  const paths = [
    `${videoId}.wav`, `${videoId}.mp4`, `${videoId}.m4a`, `${videoId}.webm`,
    `${videoId}.mp3`, `${videoId}.opus`,
  ];
  for (const path of paths) {
    const { data, error } = await admin().storage.from("video-audio").download(path);
    if (!error && data) {
      const contentType = data.type ||
        (path.endsWith(".mp3") ? "audio/mpeg" : path.endsWith(".wav") ? "audio/wav" : "audio/mp4");
      return { bytes: await data.arrayBuffer(), contentType, path };
    }
  }
  return null;
}

/** Fetch audio through download-media when nothing is staged (YouTube rows). */
async function downloadAudio(
  sourceUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/download-media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: sourceUrl }),
  });
  if (!resp.ok) {
    console.warn(`[resync] download-media ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return null;
  }
  const data = await resp.json();
  if (!data?.audioBase64) return null;
  const binary = atob(data.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes: bytes.buffer, contentType: data.contentType || "audio/mp4" };
}

/**
 * ElevenLabs forced alignment: audio + the exact text to align, word-level
 * start/end (seconds) back. Runs on the same key the app already holds for
 * Scribe and TTS. Each word also carries a `loss` (the aligner's own
 * uncertainty) — not acted on yet, since its scale is undocumented; the
 * text-anchoring module's trust gate is what rejects a bad alignment.
 */
async function forceAlign(
  audio: { bytes: ArrayBuffer; contentType: string },
  text: string,
  apiKey: string,
): Promise<TimedAsrWord[]> {
  const fd = new FormData();
  fd.append("file", new File([audio.bytes], "audio", { type: audio.contentType }));
  fd.append("text", text);

  const resp = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
    signal: AbortSignal.timeout(150_000),
  });
  if (!resp.ok) {
    throw new Error(`Forced alignment HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const words: ForcedAlignmentWord[] = Array.isArray(data?.words) ? data.words : [];
  return words
    .filter((w) =>
      String(w?.text ?? "").trim().length > 0 &&
      Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end))
    )
    .map((w) => ({ text: String(w.text), start: Number(w.start), end: Number(w.end) }));
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Same audience as the transcript editor itself: re-timing is transcript
  // work, and the service-role bypass is what lets the backfill job run it.
  const gate = await requireRole(req, TRANSCRIPT_EDITOR_ROLES, cors);
  if (gate.denied) return gate.response;

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY")?.trim();
    if (!apiKey) return json({ error: "ELEVENLABS_API_KEY is not configured" }, 500, cors);

    const body = await req.json().catch(() => ({}));
    const videoId = String(body?.videoId ?? "");
    const persist = body?.persist === true;
    if (!videoId) return json({ error: "videoId is required" }, 400, cors);

    const { data: video } = await admin()
      .from("discover_videos")
      .select("id, source_url, duration_seconds, transcript_lines")
      .eq("id", videoId)
      .maybeSingle();
    if (!video) return json({ error: "video_not_found" }, 404, cors);

    // The editor keeps unsaved corrections as an on-device draft, so a re-sync
    // requested from it aligns the text the reviewer is looking at — the lines
    // it sends — rather than whatever the last save stored. Persisting is a
    // different matter: a direct write is only ever of the stored transcript,
    // so the audited save_lines path stays the sole way client text lands.
    const provided: TranscriptLine[] | null = Array.isArray(body?.lines)
      ? (body.lines as unknown[]).filter(
          (l): l is TranscriptLine =>
            typeof l === "object" && l !== null && !Array.isArray(l) &&
            typeof (l as TranscriptLine).id === "string",
        )
      : null;
    if (provided && persist) {
      return json(
        { error: "persist_requires_stored_lines", message: "Save the transcript first, then persist a re-sync." },
        400,
        cors,
      );
    }

    const lines: TranscriptLine[] = provided && provided.length > 0
      ? provided
      : Array.isArray(video.transcript_lines)
        ? (video.transcript_lines as TranscriptLine[])
        : [];
    if (lines.length === 0) return json({ error: "no_transcript" }, 400, cors);

    const audio = (await loadStagedAudio(videoId)) ??
      (video.source_url ? await downloadAudio(String(video.source_url)) : null);
    if (!audio) {
      return json(
        { error: "no_audio", message: "No staged audio and no downloadable source for this video." },
        409,
        cors,
      );
    }

    // The aligner gets the transcript verbatim, one line per line — it aligns
    // whatever text it is given, so the reviewer's dialectal spellings are the
    // reference, not a problem to normalise away.
    const lineTexts = lines.map((l) => String(l?.arabic ?? ""));
    const alignedWords = await forceAlign(audio, lineTexts.join("\n"), apiKey);
    if (alignedWords.length === 0) {
      return json({ error: "alignment_failed", message: "The aligner returned no words." }, 502, cors);
    }

    const durationSeconds = Number(video.duration_seconds);
    const timings = alignLinesToAsrWords(lineTexts, alignedWords, {
      audioDurationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds * 1000
        : undefined,
      // The aligner consumed the exact text it was given, so nearly every word
      // should match; well under that means the audio and transcript disagree
      // (wrong file, heavy music) and the result should not be trusted.
      minMatchRatio: 0.7,
    });
    if (!timings) {
      return json(
        { error: "alignment_rejected", message: "Too few words matched — the audio may not fit this transcript." },
        422,
        cors,
      );
    }

    const retimed = lines.map((line, i) => ({
      ...line,
      startMs: timings[i].startMs,
      endMs: timings[i].endMs,
      words: timings[i].words,
    }));
    const matched = timings.reduce((acc, l) => acc + l.words.filter((w) => w.matched).length, 0);
    const total = timings.reduce((acc, l) => acc + l.words.length, 0);
    console.log(`[resync] ${videoId}: ${matched}/${total} words matched`);

    if (persist) {
      const revisions = diffTranscriptRevisions(lines, retimed);
      const { error } = await admin()
        .from("discover_videos")
        .update({ transcript_lines: retimed })
        .eq("id", videoId);
      if (error) return json({ error: "save_failed", message: error.message }, 500, cors);
      if (revisions.length > 0) {
        const { error: logErr } = await admin().from("transcript_line_revisions").insert(
          revisions.map((r) => ({
            video_id: videoId,
            line_id: r.lineId,
            field: r.field,
            previous_value: r.previousValue,
            new_value: r.newValue,
            changed_by: gate.userId,
            source: "resync",
          })),
        );
        if (logErr) console.error("[resync] revision log failed:", logErr.message);
      }
      return json({ saved: true, lines: retimed, matched, total }, 200, cors);
    }

    return json({ lines: retimed, matched, total }, 200, cors);
  } catch (e) {
    console.error("resync-transcript-timing error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, cors);
  }
});
