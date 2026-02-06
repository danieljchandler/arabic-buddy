import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing URL: ${url}`);

    // Validate URL pattern (YouTube, TikTok, Instagram, X/Twitter)
    const supportedPatterns = [
      /youtube\.com\/watch/i,
      /youtu\.be\//i,
      /youtube\.com\/shorts/i,
      /tiktok\.com/i,
      /instagram\.com\/(reel|p)\//i,
      /twitter\.com\/.+\/status/i,
      /x\.com\/.+\/status/i,
    ];

    const isSupported = supportedPatterns.some(pattern => pattern.test(url));
    if (!isSupported) {
      return new Response(
        JSON.stringify({ error: "Unsupported URL. Supported: YouTube, TikTok, Instagram, X/Twitter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const COBALT_API_URL = Deno.env.get("COBALT_API_URL") || "https://api.cobalt.tools";
    console.log(`Using Cobalt API: ${COBALT_API_URL}`);

    const cobaltResponse = await fetch(`${COBALT_API_URL}/`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        downloadMode: "audio",
        audioFormat: "mp3",
      }),
    });

    if (!cobaltResponse.ok) {
      const errorText = await cobaltResponse.text();
      console.error(`Cobalt API error: ${cobaltResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to process URL", details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cobaltData = await cobaltResponse.json();
    console.log("Cobalt response status:", cobaltData.status);

    // Cobalt returns different statuses: "tunnel", "redirect", "stream", "error"
    if (cobaltData.status === "error") {
      return new Response(
        JSON.stringify({ error: cobaltData.text || "Cobalt could not process this URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioUrl = cobaltData.url;
    if (!audioUrl) {
      return new Response(
        JSON.stringify({ error: "No audio URL returned from Cobalt" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully got audio URL from Cobalt");

    return new Response(
      JSON.stringify({
        audioUrl,
        status: cobaltData.status,
        filename: cobaltData.filename || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("download-media error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
