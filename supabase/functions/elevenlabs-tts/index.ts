import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Voices this function is allowed to synthesize. Callers can only pick from
// this set; anything else falls back to the default, so an attacker can't
// select arbitrary/premium ElevenLabs voices by injecting a voiceId.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const ALLOWED_VOICE_IDS = new Set<string>([DEFAULT_VOICE_ID]);

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // This function runs with verify_jwt=false; there is NO gateway auth. The
  // daily cap below is the only access control — it requires a signed-in user
  // and blocks anonymous abuse of the paid TTS API. Paid/admin users bypass.
  const cap = await enforceDailyCap(req, "elevenlabs-tts", 300, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { text, voiceId: requestedVoiceId } = await req.json();
    const voiceId = ALLOWED_VOICE_IDS.has(requestedVoiceId) ? requestedVoiceId : DEFAULT_VOICE_ID;

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating TTS for: "${text}" with voice: ${voiceId}`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.3,        // Lower for natural Arabic prosody/tonal variation
            similarity_boost: 0.8, // High for voice clarity
            style: 0.7,           // Higher for expressive Arabic inflection
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs API error [${response.status}]:`, errorText);
      return new Response(
        JSON.stringify({ error: `ElevenLabs API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    console.log(`Generated audio: ${audioBuffer.byteLength} bytes`);

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "TTS generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
