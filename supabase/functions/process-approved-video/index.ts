// process-approved-video — v2: accept anon-key bearer + early logging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ASR_TIMEOUT_MS = 5 * 60 * 1000;

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
            if (curr) words.push({ text: curr, start: wStart / 1000, end: wEnd / 1000 });
            curr = txt.trimStart();
            wStart = tk.start_ms ?? 0;
            wEnd = tk.end_ms ?? 0;
          } else {
            curr += txt;
            wEnd = tk.end_ms ?? wEnd;
          }
        }
        if (curr) words.push({ text: curr, start: wStart / 1000, end: wEnd / 1000 });

        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Soniox: ${tData.text?.length || 0} chars, ${words.length} words, ${latencyMs}ms`);
        return { text: tData.text || null, sonioxUsed: true, translationText: tData.translation_text || null, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Soniox failed:", e);
        return { text: null, sonioxUsed: false, words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Munsit (Arabic-native; try to parse word/segment timings if present) ---
    const munsitPromise = (async () => {
      const MUNSIT_API_KEY = Deno.env.get("MUNSIT_API_KEY")?.trim();
      if (!MUNSIT_API_KEY) { console.warn("[pipeline] Munsit: no API key"); return { text: null, words: [], latencyMs: 0 }; }
      const t0 = Date.now();
      try {
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        fd.append("model", "munsit");
        const resp = await fetch("https://api.munsit.com/api/v1/audio/transcribe", {
          method: "POST",
          headers: { "x-api-key": MUNSIT_API_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
        const data = await resp.json();
        const text = (data.transcription as string | undefined) || "";

        // Try to capture word-level timings. Munsit responses can expose words at
        // top-level `data.words`, or per-segment `data.segments[i].words`. Times
        // may be in seconds or ms — normalize to seconds.
        const words: Array<{ text: string; start: number; end: number }> = [];
        const pushWord = (w: any) => {
          if (!w) return;
          const txt = (w.word ?? w.text ?? "").toString();
          if (!txt) return;
          let s = Number(w.start ?? w.start_ms ?? w.startMs ?? 0);
          let e = Number(w.end ?? w.end_ms ?? w.endMs ?? 0);
          // If values look like ms (large numbers), convert
          if (s > 1000 || e > 1000) { s /= 1000; e /= 1000; }
          words.push({ text: txt, start: s, end: e });
        };
        if (Array.isArray(data.words)) data.words.forEach(pushWord);
        else if (Array.isArray(data.segments)) {
          for (const seg of data.segments) {
            if (Array.isArray(seg.words)) seg.words.forEach(pushWord);
          }
        }

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

    // Munsit is the highest-priority Arabic-native engine for dialect text when present.
    // Soniox is the strongest general engine (lowest WER on Arabic in 2026 benchmarks).
    // Fall back to Fanar (Arabic-native), Azure (locale-tuned), then Deepgram.
    // Deepgram words are still used for timestamp alignment regardless of which text wins.
    const primaryText = munsitText || sonioxText || fanarText || azureText || deepgramText;
    const relativeWords = deepgramResult?.words || [];


    // ── Step 3: Analyze via analyze-gulf-arabic ──────────────────
    // Pass videoId so analyze-gulf-arabic persists results directly to DB,
    // making the pipeline resilient to Supabase gateway ~150s timeouts.
    // Send Deepgram as `transcript` (it has the best word boundaries for downstream
    // sentence segmentation); send the others as alternates so the LLM merge can
    // pick the best wording per the engine-priority rules in the merge prompt.
    console.log("[pipeline] Step 3: Analyzing transcript...");

    // Meme videos: load on-screen text analysis the admin form pre-extracted
    // (frames -> extract-visual-context -> stored as <id>.visual.json).
    let visualContextSummary: string | null = null;
    let onScreenTextLines: any[] = [];
    if (video.is_meme) {
      try {
        const { data: visualBlob } = await supabase.storage
          .from("video-audio")
          .download(`${videoId}.visual.json`);
        if (visualBlob) {
          const visualText = await visualBlob.text();
          const visualResult = JSON.parse(visualText);
          const segs = Array.isArray(visualResult?.onScreenTextSegments) ? visualResult.onScreenTextSegments : [];
          onScreenTextLines = segs;
          if (segs.length > 0) {
            const onScreenSummary = segs.map((s: any) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` (${s.translation})` : ""}`).join("\n");
            visualContextSummary = `MEME — on-screen text segments:\n${onScreenSummary}\n\nScene: ${visualResult?.sceneContext ?? ""}`.trim();
            console.log(`[pipeline] Meme: ${segs.length} on-screen text segments loaded`);
          }
        }
      } catch (e) {
        console.warn("[pipeline] Meme visual context load failed (non-fatal):", e instanceof Error ? e.message : String(e));
      }
    }

    const analyzeBody: Record<string, unknown> = {
      transcript: deepgramText || primaryText,
      videoId,
      dialectModule,
      isMeme: !!video.is_meme,
    };
    if (visualContextSummary) analyzeBody.visualContext = visualContextSummary;
    if (onScreenTextLines.length > 0) analyzeBody.onScreenTextSegments = onScreenTextLines;
    if (fanarText) analyzeBody.fanarTranscript = fanarText;
    if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
    if (munsitText) analyzeBody.munsitTranscript = munsitText;
    if (azureText) analyzeBody.azureTranscript = azureText;
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
      const words = relativeWords;
      if (!words.length) return rawLines;
      const spanStartMs = Math.max(0, Math.round((words[0]?.start ?? 0) * 1000));
      const spanEndMs = Math.round((words[words.length - 1]?.end ?? 0) * 1000);
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

      const lines = alignLinesToAudio((refreshed.transcript_lines as any[]) || []);

      const title = refreshed.title || video.title;
      const titleArabic = refreshed.title_arabic || video.title_arabic;

      // Finalize: add timestamps and mark completed
      const { error: finalErr } = await supabase.from("discover_videos").update({
        title, title_arabic: titleArabic,
        transcript_lines: lines,
        transcription_status: "completed",
      }).eq("id", videoId);

      if (finalErr) throw new Error(`Failed to finalize results: ${finalErr.message}`);
    } else if (analyzeData?.success) {
      // Fallback: HTTP response arrived before gateway timeout
      const result = analyzeData.result;

      const lines = alignLinesToAudio(result.lines || []);

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
        cultural_context: result.culturalContext || null,
        dialect: result.dialect || "Gulf",
        difficulty: result.difficulty || "Intermediate",
        transcription_status: "completed",
        transcription_error: null,
      }).eq("id", videoId);

      if (updateError) throw new Error(`Failed to save results: ${updateError.message}`);
    } else {
      // Neither direct-persist nor HTTP response succeeded — wait briefly and retry DB check
      console.log("[pipeline] Waiting 30s for analyze-gulf-arabic to finish persisting...");
      await new Promise(r => setTimeout(r, 30_000));

      const { data: retry } = await supabase.from("discover_videos")
        .select("transcription_status")
        .eq("id", videoId)
        .single();

      if (retry?.transcription_status === "analysis_complete") {
        await supabase.from("discover_videos").update({ transcription_status: "completed" }).eq("id", videoId);
        console.log("[pipeline] Results found on retry check");
      } else {
        throw new Error("Analysis did not complete — no HTTP response and no direct-persist results found");
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
          Authorization: pipelineAuth,
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
