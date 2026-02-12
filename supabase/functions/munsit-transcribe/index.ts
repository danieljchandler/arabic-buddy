import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MUNSIT_TIMEOUT_MS = 5 * 60 * 1000;

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
    const MUNSIT_API_KEY = Deno.env.get("MUNSIT_API_KEY")?.trim();
    if (!MUNSIT_API_KEY) {
      console.error("MUNSIT_API_KEY is not configured");
      throw new Error("MUNSIT_API_KEY is not configured");
    }
    console.log(`MUNSIT_API_KEY prefix: ${MUNSIT_API_KEY.substring(0, 10)}... (length: ${MUNSIT_API_KEY.length})`);

    let audioFile: File | null = null;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
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
      const fileSizeMB = (audioBlob.size / (1024 * 1024)).toFixed(2);
      console.log(`Downloaded audio: ${fileSizeMB} MB, type: ${audioBlob.type}`);

      audioFile = new File([audioBlob], "audio.mp3", { type: audioBlob.type || "audio/mpeg" });
    } else {
      const formData = await req.formData();
      audioFile = formData.get("audio") as File;
    }

    if (!audioFile) {
      console.error("No audio file provided");
      return new Response(
        JSON.stringify({ error: "No audio file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);
    console.log(`Processing file for Munsit: ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioFile.type}`);

    // Prepare request to Munsit API
    const apiFormData = new FormData();
    apiFormData.append("file", audioFile);
    apiFormData.append("model", "munsit-1");

    console.log("Sending request to Munsit API...");
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MUNSIT_TIMEOUT_MS);

    const response = await fetch("https://api.cntxt.tools/audio/transcribe", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MUNSIT_API_KEY}`,
      },
      body: apiFormData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Munsit responded in ${elapsedSec}s with status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Munsit API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Munsit transcription failed", details: errorText, status: response.status }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcription = await response.json();
    console.log("Munsit transcription completed successfully");
    console.log(`Munsit transcript length: ${transcription.text?.length || JSON.stringify(transcription).length} characters`);

    return new Response(JSON.stringify(transcription), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Munsit transcription error:", error);
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
