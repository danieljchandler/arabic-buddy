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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isInternalServiceCall = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isInternalServiceCall) {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { videoId } = await req.json();
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

  try {
    console.log(`[pipeline] Starting for video ${videoId}: ${video.source_url}`);

    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Step 1: Get audio ──────────────────────────────────────────
    console.log("[pipeline] Step 1: Getting audio...");

    let audioBytes: ArrayBuffer | null = null;
    let audioContentType = "audio/mp4";
    let downloadDuration: number | null = null;

    // Check staged storage first
    const storagePaths = [`${videoId}.mp4`, `${videoId}.m4a`, `${videoId}.webm`, `${videoId}.mp3`, `${videoId}.opus`];
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

    // Fallback 2: download from URL via download-media
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
        return new Response(JSON.stringify({ success: true, message: "Completed from cache" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

    // --- Deepgram ---
    const deepgramPromise = (async () => {
      const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
      if (!DEEPGRAM_API_KEY) { console.warn("[pipeline] Deepgram: no API key"); return null; }

      const params = new URLSearchParams({
        model: "nova-3", language: "ar", diarize: "true", punctuate: "true", smart_format: "true",
      });

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
        console.log(`[pipeline] Deepgram: ${text.length} chars, ${words.length} words`);
        return { text, words };
      } catch (e) { console.warn("[pipeline] Deepgram failed:", e); return null; }
    })();

    // --- Fanar ---
    const fanarPromise = (async () => {
      const FANAR_API_KEY = Deno.env.get("FANAR_API_KEY")?.trim();
      if (!FANAR_API_KEY) { console.warn("[pipeline] Fanar: no API key"); return { text: null }; }

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
        console.log(`[pipeline] Fanar: ${data.text?.length || 0} chars`);
        return { text: data.text || null };
      } catch (e) { console.warn("[pipeline] Fanar failed:", e); return { text: null }; }
    })();

    // --- Soniox ---
    const sonioxPromise = (async () => {
      const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");
      if (!SONIOX_API_KEY) { console.warn("[pipeline] Soniox: no API key"); return { text: null, sonioxUsed: false }; }

      const SONIOX_BASE = "https://api.soniox.com/v1";
      const sHeaders = { Authorization: `Bearer ${SONIOX_API_KEY}` };

      try {
        // Upload file
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        const uploadResp = await fetch(`${SONIOX_BASE}/files`, { method: "POST", headers: sHeaders, body: fd });
        if (!uploadResp.ok) { const t = await uploadResp.text(); throw new Error(`Upload ${uploadResp.status}: ${t}`); }
        const { id: fileId } = await uploadResp.json();

        // Create transcription with translation
        let createBody: Record<string, unknown> = {
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

        console.log(`[pipeline] Soniox: ${tData.text?.length || 0} chars`);
        return { text: tData.text || null, sonioxUsed: true, translationText: tData.translation_text || null };
      } catch (e) { console.warn("[pipeline] Soniox failed:", e); return { text: null, sonioxUsed: false }; }
    })();

    // Munsit is disabled
    const munsitResult = { text: null };

    const [deepgramResult, fanarResult, sonioxResult] = await Promise.all([
      deepgramPromise, fanarPromise, sonioxPromise,
    ]);

    const munsitText = "";
    const deepgramText = deepgramResult?.text || "";
    const fanarText = fanarResult?.text || "";
    const sonioxText = sonioxResult?.sonioxUsed ? (sonioxResult.text || "") : "";

    const engines: string[] = [];
    if (deepgramText) engines.push("Deepgram");
    if (fanarText) engines.push("Fanar");
    if (sonioxText) engines.push("Soniox");

    if (engines.length === 0) throw new Error("All transcription engines failed");

    console.log(`[pipeline] Got transcriptions from: ${engines.join(", ")}`);

    const primaryText = deepgramText || fanarText || sonioxText;
    const relativeWords = deepgramResult?.words || [];

    // ── Step 3: Analyze via analyze-gulf-arabic ──────────────────
    console.log("[pipeline] Step 3: Analyzing transcript...");
    const analyzeBody: Record<string, string> = { transcript: primaryText };
    if (fanarText && fanarText !== primaryText) analyzeBody.fanarTranscript = fanarText;
    if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
    const sonioxTranslation = sonioxResult?.translationText;
    if (sonioxTranslation) analyzeBody.sonioxTranslation = sonioxTranslation;

    const analyzeResp = await fetch(`${projectUrl}/functions/v1/analyze-gulf-arabic`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(analyzeBody),
    });

    if (!analyzeResp.ok) {
      const errText = await analyzeResp.text();
      throw new Error(`Analysis failed (${analyzeResp.status}): ${errText}`);
    }

    const analyzeData = await analyzeResp.json();
    if (!analyzeData?.success) throw new Error(analyzeData?.error || "Analysis failed");

    const result = analyzeData.result;

    // Map Deepgram timestamps to lines
    let lines = result.lines || [];
    if (relativeWords.length > 0 && lines.length > 0) {
      let wordIdx = 0;
      lines = lines.map((line: any) => {
        const lineWords = line.arabic?.split(/\s+/).filter(Boolean) || [];
        let startMs: number | undefined;
        let endMs: number | undefined;
        for (const _lw of lineWords) {
          if (wordIdx < relativeWords.length) {
            if (startMs === undefined) startMs = Math.round(relativeWords[wordIdx].start * 1000);
            endMs = Math.round(relativeWords[wordIdx].end * 1000);
            wordIdx++;
          }
        }
        return { ...line, startMs, endMs };
      });
    }

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

    // ── Step 4: Save results ────────────────────────────────────
    console.log("[pipeline] Step 4: Saving results...");
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

    for (const path of storagePaths) {
      await supabase.storage.from("video-audio").remove([path]).catch(() => {});
    }

    console.log(`[pipeline] Completed! ${sanitizedLines.length} lines, ${(result.vocabulary || []).length} vocab from ${engines.length} engine(s)`);

    return new Response(
      JSON.stringify({ success: true, message: "Pipeline completed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[pipeline] Failed for video ${videoId}:`, errorMsg);

    await supabase.from("discover_videos").update({
      transcription_status: "failed",
      transcription_error: errorMsg,
    }).eq("id", videoId);

    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
