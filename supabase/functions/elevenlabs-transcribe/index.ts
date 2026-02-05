import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

 // ElevenLabs can take several minutes for long recordings
 // Set a generous timeout (5 minutes)
 const ELEVENLABS_TIMEOUT_MS = 5 * 60 * 1000;
 
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY is not configured");
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      console.error("No audio file provided");
      return new Response(
        JSON.stringify({ error: "No audio file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

     const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);
     console.log(`Processing file: ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioFile.type}`);
     
     // Estimate expected processing time (ElevenLabs ~1min per 10min of audio)
     const estimatedDurationMin = Math.max(1, Math.ceil(audioFile.size / (1024 * 1024) / 2));
     console.log(`Estimated processing time: ~${estimatedDurationMin} minute(s)`);

    // Prepare the request to ElevenLabs Scribe v2
    const apiFormData = new FormData();
    apiFormData.append("file", audioFile);
    apiFormData.append("model_id", "scribe_v2");
    apiFormData.append("language_code", "ara"); // Arabic
    apiFormData.append("tag_audio_events", "true");
    apiFormData.append("diarize", "true");
    
    // Keyterm prompting for Gulf Arabic (Khaleeji) terms
    // These terms help bias the model for better accuracy with common Gulf Arabic expressions
    // Each keyterm must be appended individually, not as a JSON array
    const keyterms = [
      "شلونك",    // How are you (Khaleeji)
      "يا ريال",  // Hey man (Khaleeji) - simplified spelling
      "شسوي",     // What am I doing (Khaleeji)
      "الحين",    // Now (Khaleeji)
      "وش",       // What (Khaleeji)
      "ليش",      // Why (Khaleeji)
      "وين",      // Where (Khaleeji)
      "حلو",      // Nice/Good
      "زين",      // Good (Khaleeji)
      "ماشاءالله", // MashaAllah (no spaces)
      "انشاءالله", // InshaAllah (no spaces)
    ];
    
    // Append each keyterm individually
    keyterms.forEach(term => {
      apiFormData.append("keyterms", term);
    });

     console.log("Sending request to ElevenLabs Scribe v2 API (this may take several minutes for long recordings)...");
     const startTime = Date.now();

     // Create abort controller for timeout
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
        JSON.stringify({ 
          error: "Transcription failed", 
          details: errorText,
          status: response.status 
        }),
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
