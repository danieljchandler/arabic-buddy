import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Follow redirects manually to get final URL
    let finalUrl = url;
    let attempts = 0;
    while (attempts < 10) {
      const res = await fetch(finalUrl, { redirect: "manual" });
      const location = res.headers.get("location");
      if (!location) {
        // If no redirect, try reading the response for meta refresh or final URL
        if (res.status >= 200 && res.status < 400) {
          break;
        }
        break;
      }
      finalUrl = location.startsWith("http") ? location : new URL(location, finalUrl).href;
      attempts++;
    }

    // Extract video ID from the resolved URL
    // Format: tiktok.com/@user/video/1234567890
    const videoIdMatch = finalUrl.match(/\/video\/(\d+)/);
    const videoId = videoIdMatch?.[1] || "";

    return new Response(
      JSON.stringify({
        resolvedUrl: finalUrl,
        videoId,
        embedUrl: videoId
          ? `https://www.tiktok.com/player/v1/${videoId}`
          : finalUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error resolving TikTok URL:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
