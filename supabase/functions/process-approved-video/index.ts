// process-approved-video — v2: accept anon-key bearer + early logging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ASR_TIMEOUT_MS = 5 * 60 * 1000;

// ── MP3 frame chunker ────────────────────────────────────────────────────
// Used for Munsit which has no async/polling endpoint and silently returns
// an empty transcript for files above ~10 MB. We split the MP3 on real frame
// boundaries (~60s per chunk), call /audio/transcribe in parallel for each
// chunk, then stitch transcripts and shift word timestamps by chunk offset.
// Non-MP3 inputs (mp4/m4a/webm/opus) are NOT chunked here — Munsit is just
// skipped for those when oversized, since splitting those containers safely
// requires a real demuxer.

function isLikelyMp3(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType && /mpeg|mp3/i.test(contentType)) return true;
  if (bytes.length < 3) return false;
  // ID3v2 tag
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  // MPEG audio frame sync (0xFFE...)
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return true;
  return false;
}

function* iterMp3Frames(buf: Uint8Array): Generator<{ offset: number; size: number; durMs: number }> {
  let i = 0;
  // Skip ID3v2 header if present (10-byte header + synchsafe size)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 && buf.length > 10) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  const BR_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const BR_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const SR_V1 = [44100, 48000, 32000, 0];
  const SR_V2 = [22050, 24000, 16000, 0];
  const SR_V25 = [11025, 12000, 8000, 0];
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) { i++; continue; }
    const verBits = (buf[i + 1] >> 3) & 0x03;   // 0=2.5, 1=reserved, 2=2, 3=1
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 1=Layer III
    if (verBits === 1 || layerBits !== 1) { i++; continue; }
    const brIdx = (buf[i + 2] >> 4) & 0x0F;
    const srIdx = (buf[i + 2] >> 2) & 0x03;
    const pad = (buf[i + 2] >> 1) & 0x01;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const isV1 = verBits === 3;
    const br = (isV1 ? BR_V1L3 : BR_V2L3)[brIdx] * 1000;
    const sr = (verBits === 3 ? SR_V1 : verBits === 2 ? SR_V2 : SR_V25)[srIdx];
    const samples = isV1 ? 1152 : 576;
    const size = Math.floor((samples / 8) * br / sr) + pad;
    if (size < 4 || i + size > buf.length) { i++; continue; }
    yield { offset: i, size, durMs: (samples / sr) * 1000 };
    i += size;
  }
}

function chunkMp3ByDuration(
  bytes: Uint8Array,
  targetSec: number,
): Array<{ bytes: Uint8Array; offsetSec: number; durSec: number }> {
  const chunks: Array<{ bytes: Uint8Array; offsetSec: number; durSec: number }> = [];
  let chunkStart = -1;
  let chunkDurMs = 0;
  let cumMs = 0;
  let lastEnd = 0;
  for (const f of iterMp3Frames(bytes)) {
    if (chunkStart < 0) chunkStart = f.offset;
    chunkDurMs += f.durMs;
    lastEnd = f.offset + f.size;
    if (chunkDurMs >= targetSec * 1000) {
      chunks.push({ bytes: bytes.slice(chunkStart, lastEnd), offsetSec: cumMs / 1000, durSec: chunkDurMs / 1000 });
      cumMs += chunkDurMs;
      chunkStart = -1;
      chunkDurMs = 0;
    }
  }
  if (chunkStart >= 0 && chunkDurMs > 0) {
    chunks.push({ bytes: bytes.slice(chunkStart, lastEnd), offsetSec: cumMs / 1000, durSec: chunkDurMs / 1000 });
  }
  return chunks;
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function stripArabicDiacritics(text: string): string {
  return text.replace(/[\u064B-\u065F\u0670]/g, "");
}

function normalizeComparableText(text: string): string {
  return stripArabicDiacritics(String(text ?? ""))
    .toLowerCase()
    .replace(/[\s\u0640]+/g, "")
    .replace(/[،؟.!:؛…\-—–"'()[\]{}«»]/g, "")
    .trim();
}

function normalizeLooseText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\u0640]+/g, "")
    .replace(/[،؟.!:؛…\-—–"'()[\]{}«»]/g, "")
    .trim();
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function tokenizeOnScreenText(text: string) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((surface, index) => ({ id: `screen-tok-${generateId()}-${index}`, surface }));
}

function mergeOnScreenTextLines(rawLines: any[], onScreenSegments: any[]): any[] {
  if (!Array.isArray(rawLines)) return [];
  if (!Array.isArray(onScreenSegments) || onScreenSegments.length === 0) return rawLines;

  const merged = [...rawLines];
  const existingNormalized = new Set(
    merged
      .map((line) => normalizeComparableText(line?.arabic ?? ""))
      .filter((value) => value.length > 0),
  );

  for (const [idx, segment] of onScreenSegments.entries()) {
    const text = String(segment?.text ?? "").trim();
    if (!text) continue;

    const normalized = hasArabic(text) ? normalizeComparableText(text) : normalizeLooseText(text);
    if (!normalized) continue;

    const alreadyPresent = [...existingNormalized].some((existing) => {
      const existingKey = hasArabic(text) ? existing : normalizeLooseText(existing);
      return (
        existingKey === normalized ||
        (normalized.length >= 4 && existingKey.includes(normalized)) ||
        (existingKey.length >= 4 && normalized.includes(existingKey))
      );
    });
    if (alreadyPresent) continue;

    existingNormalized.add(normalized);
    const startMs = Math.max(0, Math.round(Number(segment?.startSeconds ?? 0) * 1000));
    const endMs = Math.max(startMs + 500, Math.round(Number(segment?.endSeconds ?? segment?.startSeconds ?? 0) * 1000));
    merged.push({
      id: `screen-line-${generateId()}-${idx}`,
      arabic: text,
      translation: String(segment?.translation ?? "").trim(),
      startMs,
      endMs,
      source: "on_screen",
      needs_review: segment?.confidence === "low",
      tokens: tokenizeOnScreenText(text),
    });
  }

  return merged.sort((a, b) => Number(a?.startMs ?? 0) - Number(b?.startMs ?? 0));
}

function buildVisualContextText(visualResult: any): string | null {
  if (!visualResult) return null;
  const segs = Array.isArray(visualResult?.onScreenTextSegments) ? visualResult.onScreenTextSegments : [];
  const onScreenSummary = segs
    .map((s: any) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` — ${s.translation}` : ""}`)
    .join("\n");
  return [
    onScreenSummary ? `On-screen text:\n${onScreenSummary}` : "",
    visualResult?.sceneContext ? `Scene: ${visualResult.sceneContext}` : "",
    visualResult?.culturalContext ? `Cultural context: ${visualResult.culturalContext}` : "",
  ].filter(Boolean).join("\n\n") || null;
}

function combineContext(primary?: string | null, visual?: string | null): string | null {
  const parts = [visual, primary].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return [...new Set(parts)].join("\n\n");
}

function buildMemeReviewContext(onScreenSegments: any[], visualContext?: string | null): string | null {
  if (Array.isArray(onScreenSegments) && onScreenSegments.length > 0) return visualContext ?? null;
  return combineContext(
    visualContext ?? null,
    "Meme review warning: no readable on-screen text was extracted from the sampled video frames. Do not rely on inferred cultural context until an admin reviews the source video.",
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}


function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }

    if (host === "youtube.com") {
      const direct = parsed.searchParams.get("v");
      if (direct) return direct;

      const pathMatch = parsed.pathname.match(/^\/(shorts|live|embed)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch?.[2]) return pathMatch[2];
    }

    return null;
  } catch {
    return null;
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

// ── Background pipeline ────────────────────────────────────────────────────
// Runs entirely decoupled from the HTTP request lifecycle so that req.signal
// (fired by the platform when the request connection closes) cannot abort it.
async function runPipeline(
  videoId: string,
  video: any,
  supabase: any,
  authHeader: string,
  projectUrl: string,
): Promise<void> {
  const storagePaths = [
    `${videoId}.mp4`, `${videoId}.m4a`, `${videoId}.webm`,
    `${videoId}.mp3`, `${videoId}.opus`,
  ];

  try {
    console.log(`[pipeline] Starting for video ${videoId}: ${video.source_url}`);

    // ── Step 1: Get audio ──────────────────────────────────────────
    console.log("[pipeline] Step 1: Getting audio...");

    let audioBytes: ArrayBuffer | null = null;
    let audioContentType = "audio/mp4";
    let downloadDuration: number | null = null;

    // Check staged storage first
    for (const path of storagePaths) {
      const { data: fileData, error: fileErr } = await supabase.storage
        .from("video-audio")
        .download(path);
      if (!fileErr && fileData) {
        console.log(`[pipeline] Found audio in storage: video-audio/${path}`);
        audioBytes = await fileData.arrayBuffer();
        audioContentType = fileData.type || (path.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4");
        break;
      }
    }

    // Fallback 1: reuse already extracted audio from `audio` bucket
    if (!audioBytes) {
      const extractedVideoId = extractYouTubeVideoId(video.source_url || "");
      let candidatePath: string | null = null;

      if (extractedVideoId) {
        const { data: byVideoId } = await supabase
          .from("audio_files")
          .select("storage_path")
          .eq("status", "ready")
          .eq("video_id", extractedVideoId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        candidatePath = byVideoId?.storage_path ?? null;
      }

      if (!candidatePath) {
        const { data: bySourceUrl } = await supabase
          .from("audio_files")
          .select("storage_path")
          .eq("status", "ready")
          .eq("source_url", video.source_url)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        candidatePath = bySourceUrl?.storage_path ?? null;
      }

      if (candidatePath) {
        const { data: extractedAudio, error: extractedAudioErr } = await supabase.storage
          .from("audio")
          .download(candidatePath);

        if (!extractedAudioErr && extractedAudio) {
          console.log(`[pipeline] Reusing extracted audio: audio/${candidatePath}`);
          audioBytes = await extractedAudio.arrayBuffer();
          audioContentType = extractedAudio.type || (candidatePath.endsWith(".opus") ? "audio/ogg; codecs=opus" : "audio/mp4");
        } else {
          console.warn(`[pipeline] Failed to load audio/${candidatePath}: ${extractedAudioErr?.message ?? "unknown error"}`);
        }
      }
    }

    // Fallback 2: queue RunPod for YouTube URLs (runpod-only ingestion)
    if (!audioBytes && isYouTubeUrl(video.source_url || "")) {
      const extractedVideoId = extractYouTubeVideoId(video.source_url || "");
      if (!extractedVideoId) {
        throw new Error("Could not extract YouTube video ID for RunPod ingestion");
      }

      console.log("[pipeline] No audio found, queuing RunPod extraction...");
      const queueResp = await fetch(`${projectUrl}/functions/v1/trigger-download`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_url: video.source_url,
          video_id: extractedVideoId,
          discover_video_id: videoId,
        }),
      });

      if (!queueResp.ok) {
        const errBody = await queueResp.text();
        throw new Error(`RunPod queue failed (${queueResp.status}): ${errBody}`);
      }

      await supabase.from("discover_videos").update({
        transcription_status: "pending",
        transcription_error: null,
      }).eq("id", videoId);

      console.log("[pipeline] RunPod extraction queued, pipeline will resume via receive-audio callback");
      return;
    }

    // Fallback 3: non-YouTube sources still use download-media
    if (!audioBytes) {
      console.log("[pipeline] No storage audio found, downloading from URL...");
      const downloadResp = await fetch(`${projectUrl}/functions/v1/download-media`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.source_url }),
      });

      if (!downloadResp.ok) {
        const errBody = await downloadResp.text();
        throw new Error(`Download failed (${downloadResp.status}): ${errBody}`);
      }

      const downloadData = await downloadResp.json();

      if (downloadData.cached && downloadData.transcriptionData) {
        console.log("[pipeline] Cache hit — using existing transcription data");
        const cached = downloadData.transcriptionData;
        await supabase.from("discover_videos").update({
          transcript_lines: cached.lines || [],
          vocabulary: cached.vocabulary || [],
          grammar_points: cached.grammarPoints || [],
          cultural_context: cached.culturalContext || null,
          dialect: cached.dialect || "Gulf",
          difficulty: cached.difficulty || "Intermediate",
          transcription_status: "completed",
          transcription_error: null,
        }).eq("id", videoId);
        return;
      }

      if (!downloadData.audioBase64) {
        throw new Error("No audio data received. Try uploading the audio file manually.");
      }

      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      audioBytes = bytes.buffer;
      audioContentType = downloadData.contentType || "audio/mp4";

      if (downloadData.duration) downloadDuration = Math.round(downloadData.duration);
    }

    const fileSizeMB = (audioBytes.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[pipeline] Audio ready: ${fileSizeMB} MB`);

    if (downloadDuration) {
      await supabase.from("discover_videos").update({ duration_seconds: downloadDuration }).eq("id", videoId);
    }

    // ── Step 2: Call ASR APIs directly (no sub-edge-functions) ────
    console.log("[pipeline] Step 2: Transcribing with all engines directly...");

    // Resolve dialect module for routing prompts + Azure locale.
    // discover_videos.dialect can be a country (Saudi/Kuwaiti/UAE/...) or a module name.
    const rawDialect = (video.dialect ?? "Gulf") as string;
    const dialectModule: "Gulf" | "Egyptian" | "Yemeni" =
      rawDialect === "Egyptian" ? "Egyptian" :
      rawDialect === "Yemeni" ? "Yemeni" :
      "Gulf";
    console.log(`[pipeline] dialectModule=${dialectModule} (from video.dialect=${rawDialect})`);

    // Each engine returns { text, words?, latencyMs, ... }. `words` is in
    // Deepgram-compatible shape: { text, start, end } in seconds. We capture
    // native word/token timings from Soniox + Munsit so alignment doesn't
    // depend on Deepgram's English-tuned Arabic word boundaries.

    // --- Deepgram ---
    const deepgramPromise = (async () => {
      const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
      if (!DEEPGRAM_API_KEY) { console.warn("[pipeline] Deepgram: no API key"); return null; }

      const params = new URLSearchParams({
        model: "nova-3", language: "ar", diarize: "true", punctuate: "true", smart_format: "true",
      });

      const t0 = Date.now();
      try {
        const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
          method: "POST",
          headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, "Content-Type": audioContentType },
          body: audioBytes,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t}`); }
        const data = await resp.json();
        const alt = data?.results?.channels?.[0]?.alternatives?.[0];
        const text = alt?.transcript ?? "";
        const words = (alt?.words ?? []).map((w: any) => ({
          text: w.punctuated_word ?? w.word ?? "", start: w.start, end: w.end,
        }));
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Deepgram: ${text.length} chars, ${words.length} words, ${latencyMs}ms`);
        return { text, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Deepgram failed:", e);
        return { text: "", words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Fanar (text-only, no word timestamps) ---
    const fanarPromise = (async () => {
      const FANAR_API_KEY = Deno.env.get("FANAR_API_KEY")?.trim();
      if (!FANAR_API_KEY) { console.warn("[pipeline] Fanar: no API key"); return { text: null, latencyMs: 0 }; }

      const t0 = Date.now();
      try {
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        fd.append("model", "Fanar-Aura-STT-1");
        fd.append("response_format", "json");
        fd.append("language", "ar");

        const resp = await fetch("https://api.fanar.qa/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${FANAR_API_KEY}` },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t}`); }
        const data = await resp.json();
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Fanar: ${data.text?.length || 0} chars, ${latencyMs}ms`);
        return { text: data.text || null, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Fanar failed:", e);
        return { text: null, latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Soniox: capture sub-word tokens, merge into word-level array ---
    const sonioxPromise = (async () => {
      const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");
      if (!SONIOX_API_KEY) { console.warn("[pipeline] Soniox: no API key"); return { text: null, sonioxUsed: false, words: [], latencyMs: 0 }; }

      const SONIOX_BASE = "https://api.soniox.com/v1";
      const sHeaders = { Authorization: `Bearer ${SONIOX_API_KEY}` };

      const t0 = Date.now();
      try {
        // Upload file
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        const uploadResp = await fetch(`${SONIOX_BASE}/files`, { method: "POST", headers: sHeaders, body: fd });
        if (!uploadResp.ok) { const t = await uploadResp.text(); throw new Error(`Upload ${uploadResp.status}: ${t}`); }
        const { id: fileId } = await uploadResp.json();

        // Create transcription with translation
        const createBody: Record<string, unknown> = {
          model: "stt-async-v4", file_id: fileId, language_hints: ["ar"], language_hints_strict: true,
          translation: { type: "one_way", target_language: "en" },
        };
        let createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
          method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody),
        });
        // Retry without translation if it fails
        if (!createResp.ok) {
          await createResp.text();
          delete createBody.translation;
          createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
            method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody),
          });
        }
        if (!createResp.ok) { const t = await createResp.text(); throw new Error(`Create ${createResp.status}: ${t}`); }
        const transcription = await createResp.json();

        // Poll
        let status = transcription.status;
        const startPoll = Date.now();
        while (status !== "completed" && status !== "error") {
          if (Date.now() - startPoll > 4 * 60 * 1000) throw new Error("Soniox polling timeout");
          await new Promise(r => setTimeout(r, 2000));
          const pollResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcription.id}`, { headers: sHeaders });
          if (!pollResp.ok) { await pollResp.text(); continue; }
          const pd = await pollResp.json();
          status = pd.status;
        }
        if (status === "error") throw new Error("Soniox transcription error");

        // Get transcript
        const tResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcription.id}/transcript`, { headers: sHeaders });
        if (!tResp.ok) throw new Error(`Transcript fetch ${tResp.status}`);
        const tData = await tResp.json();

        // Cleanup
        fetch(`${SONIOX_BASE}/files/${fileId}`, { method: "DELETE", headers: sHeaders }).catch(() => {});

        // Merge sub-word tokens into word-level array compatible with Deepgram shape.
        const tokens: any[] = Array.isArray(tData.tokens) ? tData.tokens : [];
        const words: Array<{ text: string; start: number; end: number }> = [];
        let curr = "";
        let wStart = 0;
        let wEnd = 0;
        for (const tk of tokens) {
          const txt: string = tk.text ?? "";
          if (txt === "" || txt === " ") {
            if (curr) { words.push({ text: curr, start: wStart / 1000, end: wEnd / 1000 }); curr = ""; }
            continue;
          }
          if (txt.startsWith(" ") || !curr) {
            if (curr) words.push({ text: curr, start: wStart / 1000, end: Math.max(wEnd, wStart) / 1000 });
            curr = txt.trimStart();
            wStart = tk.start_ms ?? 0;
            // Some Soniox tokens omit end_ms on the first sub-word of a phrase.
            // Falling through to 0 here collapsed word timing — keep the
            // token's own start_ms as a safe lower bound.
            wEnd = tk.end_ms ?? tk.start_ms ?? 0;
          } else {
            curr += txt;
            wEnd = tk.end_ms ?? tk.start_ms ?? wEnd;
          }
        }
        if (curr) words.push({ text: curr, start: wStart / 1000, end: Math.max(wEnd, wStart) / 1000 });

        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Soniox: ${tData.text?.length || 0} chars, ${words.length} words, ${latencyMs}ms`);
        return { text: tData.text || null, sonioxUsed: true, translationText: tData.translation_text || null, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Soniox failed:", e);
        return { text: null, sonioxUsed: false, words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Munsit (Arabic-native; sync endpoint only — chunk MP3s for long audio) ---
    const munsitPromise = (async () => {
      const MUNSIT_API_KEY = Deno.env.get("MUNSIT_API_KEY")?.trim();
      if (!MUNSIT_API_KEY) { console.warn("[pipeline] Munsit: no API key"); return { text: null, words: [], latencyMs: 0 }; }

      const audioU8 = new Uint8Array(audioBytes!);
      const isMp3 = isLikelyMp3(audioU8, audioContentType);
      const sizeMB = audioU8.byteLength / (1024 * 1024);
      // Munsit's sync /audio/transcribe silently returns "" above ~10 MB.
      // For MP3 we split on frame boundaries and run chunks in parallel.
      const NEEDS_CHUNK = sizeMB > 9;
      const t0 = Date.now();

      const callOnce = async (
        payload: Uint8Array,
        label: string,
      ): Promise<{ text: string; words: Array<{ text: string; start: number; end: number }> }> => {
        const fd = new FormData();
        fd.append("file", new File([payload], "audio.mp3", { type: audioContentType }));
        fd.append("model", "munsit");
        const resp = await fetch("https://api.munsit.com/api/v1/audio/transcribe", {
          method: "POST",
          headers: { "x-api-key": MUNSIT_API_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
        const raw = await resp.json();
        // Munsit returns { statusCode, data: { transcription, attributes: { timestampsRaw: [...] } } }.
        // Older/alt shapes may put fields at the root — fall back to that.
        const payload = raw?.data ?? raw ?? {};
        const attrs = payload?.attributes ?? {};
        const text = ((payload.transcription ?? payload.text ?? raw.transcription ?? raw.text) as string | undefined) || "";
        const words: Array<{ text: string; start: number; end: number }> = [];
        const pushWord = (w: any) => {
          if (!w) return;
          const txt = (w.word ?? w.text ?? "").toString();
          if (!txt) return;
          let s = Number(w.start ?? w.start_ms ?? w.startMs ?? 0);
          let e = Number(w.end ?? w.end_ms ?? w.endMs ?? 0);
          if (s > 1000 || e > 1000) { s /= 1000; e /= 1000; }
          words.push({ text: txt, start: s, end: e });
        };
        const timestampsArr =
          (Array.isArray(attrs.timestampsRaw) && attrs.timestampsRaw) ||
          (Array.isArray(attrs.timestamps) && attrs.timestamps) ||
          (Array.isArray(payload.timestamps) && payload.timestamps) ||
          (Array.isArray(payload.words) && payload.words) ||
          (Array.isArray(raw.timestamps) && raw.timestamps) ||
          (Array.isArray(raw.words) && raw.words) ||
          null;
        if (timestampsArr) {
          timestampsArr.forEach(pushWord);
        } else {
          const segs = payload.segments ?? raw.segments;
          if (Array.isArray(segs)) {
            for (const seg of segs) if (Array.isArray(seg.words)) seg.words.forEach(pushWord);
          }
        }
        if (!text) {
          console.warn(`[pipeline] Munsit ${label}: empty transcription — raw keys=${Object.keys(raw ?? {}).join(",")} data keys=${Object.keys(payload ?? {}).join(",")}`);
        }
        console.log(`[pipeline] Munsit ${label}: ${text.length} chars, ${words.length} words`);
        return { text, words };
      };

      try {
        if (NEEDS_CHUNK && isMp3) {
          const chunks = chunkMp3ByDuration(audioU8, 60);
          if (chunks.length === 0) throw new Error("MP3 chunker yielded 0 frames");
          console.log(`[pipeline] Munsit: ${sizeMB.toFixed(2)} MB MP3 → ${chunks.length} chunks (~60s each)`);
          const parts = await mapWithConcurrency(chunks, 3, async (c, i) => {
            try {
              const r = await callOnce(c.bytes, `chunk ${i + 1}/${chunks.length} (@${c.offsetSec.toFixed(1)}s, ${(c.bytes.byteLength / 1024).toFixed(0)} KB)`);
              return { ...r, offsetSec: c.offsetSec };
            } catch (e) {
              console.warn(`[pipeline] Munsit chunk ${i + 1} failed:`, e);
              return { text: "", words: [], offsetSec: c.offsetSec };
            }
          });
          const text = parts.map(p => p.text.trim()).filter(Boolean).join(" ");
          const words = parts.flatMap(p =>
            p.words.map(w => ({ text: w.text, start: w.start + p.offsetSec, end: w.end + p.offsetSec })),
          );
          const latencyMs = Date.now() - t0;
          console.log(`[pipeline] Munsit (chunked): ${text.length} chars, ${words.length} words, ${chunks.length} chunks, ${latencyMs}ms`);
          return { text: text || null, words, latencyMs };
        }

        if (NEEDS_CHUNK && !isMp3) {
          console.warn(`[pipeline] Munsit: skipping — ${sizeMB.toFixed(2)} MB non-MP3 (${audioContentType}) exceeds sync endpoint`);
          return { text: null, words: [], latencyMs: Date.now() - t0, error: "oversize-non-mp3" };
        }

        const { text, words } = await callOnce(audioU8, "single");
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Munsit: ${text.length} chars, ${words.length} words, ${latencyMs}ms`);
        return { text: text || null, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Munsit failed:", e);
        return { text: null, words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();


    // --- Azure Speech (locale-routed by dialect module) ---
    const azurePromise = (async () => {
      const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY");
      const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION");
      if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
        console.warn("[pipeline] Azure: not configured");
        return { text: null };
      }
      const locale =
        dialectModule === "Egyptian" ? "ar-EG" :
        dialectModule === "Yemeni" ? "ar-YE" :
        "ar-SA";
      try {
        const definition = { locales: [locale], profanityFilterMode: "None" };
        const fd = new FormData();
        fd.append("audio", new Blob([audioBytes!], { type: audioContentType }), "audio");
        fd.append("definition", JSON.stringify(definition));
        const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
        const data = await resp.json();
        const text =
          (data.combinedPhrases?.[0]?.text as string | undefined) ??
          ((data.phrases ?? []).map((p: any) => p.text).filter(Boolean).join(" ") as string) ??
          "";
        console.log(`[pipeline] Azure (${locale}): ${text.length} chars`);
        return { text: text || null, locale };
      } catch (e) {
        console.warn("[pipeline] Azure failed:", e);
        return { text: null };
      }
    })();

    const [deepgramResult, fanarResult, sonioxResult, munsitResult, azureResult] = await Promise.all([
      deepgramPromise, fanarPromise, sonioxPromise, munsitPromise, azurePromise,
    ]);

    const deepgramText = deepgramResult?.text || "";
    const fanarText = fanarResult?.text || "";
    const sonioxText = sonioxResult?.sonioxUsed ? (sonioxResult.text || "") : "";
    const munsitText = munsitResult?.text || "";
    const azureText = azureResult?.text || "";

    const engines: string[] = [];
    if (deepgramText) engines.push("Deepgram");
    if (fanarText) engines.push("Fanar");
    if (sonioxText) engines.push("Soniox");
    if (munsitText) engines.push("Munsit");
    if (azureText) engines.push("Azure");

    if (engines.length === 0) throw new Error("All transcription engines failed");

    console.log(`[pipeline] Got transcriptions from: ${engines.join(", ")}`);

    // ── Quality-weighted primary text picker ────────────────────────────
    // Earlier code used a hardcoded waterfall (Munsit||Soniox||Fanar||…)
    // which meant a 3-char Munsit response could beat a full Soniox one.
    // Instead: of the Arabic-aware engines (Munsit/Soniox/Fanar), compute
    // the median char length, drop anything < 50% of median, then take the
    // longest of the survivors. Engine priority is the tie-breaker.
    type EngineName = "Munsit" | "Soniox" | "Fanar" | "Azure" | "Deepgram";
    const arabicCandidates: Array<{ name: EngineName; text: string; words: any[] }> = [
      { name: "Munsit", text: munsitText, words: (munsitResult as any)?.words ?? [] },
      { name: "Soniox", text: sonioxText, words: (sonioxResult as any)?.words ?? [] },
      { name: "Fanar",  text: fanarText,  words: [] }, // Fanar has no word timings
    ].filter(c => (c.text || "").trim().length > 0);

    const PRIORITY: EngineName[] = ["Munsit", "Soniox", "Fanar", "Azure", "Deepgram"];
    function pickPrimary(): { name: EngineName; text: string; words: any[] } {
      if (arabicCandidates.length === 0) {
        // Fall back to whatever is non-empty, priority order
        const fallback =
          (azureText && { name: "Azure" as EngineName, text: azureText, words: [] }) ||
          (deepgramText && { name: "Deepgram" as EngineName, text: deepgramText, words: deepgramResult?.words ?? [] });
        return fallback || { name: "Deepgram", text: deepgramText, words: deepgramResult?.words ?? [] };
      }
      const lens = arabicCandidates.map(c => c.text.length).sort((a, b) => a - b);
      const median = lens[Math.floor(lens.length / 2)];
      const valid = arabicCandidates.filter(c => c.text.length >= 0.5 * median);
      // Longest first, priority as tie-breaker
      valid.sort((a, b) => {
        if (b.text.length !== a.text.length) return b.text.length - a.text.length;
        return PRIORITY.indexOf(a.name) - PRIORITY.indexOf(b.name);
      });
      return valid[0];
    }

    const primary = pickPrimary();
    const primaryText = primary.text;
    const primaryEngine: EngineName = primary.name;
    console.log(`[pipeline] Primary text: ${primaryEngine} (${primaryText.length} chars). Arabic candidates: ${arabicCandidates.map(c => `${c.name}=${c.text.length}`).join(", ")}`);

    // Pick alignment word source: primary engine's own words if available,
    // else Munsit/Soniox words, else Deepgram, else empty (proportional fallback).
    const alignmentWords =
      primary.words.length > 0 ? primary.words :
      ((sonioxResult as any)?.words?.length ? (sonioxResult as any).words :
       ((munsitResult as any)?.words?.length ? (munsitResult as any).words :
        (deepgramResult?.words ?? [])));
    const alignmentSource: EngineName =
      primary.words.length > 0 ? primaryEngine :
      ((sonioxResult as any)?.words?.length ? "Soniox" :
       ((munsitResult as any)?.words?.length ? "Munsit" : "Deepgram"));
    console.log(`[pipeline] Alignment words: ${alignmentSource} (${alignmentWords.length} words)`);
    const relativeWords = alignmentWords;


    // ── Step 3: Analyze via analyze-gulf-arabic ──────────────────
    // Pass videoId so analyze-gulf-arabic persists results directly to DB,
    // making the pipeline resilient to Supabase gateway ~150s timeouts.
    // Send the QUALITY-PICKED primary text as `transcript`; everything else
    // goes through as alternates for the LLM merge step.
    console.log("[pipeline] Step 3: Analyzing transcript...");

    // Meme videos: load on-screen text analysis the admin form pre-extracted
    // (frames -> extract-visual-context -> stored as <id>.visual.json).
    let visualContextSummary: string | null = null;
    let visualCulturalContext: string | null = null;
    let onScreenTextLines: any[] = [];
    let visualContextLoaded = false;
    if (video.is_meme) {
      try {
        const { data: visualBlob } = await supabase.storage
          .from("video-audio")
          .download(`${videoId}.visual.json`);
        if (visualBlob) {
          visualContextLoaded = true;
          const visualText = await visualBlob.text();
          const visualResult = JSON.parse(visualText);
          const segs = Array.isArray(visualResult?.onScreenTextSegments) ? visualResult.onScreenTextSegments : [];
          onScreenTextLines = segs;
          visualCulturalContext = buildVisualContextText(visualResult);
          if (segs.length > 0) {
            const onScreenSummary = segs.map((s: any) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` (${s.translation})` : ""}`).join("\n");
            visualContextSummary = `MEME — on-screen text segments:\n${onScreenSummary}\n\nScene: ${visualResult?.sceneContext ?? ""}`.trim();
            console.log(`[pipeline] Meme: ${segs.length} on-screen text segments loaded`);
          } else {
            console.warn("[pipeline] Meme: visual context loaded; no on-screen text detected — result will be flagged for review");
          }
        } else {
          console.warn(`[pipeline] Meme: no visual context file found for ${videoId}; processing audio only`);
        }
      } catch (e) {
        console.warn("[pipeline] Meme visual context load failed (non-fatal):", e instanceof Error ? e.message : String(e));
      }

      if (!visualContextLoaded) {
        throw new Error("Meme screen-text extraction is missing. Upload the original video file so the Meme Analyzer can read text on screen before transcription.");
      }
    }

    // Generate a signed URL for the staged audio so analyze-gulf-arabic
    // can pass it to Tier 1 (Gemini) as native multimodal input.
    let audioRef: string | null = null;
    try {
      for (const path of storagePaths) {
        const { data: signed } = await supabase.storage
          .from("video-audio")
          .createSignedUrl(path, 60 * 30); // 30 min
        if (signed?.signedUrl) { audioRef = signed.signedUrl; break; }
      }
    } catch (e) {
      console.warn("[pipeline] Signed URL failed (non-fatal):", e);
    }

    const analyzeBody: Record<string, unknown> = {
      transcript: primaryText,
      primaryEngine,
      videoId,
      dialectModule,
      isMeme: !!video.is_meme,
    };
    if (audioRef) analyzeBody.audioRef = audioRef;
    if (visualContextSummary) analyzeBody.visualContext = visualContextSummary;
    if (onScreenTextLines.length > 0) analyzeBody.onScreenTextSegments = onScreenTextLines;
    if (fanarText) analyzeBody.fanarTranscript = fanarText;
    if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
    if (munsitText) analyzeBody.munsitTranscript = munsitText;
    if (azureText) analyzeBody.azureTranscript = azureText;
    if (deepgramText && primaryEngine !== "Deepgram") analyzeBody.deepgramTranscript = deepgramText;
    const sonioxTranslation = sonioxResult?.translationText;
    if (sonioxTranslation) analyzeBody.sonioxTranslation = sonioxTranslation;

    // Fire the analysis — it saves results directly to DB via videoId.
    // We still try to read the response, but a 504 is non-fatal now.
    let analyzeData: any = null;
    try {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const internalAuth = serviceRoleKey ? `Bearer ${serviceRoleKey}` : authHeader;
      const analyzeResp = await fetch(`${projectUrl}/functions/v1/analyze-gulf-arabic`, {
        method: "POST",
        headers: { Authorization: internalAuth, "Content-Type": "application/json" },
        body: JSON.stringify(analyzeBody),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });

      if (analyzeResp.ok) {
        analyzeData = await analyzeResp.json();
      } else {
        const errText = await analyzeResp.text().catch(() => "");
        console.warn(`[pipeline] analyze-gulf-arabic HTTP ${analyzeResp.status}: ${errText.slice(0, 200)}`);
      }
    } catch (fetchErr) {
      console.warn("[pipeline] analyze-gulf-arabic fetch error (checking DB for direct-persist):", fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
    }

    // Check if analyze-gulf-arabic persisted results directly (status = 'analysis_complete')
    const { data: refreshed } = await supabase.from("discover_videos")
      .select("transcription_status, transcript_lines, vocabulary, grammar_points, cultural_context, dialect, difficulty, title, title_arabic")
      .eq("id", videoId)
      .single();

    // Align merged-Arabic lines to the source audio timeline.
    //
    // The naive approach (walking Deepgram word indices) breaks badly because:
    //   - the AI merger rewrites/normalizes Arabic, so word counts no longer
    //     match the ASR token stream;
    //   - Deepgram often returns FAR fewer Arabic words than Soniox/Munsit
    //     (English-tuned segmentation), so later lines end up with
    //     undefined timestamps.
    //
    // Instead, take the total speech span from the most reliable timestamped
    // source available and proportionally allocate to each line by character
    // length. This keeps line audio in roughly the right place even when the
    // merged text and the timestamped ASR diverge.
    const alignLinesToAudio = (rawLines: any[]): any[] => {
      if (!Array.isArray(rawLines) || rawLines.length === 0) return rawLines;

      // Total audio duration in ms — the most reliable upper bound.
      const audioDurationMs =
        ((downloadDuration && downloadDuration > 0 ? downloadDuration : 0) * 1000) ||
        (((video as any).duration_seconds && (video as any).duration_seconds > 0 ? (video as any).duration_seconds : 0) * 1000) ||
        0;

      // Scan all alignment words for true min start / max end. Some ASRs
      // (notably Soniox) drop end_ms on the final token of a phrase, which
      // previously collapsed the entire span to a single instant — every
      // line ended up with startMs == endMs == first word offset.
      let spanStartMs = Number.POSITIVE_INFINITY;
      let spanEndMs = 0;
      for (const w of relativeWords) {
        const s = Number((w as any)?.start ?? 0) * 1000;
        const e = Number((w as any)?.end ?? 0) * 1000;
        if (s > 0 && s < spanStartMs) spanStartMs = s;
        if (e > spanEndMs) spanEndMs = e;
        if (s > spanEndMs) spanEndMs = s; // start-only tokens still extend span
      }
      if (!Number.isFinite(spanStartMs)) spanStartMs = 0;

      // Degenerate span (missing or single-point word times) → fall back
      // to full audio duration so line audio still plays in roughly the
      // right place.
      if (spanEndMs - spanStartMs < 500) {
        if (audioDurationMs > 0) {
          spanStartMs = 0;
          spanEndMs = audioDurationMs;
        } else {
          spanStartMs = 0;
          spanEndMs = Math.max(spanEndMs, rawLines.length * 2000);
        }
      }

      const totalSpan = Math.max(1, spanEndMs - spanStartMs);

      const lens = rawLines.map((l: any) => {
        const txt = String(l?.arabic ?? "").replace(/\s+/g, "");
        return Math.max(1, txt.length);
      });
      const totalLen = lens.reduce((a, b) => a + b, 0);

      let cursor = spanStartMs;
      return rawLines.map((line: any, i: number) => {
        const share = (lens[i] / totalLen) * totalSpan;
        const startMs = Math.round(cursor);
        const endMs = Math.round(cursor + share);
        cursor += share;
        return { ...line, startMs, endMs };
      });
    };

    if (refreshed?.transcription_status === "analysis_complete") {
      console.log("[pipeline] Results persisted directly by analyze-gulf-arabic");

      const lines = mergeOnScreenTextLines(
        alignLinesToAudio((refreshed.transcript_lines as any[]) || []),
        onScreenTextLines,
      );

      const title = refreshed.title || video.title;
      const titleArabic = refreshed.title_arabic || video.title_arabic;

      // Finalize: add timestamps and mark completed
      const { error: finalErr } = await supabase.from("discover_videos").update({
        title, title_arabic: titleArabic,
        transcript_lines: lines,
        cultural_context: video.is_meme
          ? buildMemeReviewContext(onScreenTextLines, combineContext(refreshed.cultural_context as string | null, visualCulturalContext))
          : combineContext(refreshed.cultural_context as string | null, visualCulturalContext),
        transcription_error: video.is_meme && onScreenTextLines.length === 0
          ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
          : null,
        transcription_status: "completed",
      }).eq("id", videoId);

      if (finalErr) throw new Error(`Failed to finalize results: ${finalErr.message}`);
    } else if (analyzeData?.success) {
      // Fallback: HTTP response arrived before gateway timeout
      const result = analyzeData.result;

      const lines = mergeOnScreenTextLines(
        alignLinesToAudio(result.lines || []),
        onScreenTextLines,
      );

      const sanitizedLines = lines.map((line: any) => ({
        ...line,
        tokens: Array.isArray(line.tokens) ? line.tokens
          : String(line.arabic ?? "").split(/\s+/).filter(Boolean)
              .map((w: string, wi: number) => ({ id: `tok-${line.id ?? wi}-${wi}`, surface: w })),
      }));

      let title = video.title;
      if ((!title || title === "Untitled Video") && result.title) title = result.title;
      let titleArabic = video.title_arabic;
      if (!titleArabic && result.titleArabic) titleArabic = result.titleArabic;

      // Auto-generate a concise title via Lovable AI if still missing/placeholder
      if (!title || title === "Untitled Video" || !titleArabic) {
        try {
          const sampleLines = sanitizedLines.slice(0, 6).map((l: any) =>
            `${l.arabic ?? ""}${l.translation ? " — " + l.translation : ""}`
          ).join("\n");
          const lovableKey = Deno.env.get("LOVABLE_API_KEY");
          if (lovableKey && sampleLines.trim()) {
            const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  { role: "system", content: 'Return ONLY JSON: {"title": string (English, ≤8 words, no quotes), "titleArabic": string (Arabic, ≤8 words)}. Title should describe the video content based on the transcript snippet.' },
                  { role: "user", content: sampleLines },
                ],
              }),
            });
            if (aiResp.ok) {
              const j = await aiResp.json();
              const raw = j?.choices?.[0]?.message?.content ?? "";
              const m = raw.match(/\{[\s\S]*\}/);
              if (m) {
                const parsed = JSON.parse(m[0]);
                if ((!title || title === "Untitled Video") && parsed.title) title = String(parsed.title).slice(0, 80);
                if (!titleArabic && parsed.titleArabic) titleArabic = String(parsed.titleArabic).slice(0, 80);
              }
            }
          }
        } catch (e) {
          console.warn("[pipeline] Auto title generation failed (non-fatal):", e);
        }
        // Deterministic fallback from first line
        const first = sanitizedLines[0] as any;
        if ((!title || title === "Untitled Video") && first?.translation) title = String(first.translation).slice(0, 80);
        if (!titleArabic && first?.arabic) titleArabic = String(first.arabic).slice(0, 80);
      }

      const { error: updateError } = await supabase.from("discover_videos").update({
        title, title_arabic: titleArabic,
        transcript_lines: sanitizedLines,
        vocabulary: result.vocabulary || [],
        grammar_points: result.grammarPoints || [],
        cultural_context: video.is_meme
          ? buildMemeReviewContext(onScreenTextLines, combineContext(result.culturalContext || null, visualCulturalContext))
          : combineContext(result.culturalContext || null, visualCulturalContext),
        dialect: result.dialect || "Gulf",
        difficulty: result.difficulty || "Intermediate",
        transcription_status: "completed",
        transcription_error: video.is_meme && onScreenTextLines.length === 0
          ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
          : null,
      }).eq("id", videoId);

      if (updateError) throw new Error(`Failed to save results: ${updateError.message}`);
    } else {
      // Neither direct-persist nor HTTP response succeeded — poll DB for
      // late-arriving analyze-gulf-arabic completion.
      //
      // analyze-gulf-arabic can genuinely take up to ~3.5 minutes (ensemble
      // of Claude + Qwen + Gemini + Fanar + gloss enrichment + diacritization).
      // The 150s Supabase edge-function idle timeout can drop the HTTP
      // response, but the function keeps running and persists directly.
      // Poll for up to 4 minutes (24 * 10s) so we catch that late-arriving write.
      console.log("[pipeline] No HTTP result — polling for late analyze-gulf-arabic persist (up to 4 min)...");
      let landed = false;
      let retryFull: any = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise(r => setTimeout(r, 10_000));
        const { data: retry } = await supabase.from("discover_videos")
          .select("transcription_status, transcript_lines, cultural_context, title, title_arabic")
          .eq("id", videoId)
          .single();
        if (retry?.transcription_status === "analysis_complete") {
          retryFull = retry;
          landed = true;
          console.log(`[pipeline] analyze results landed after ${(attempt + 1) * 10}s`);
          break;
        }
      }

      if (landed && retryFull) {
        const retryLines = mergeOnScreenTextLines(
          alignLinesToAudio((retryFull?.transcript_lines as any[]) || []),
          onScreenTextLines,
        );

        await supabase.from("discover_videos").update({
          transcript_lines: retryLines,
          cultural_context: video.is_meme
            ? buildMemeReviewContext(onScreenTextLines, combineContext(retryFull?.cultural_context as string | null, visualCulturalContext))
            : combineContext(retryFull?.cultural_context as string | null, visualCulturalContext),
          transcription_status: "completed",
          transcription_error: video.is_meme && onScreenTextLines.length === 0
            ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
            : null,
        }).eq("id", videoId);
      } else {
        throw new Error("Analysis did not complete — no HTTP response and no direct-persist results found after 4 min");
      }
    }


    // NOTE: Intentionally keep staged audio in `video-audio/` so the Discover
    // player can stream it for subtitle sync (TikTok hidden-audio playback).
    // Previously we removed `storagePaths` here to save storage, but that
    // broke automatic sync for completed videos.

    // Auto-tag difficulty (CEFR + WPM + rare-word ratio) once transcript is ready.
    // Fire-and-forget so a rating failure never breaks the main pipeline.
    try {
      const ratePromise = fetch(`${projectUrl}/functions/v1/rate-video-cefr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ videoId }),
      })
        .then(async (r) => {
          if (!r.ok) {
            console.warn(`[pipeline] auto-rate failed: ${r.status} ${await r.text().catch(() => "")}`);
          } else {
            console.log(`[pipeline] auto-rate scheduled for ${videoId}`);
          }
        })
        .catch((e) => console.warn("[pipeline] auto-rate fetch error:", e instanceof Error ? e.message : String(e)));
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(ratePromise);
    } catch (e) {
      console.warn("[pipeline] auto-rate dispatch error (non-fatal):", e);
    }

    console.log(`[pipeline] Completed for video ${videoId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[pipeline] Failed for video ${videoId}:`, errorMsg);

    await supabase.from("discover_videos").update({
      transcription_status: "failed",
      transcription_error: errorMsg,
    }).eq("id", videoId);
  }
}

// ── HTTP handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  console.log(`[handler] ${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  console.log(`[handler] auth header present: ${!!authHeader}`);
  if (!authHeader?.startsWith("Bearer ")) {
    console.error("[handler] Missing/invalid Authorization header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const token = authHeader.slice("Bearer ".length).trim();
  const isInternalServiceCall = token === serviceRoleKey;
  // The admin form sends the publishable/anon key directly. Accept both the
  // legacy anon JWT and the new sb_publishable_... key as valid public bearers
  // — `verify_jwt = false` already means anyone can hit this endpoint.
  const isAnonKey = token === anonKey;
  const isPublishableKey = publishableKey.length > 0 && token === publishableKey;
  const looksLikePublishable = token.startsWith("sb_publishable_");
  const isPublicKey = isAnonKey || isPublishableKey || looksLikePublishable;
  console.log(`[handler] isInternalServiceCall=${isInternalServiceCall} isAnonKey=${isAnonKey} isPublishableKey=${isPublishableKey} looksLikePublishable=${looksLikePublishable}`);

  if (!isInternalServiceCall && !isPublicKey) {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      anonKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      console.error("[handler] auth.getUser failed:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[handler] authenticated user ${user.id}`);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch (e) {
    console.error("[handler] JSON parse failed:", e);
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const { videoId } = body ?? {};
  console.log(`[handler] videoId=${videoId}`);
  if (!videoId) {
    return new Response(
      JSON.stringify({ error: "videoId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: video, error: fetchErr } = await supabase
    .from("discover_videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (fetchErr || !video) {
    return new Response(
      JSON.stringify({ error: "Video not found", details: fetchErr?.message }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase
    .from("discover_videos")
    .update({ transcription_status: "processing", transcription_error: null })
    .eq("id", videoId);

  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  // Always use service-role key for inter-function calls so the pipeline
  // keeps working even after the original user JWT expires mid-run.
  const pipelineAuth = `Bearer ${serviceRoleKey}`;

  // Launch the pipeline as a background task that is fully decoupled from this
  // HTTP request. When the response is returned below, req.signal fires (the
  // platform considers the request done), but runPipeline() continues running
  // inside waitUntil and cannot be aborted by req.signal.
  const pipeline = runPipeline(videoId, video, supabase, pipelineAuth, projectUrl);

  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(pipeline);
  } catch {
    // Fallback: keep the promise alive as a detached task
    pipeline.catch((err: unknown) => console.error("[pipeline] Unhandled background error:", err));
  }

  return new Response(
    JSON.stringify({ success: true, message: "Processing started" }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
