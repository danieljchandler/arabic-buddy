import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    console.log(`Processing file: ${audioFile.name}, size: ${audioFile.size} bytes, type: ${audioFile.type}`);

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

    console.log("Sending request to ElevenLabs Scribe v2 API...");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: apiFormData,
    });

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
    console.log(`Transcript length: ${transcription.text?.length || 0} characters`);

    return new Response(JSON.stringify(transcription), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
