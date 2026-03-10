import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Orchestrates the full transcription/translation pipeline for an approved
 * trending video. Steps:
 *  1. Download YouTube audio (via the existing download-media function)
 *  2. Transcribe with all engines in parallel (Deepgram, Fanar, Soniox, Munsit)
 *  3. Merge + translate via analyze-gulf-arabic
 *  4. Save results to the discover_videos row
 *
 * Called fire-and-forget from the frontend when admin clicks Approve.
 * Uses the service-role key so the pipeline can run without a user session.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Authenticate caller (admin user)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error: userError,
  } = await supabaseAuth.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { videoId } = await req.json();
  if (!videoId) {
    return new Response(
      JSON.stringify({ error: "videoId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Use service-role client for DB writes (background processing)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Fetch the discover_videos row
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

  // Mark as processing
  await supabase
    .from("discover_videos")
    .update({ transcription_status: "processing", transcription_error: null })
    .eq("id", videoId);

  // Return immediately — the actual pipeline runs in the background
  // We use Deno's ability to keep running after response is sent
  const responsePromise = new Response(
    JSON.stringify({ success: true, message: "Processing started" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );

  // Run the pipeline asynchronously (Deno edge functions continue after response)
  const pipelinePromise = (async () => {
    try {
      console.log(`[pipeline] Starting for video ${videoId}: ${video.source_url}`);

      // ── Step 1: Try YouTube captions first (fast, no download needed) ──
      console.log("[pipeline] Step 1: Trying YouTube captions first...");
      const projectUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const authHeaders = { Authorization: `Bearer ${serviceKey}` };

      let captionsText: string | null = null;
      let captionLines: any[] | null = null;

      try {
        const captionsResp = await fetch(
          `${projectUrl}/functions/v1/fetch-youtube-captions`,
          {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ url: video.source_url }),
          }
        );

        if (captionsResp.ok) {
          const captionsData = await captionsResp.json();
          if (captionsData.rawText && captionsData.lines?.length > 0) {
            captionsText = captionsData.rawText;
            captionLines = captionsData.lines;
            console.log(`[pipeline] Got ${captionsData.count} caption lines (lang: ${captionsData.lang})`);
          }
        } else {
          console.log(`[pipeline] Captions not available (${captionsResp.status}), will try audio download`);
        }
      } catch (e) {
        console.warn("[pipeline] Captions fetch error:", e);
      }

      // If we got captions, skip audio download entirely and go straight to analysis
      let useAudioPipeline = !captionsText;
      let audioFile: File | null = null;
      let relativeWords: any[] = [];
      let engines: string[] = [];

      if (useAudioPipeline) {
        // ── Step 1b: Download audio (fallback) ──────────────────────────
        console.log("[pipeline] Step 1b: Downloading audio...");
        const downloadResp = await fetch(
          `${projectUrl}/functions/v1/download-media`,
          {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ url: video.source_url }),
          }
        );

        if (!downloadResp.ok) {
          const errBody = await downloadResp.text();
          throw new Error(`Download failed (${downloadResp.status}): ${errBody}`);
        }

        const downloadData = await downloadResp.json();

        // Check if we got a cache hit with existing transcription data
        if (downloadData.cached && downloadData.transcriptionData) {
          console.log("[pipeline] Cache hit — using existing transcription data");
          const cached = downloadData.transcriptionData;
          await supabase
            .from("discover_videos")
            .update({
              transcript_lines: cached.lines || [],
              vocabulary: cached.vocabulary || [],
              grammar_points: cached.grammarPoints || [],
              cultural_context: cached.culturalContext || null,
              dialect: cached.dialect || "Gulf",
              difficulty: cached.difficulty || "Intermediate",
              transcription_status: "completed",
              transcription_error: null,
            })
            .eq("id", videoId);
          console.log("[pipeline] Completed (from cache)");
          return;
        }

        if (!downloadData.audioBase64) {
          throw new Error("No audio data received from download");
        }

        const binaryStr = atob(downloadData.audioBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const audioBlob = new Blob([bytes], {
          type: downloadData.contentType || "audio/mp4",
        });
        audioFile = new File(
          [audioBlob],
          downloadData.filename || "audio.mp4",
          { type: audioBlob.type }
        );

        const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);
        console.log(`[pipeline] Audio downloaded: ${fileSizeMB} MB`);

        if (downloadData.duration) {
          await supabase
            .from("discover_videos")
            .update({ duration_seconds: Math.round(downloadData.duration) })
            .eq("id", videoId);
        }
      }

      // ── Step 2: Transcribe (audio pipeline) or use captions ─────────
      let primaryText = "";
      let munsitText = "";
      let fanarText = "";
      let sonioxText = "";
      let sonioxTranslation: string | null = null;
      let deepgramData: any = null;

      if (useAudioPipeline && audioFile) {
        console.log("[pipeline] Step 2: Transcribing with all engines...");
      const projectUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const authHeaders = { Authorization: `Bearer ${serviceKey}` };

        const makeFormData = (fieldName: string) => {
          const fd = new FormData();
          fd.append(fieldName, audioFile!);
          return fd;
        };

        const munsitPromise = fetch(`${projectUrl}/functions/v1/munsit-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: makeFormData("audio"),
          signal: AbortSignal.timeout(300000),
        })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok && !body.text)
              throw new Error(body.error || `Munsit HTTP ${res.status}`);
            return body as { text?: string | null; error?: string };
          })
          .catch((e) => {
            console.warn("[pipeline] Munsit failed:", e);
            return { text: null } as { text: string | null };
          });

        const deepgramPromise = fetch(`${projectUrl}/functions/v1/deepgram-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: makeFormData("file"),
          signal: AbortSignal.timeout(300000),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}`);
            return res.json();
          })
          .catch((e) => {
            console.warn("[pipeline] Deepgram failed:", e);
            return null;
          });

        const fanarPromise = fetch(`${projectUrl}/functions/v1/fanar-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: makeFormData("audio"),
          signal: AbortSignal.timeout(300000),
        })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok && !body.text)
              throw new Error(body.error || `Fanar HTTP ${res.status}`);
            return body as { text?: string | null; reason?: string };
          })
          .catch((e) => {
            console.warn("[pipeline] Fanar failed:", e);
            return { text: null } as { text: string | null };
          });

        const sonioxFd = new FormData();
        sonioxFd.append(
          "audio",
          new File([audioFile!], audioFile!.name, { type: audioFile!.type })
        );
        sonioxFd.append("includeTranslation", "true");
        const sonioxPromise = fetch(`${projectUrl}/functions/v1/soniox-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: sonioxFd,
          signal: AbortSignal.timeout(300000),
        })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok && !body.text)
              throw new Error(body.error || `Soniox HTTP ${res.status}`);
            return body as {
              text?: string | null;
              sonioxUsed?: boolean;
              reason?: string;
              translationText?: string | null;
            };
          })
          .catch((e) => {
            console.warn("[pipeline] Soniox failed:", e);
            return { text: null, sonioxUsed: false } as {
              text: string | null;
              sonioxUsed: boolean;
            };
          });

        const [munsitResult, deepgramResult, fanarResult, sonioxResult] =
          await Promise.all([munsitPromise, deepgramPromise, fanarPromise, sonioxPromise]);

        munsitText = munsitResult?.text || "";
        deepgramData = deepgramResult;
        const deepgramText = deepgramData?.text || "";
        fanarText = fanarResult?.text || "";
        sonioxText =
          sonioxResult && "sonioxUsed" in sonioxResult && sonioxResult.sonioxUsed
            ? sonioxResult.text || ""
            : "";

        if (munsitText) engines.push("Munsit");
        if (deepgramText) engines.push("Deepgram");
        if (fanarText) engines.push("Fanar");
        if (sonioxText) engines.push("Soniox");

        if (engines.length === 0) {
          throw new Error("All transcription engines failed and no captions available");
        }

        console.log(`[pipeline] Got transcriptions from: ${engines.join(", ")}`);

        primaryText = deepgramText || munsitText || fanarText;
        if (deepgramData?.words?.length > 0) {
          relativeWords = deepgramData.words;
        }

        sonioxTranslation =
          sonioxResult && "translationText" in sonioxResult
            ? sonioxResult.translationText || null
            : null;
      } else {
        // Captions path
        primaryText = captionsText!;
        engines.push("YouTube Captions");
        console.log("[pipeline] Using YouTube captions as primary transcript");
      }

      // ── Step 3: Analyze & merge via analyze-gulf-arabic ─────────────
      console.log("[pipeline] Step 3: Analyzing transcript...");
      const analyzeBody: Record<string, string> = { transcript: primaryText };
      if (munsitText && munsitText !== primaryText) {
        analyzeBody.munsitTranscript = munsitText;
      }
      if (fanarText) analyzeBody.fanarTranscript = fanarText;
      if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
      if (sonioxTranslation) analyzeBody.sonioxTranslation = sonioxTranslation;

      const analyzeResp = await fetch(
        `${projectUrl}/functions/v1/analyze-gulf-arabic`,
        {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(analyzeBody),
        }
      );

      if (!analyzeResp.ok) {
        const errText = await analyzeResp.text();
        throw new Error(`Analysis failed (${analyzeResp.status}): ${errText}`);
      }

      const analyzeData = await analyzeResp.json();
      if (!analyzeData?.success) {
        throw new Error(analyzeData?.error || "Analysis failed");
      }

      const result = analyzeData.result;

      // Map timestamps to lines
      let lines = result.lines || [];
      if (relativeWords.length > 0 && lines.length > 0) {
        // Audio pipeline: use Deepgram word timestamps
        let wordIdx = 0;
        lines = lines.map((line: any) => {
          const lineWords =
            line.arabic?.split(/\s+/).filter(Boolean) || [];
          let startMs: number | undefined;
          let endMs: number | undefined;

          for (const _lw of lineWords) {
            if (wordIdx < relativeWords.length) {
              if (startMs === undefined)
                startMs = Math.round(relativeWords[wordIdx].start * 1000);
              endMs = Math.round(relativeWords[wordIdx].end * 1000);
              wordIdx++;
            }
          }
          return { ...line, startMs, endMs };
        });
      } else if (captionLines && captionLines.length > 0 && lines.length > 0) {
        // Captions pipeline: map caption timestamps to analyzed lines
        // Simple proportional mapping: distribute caption timestamps across analysis lines
        const totalCaptionDuration = captionLines[captionLines.length - 1].endMs - captionLines[0].startMs;
        const avgLineMs = totalCaptionDuration / lines.length;
        const baseMs = captionLines[0].startMs;
        lines = lines.map((line: any, i: number) => ({
          ...line,
          startMs: Math.round(baseMs + i * avgLineMs),
          endMs: Math.round(baseMs + (i + 1) * avgLineMs),
        }));
      }

      // Ensure every line has a valid tokens array
      const sanitizedLines = lines.map((line: any) => ({
        ...line,
        tokens: Array.isArray(line.tokens)
          ? line.tokens
          : String(line.arabic ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .map((w: string, wi: number) => ({
                id: `tok-${line.id ?? wi}-${wi}`,
                surface: w,
              })),
      }));

      // Auto-generate title from first transcript line if missing
      let title = video.title;
      if ((!title || title === "Untitled Video") && result.title) {
        title = result.title;
      }
      let titleArabic = video.title_arabic;
      if (!titleArabic && result.titleArabic) {
        titleArabic = result.titleArabic;
      }

      // ── Step 4: Save results ────────────────────────────────────────
      console.log("[pipeline] Step 4: Saving results...");
      const { error: updateError } = await supabase
        .from("discover_videos")
        .update({
          title,
          title_arabic: titleArabic,
          transcript_lines: sanitizedLines,
          vocabulary: result.vocabulary || [],
          grammar_points: result.grammarPoints || [],
          cultural_context: result.culturalContext || null,
          dialect: result.dialect || "Gulf",
          difficulty: result.difficulty || "Intermediate",
          transcription_status: "completed",
          transcription_error: null,
        })
        .eq("id", videoId);

      if (updateError) {
        throw new Error(`Failed to save results: ${updateError.message}`);
      }

      console.log(
        `[pipeline] Completed! ${sanitizedLines.length} lines, ${(result.vocabulary || []).length} vocab items from ${engines.length} engine(s)`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[pipeline] Failed for video ${videoId}:`, errorMsg);

      await supabase
        .from("discover_videos")
        .update({
          transcription_status: "failed",
          transcription_error: errorMsg,
        })
        .eq("id", videoId);
    }
  })();

  // Wait for both the response and the pipeline to complete
  // The response is sent immediately, but Deno keeps running
  // We use waitUntil pattern via EdgeRuntime (available in Supabase Edge Functions)
  try {
    // @ts-ignore - Deno.serve context allows background work
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(pipelinePromise);
    }
  } catch {
    // Fallback: just let the promise run — Supabase edge functions
    // stay alive until all promises resolve
  }

  return responsePromise;
});
