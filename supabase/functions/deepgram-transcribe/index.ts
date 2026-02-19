import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DEEPGRAM_TIMEOUT_MS = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const authToken = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(authToken);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      console.error("DEEPGRAM_API_KEY is not configured");
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    let audioBytes: ArrayBuffer | null = null;
    let audioMimeType = "audio/mpeg";

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // URL-based input — download first so we control headers (avoids CDN 403s)
      const body = await req.json();
      const { audioUrl } = body;

      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl is required for JSON requests" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Fetching audio from URL: ${audioUrl.substring(0, 100)}...`);

      const audioResponse = await fetch(audioUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': new URL(audioUrl).origin + '/',
          'Accept': '*/*',
        },
      });

      if (!audioResponse.ok) {
        console.error(`Failed to fetch audio: ${audioResponse.status}`);
        return new Response(
          JSON.stringify({ error: "Failed to fetch audio from URL", status: audioResponse.status }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const audioBlob = await audioResponse.blob();
      audioMimeType = audioBlob.type || "audio/mpeg";
      audioBytes = await audioBlob.arrayBuffer();
      const fileSizeMB = (audioBytes.byteLength / (1024 * 1024)).toFixed(2);
      console.log(`Downloaded audio: ${fileSizeMB} MB, type: ${audioMimeType}`);
    } else {
      // FormData-based input
      const formData = await req.formData();
      const audioFile = (formData.get("audio") || formData.get("file")) as File;

      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      audioMimeType = audioFile.type || "audio/mpeg";
      audioBytes = await audioFile.arrayBuffer();
      const fileSizeMB = (audioBytes.byteLength / (1024 * 1024)).toFixed(2);
      console.log(`Processing file: ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioMimeType}`);
    }

    if (!audioBytes) {
      return new Response(
        JSON.stringify({ error: "No audio data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Deepgram pre-recorded audio API
    const deepgramUrl = new URL("https://api.deepgram.com/v1/listen");
    deepgramUrl.searchParams.set("model", "nova-3");
    deepgramUrl.searchParams.set("language", "ar");
    deepgramUrl.searchParams.set("diarize", "true");
    deepgramUrl.searchParams.set("punctuate", "true");
    deepgramUrl.searchParams.set("smart_format", "true");

    console.log("Sending request to Deepgram API...");
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);

    const response = await fetch(deepgramUrl.toString(), {
      method: "POST",
      headers: {
        "Authorization": `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": audioMimeType,
      },
      body: audioBytes,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Deepgram responded in ${elapsedSec}s with status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Deepgram API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Transcription failed", details: errorText, status: response.status }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deepgramResult = await response.json();

    // Normalize Deepgram response to the shared transcription format:
    // { text: string, words: Array<{ text, start, end, speaker? }> }
    const alternative = deepgramResult?.results?.channels?.[0]?.alternatives?.[0];
    const text: string = alternative?.transcript ?? "";
    // deno-lint-ignore no-explicit-any
    const rawWords: any[] = alternative?.words ?? [];

    const words = rawWords.map((w) => ({
      text: w.punctuated_word ?? w.word ?? "",
      start: w.start as number,
      end: w.end as number,
      // Deepgram returns speaker as an integer; convert to "speaker_N" string
      speaker: w.speaker !== undefined ? `speaker_${w.speaker}` : undefined,
    }));

    console.log(`Transcription completed: ${text.length} chars, ${words.length} words`);

    return new Response(JSON.stringify({ text, words }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Transcription error:", error);
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "Request timed out - audio file may be too long. Try a shorter clip.";
      } else {
        errorMessage = error.message;
      }
    }
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
