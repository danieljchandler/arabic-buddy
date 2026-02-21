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
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      console.error("DEEPGRAM_API_KEY is not configured");
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    const deepgramParams = new URLSearchParams({
      model: "nova-3",
      language: "ar",
      diarize: "true",
      punctuate: "true",
      smart_format: "true",
    });
    const deepgramUrl = `https://api.deepgram.com/v1/listen?${deepgramParams}`;

    const contentType = req.headers.get("content-type") || "";

    console.log("Sending request to Deepgram API...");
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);

    let response: Response;

    if (contentType.includes("application/json")) {
      // URL-based input: fetch the file from storage and stream it directly to
      // Deepgram. Streaming (body: audioResponse.body) avoids buffering the
      // entire file in edge function memory, so large video files work fine.
      const body = await req.json();
      const { audioUrl } = body;

      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl is required for JSON requests" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Fetching and streaming to Deepgram: ${audioUrl.substring(0, 100)}...`);

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok || !audioResponse.body) {
        console.error(`Failed to fetch audio from storage: ${audioResponse.status}`);
        return new Response(
          JSON.stringify({ error: `Failed to fetch audio from storage: ${audioResponse.status}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const audioContentType = audioResponse.headers.get("content-type") || "audio/mpeg";
      console.log(`Streaming file to Deepgram, content-type: ${audioContentType}`);

      response = await fetch(deepgramUrl, {
        method: "POST",
        headers: {
          "Authorization": `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": audioContentType,
        },
        body: audioResponse.body,
        signal: controller.signal,
      });
    } else {
      // FormData-based input: buffer and forward bytes (small audio files only)
      const formData = await req.formData();
      const audioFile = (formData.get("audio") || formData.get("file")) as File;

      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const audioMimeType = audioFile.type || "audio/mpeg";
      const audioBytes = await audioFile.arrayBuffer();
      const fileSizeMB = (audioBytes.byteLength / (1024 * 1024)).toFixed(2);
      console.log(`Processing file: ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioMimeType}`);

      response = await fetch(deepgramUrl, {
        method: "POST",
        headers: {
          "Authorization": `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": audioMimeType,
        },
        body: audioBytes,
        signal: controller.signal,
      });
    }

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
