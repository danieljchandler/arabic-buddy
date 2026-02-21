import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ElevenLabs can take several minutes for long recordings
const ELEVENLABS_TIMEOUT_MS = 5 * 60 * 1000;

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
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY is not configured");
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    let audioFile: File | null = null;

    // Check content type to determine input method
    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      // URL-based input
      const body = await req.json();
      const { audioUrl } = body;
      
      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl is required for JSON requests" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Fetching audio from URL: ${audioUrl.substring(0, 100)}...`);
      
      // Use proper headers to avoid 403 from CDNs (TikTok, etc.)
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
      const fileSizeMB = (audioBlob.size / (1024 * 1024)).toFixed(2);
      console.log(`Downloaded audio: ${fileSizeMB} MB, type: ${audioBlob.type}`);
      
      audioFile = new File([audioBlob], "audio.mp3", { type: audioBlob.type || "audio/mpeg" });
    } else {
      // FormData-based input (existing behavior)
      const formData = await req.formData();
      audioFile = (formData.get("audio") || formData.get("file")) as File;
    }

    if (!audioFile) {
      console.error("No audio file provided");
      return new Response(
        JSON.stringify({ error: "No audio file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);
    console.log(`Processing file: ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioFile.type}`);
    
    const estimatedDurationMin = Math.max(1, Math.ceil(audioFile.size / (1024 * 1024) / 2));
    console.log(`Estimated processing time: ~${estimatedDurationMin} minute(s)`);

    // Prepare the request to ElevenLabs Scribe v2
    const apiFormData = new FormData();
    apiFormData.append("file", audioFile);
    apiFormData.append("model_id", "scribe_v2");
    apiFormData.append("language_code", "ara");
    apiFormData.append("tag_audio_events", "true");
    apiFormData.append("diarize", "true");
    
    const keyterms = [
      "شلونك", "يا ريال", "شسوي", "الحين", "وش",
      "ليش", "وين", "حلو", "زين", "ماشاءالله", "انشاءالله",
    ];
    
    keyterms.forEach(term => {
      apiFormData.append("keyterms", term);
    });

    console.log("Sending request to ElevenLabs Scribe v2 API...");
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: apiFormData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`ElevenLabs responded in ${elapsedSec}s with status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Transcription failed", details: errorText, status: response.status }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcription = await response.json();
    console.log("Transcription completed successfully");
    console.log(`Transcript length: ${transcription.text?.length || 0} characters, words: ${transcription.words?.length || 0}`);

    return new Response(JSON.stringify(transcription), {
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
