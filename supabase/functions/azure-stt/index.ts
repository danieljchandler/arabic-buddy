/**
 * azure-stt — Azure Speech Services batch transcription for Arabic.
 *
 * Routes by dialect module to the locale Azure speaks best:
 *   Egyptian → ar-EG
 *   Yemeni   → ar-YE
 *   Gulf     → ar-SA  (Najdi/Hijazi gives best Gulf coverage)
 *
 * Returns: { text, words, azureUsed } where words = [{ text, start, end }] in seconds.
 *
 * Uses the Azure "Fast Transcription" REST endpoint (synchronous, no job polling)
 * via the existing AZURE_SPEECH_KEY / AZURE_SPEECH_REGION secrets.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AZURE_TIMEOUT_MS = 5 * 60 * 1000;

function localeForDialect(dialectModule: string | undefined): string {
  if (dialectModule === "Egyptian") return "ar-EG";
  if (dialectModule === "Yemeni") return "ar-YE";
  return "ar-SA";
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

  try {
    // Allow service-role internal calls (from process-approved-video) without auth check
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isInternalCall = !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
    if (!isInternalCall) {
      const supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY");
    const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION");
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
      console.error("azure-stt: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not configured");
      return new Response(
        JSON.stringify({ text: null, azureUsed: false, reason: "azure_not_configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Two input modes: JSON {audioUrl, dialectModule} OR multipart form-data {audio, dialectModule}
    const contentType = req.headers.get("content-type") || "";
    let audioBytes: ArrayBuffer | null = null;
    let audioMime = "audio/mpeg";
    let dialectModule: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      dialectModule = body.dialectModule;
      const audioUrl: string | undefined = body.audioUrl;
      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const resp = await fetch(audioUrl);
      if (!resp.ok) {
        return new Response(
          JSON.stringify({ text: null, azureUsed: false, reason: `audio_fetch_${resp.status}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      audioBytes = await resp.arrayBuffer();
      audioMime = resp.headers.get("content-type") || audioMime;
    } else {
      const fd = await req.formData();
      const audioFile = (fd.get("audio") || fd.get("file")) as File | null;
      dialectModule = (fd.get("dialectModule") as string | null) ?? undefined;
      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      audioBytes = await audioFile.arrayBuffer();
      audioMime = audioFile.type || audioMime;
    }

    const locale = localeForDialect(dialectModule);
    console.log(`azure-stt: ${(audioBytes!.byteLength / 1024 / 1024).toFixed(2)}MB, locale=${locale}`);

    // Azure Fast Transcription API (synchronous):
    //   POST https://{region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15
    //   multipart/form-data: audio=<bytes>, definition=<json>
    const definition = {
      locales: [locale],
      profanityFilterMode: "None",
      // diarization is enabled by default in fast transcription
    };

    const apiForm = new FormData();
    apiForm.append("audio", new Blob([audioBytes!], { type: audioMime }), "audio");
    apiForm.append("definition", JSON.stringify(definition));

    const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AZURE_TIMEOUT_MS);
    const start = Date.now();

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
        },
        body: apiForm,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      console.error("azure-stt fetch failed:", isAbort ? "timeout" : String(e));
      return new Response(
        JSON.stringify({ text: null, azureUsed: false, reason: isAbort ? "timeout" : "fetch_error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    clearTimeout(timer);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`azure-stt: Azure responded in ${elapsed}s, status=${resp.status}`);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`azure-stt: HTTP ${resp.status}: ${errText.slice(0, 400)}`);
      return new Response(
        JSON.stringify({ text: null, azureUsed: false, reason: `azure_${resp.status}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    // Fast transcription response shape:
    // { duration, combinedPhrases: [{text}], phrases: [{text, offset, duration, words: [{text, offset, duration}]}] }
    const text: string =
      (data.combinedPhrases?.[0]?.text as string | undefined) ??
      ((data.phrases ?? []).map((p: any) => p.text).filter(Boolean).join(" ") as string) ??
      "";

    const words: Array<{ text: string; start: number; end: number }> = [];
    for (const phrase of data.phrases ?? []) {
      for (const w of phrase.words ?? []) {
        const startSec = (w.offset ?? 0) / 1000;
        const endSec = ((w.offset ?? 0) + (w.duration ?? 0)) / 1000;
        if (w.text) words.push({ text: w.text, start: startSec, end: endSec });
      }
    }

    console.log(`azure-stt: ${text.length} chars, ${words.length} words`);

    return new Response(
      JSON.stringify({ text, words, azureUsed: true, locale }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("azure-stt error:", error);
    return new Response(
      JSON.stringify({
        text: null,
        azureUsed: false,
        reason: error instanceof Error ? error.message : "unknown",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
