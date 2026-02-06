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

    console.log(`Processing direct media URL: ${url}`);

    // Validate it looks like a URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({ error: "Only HTTP/HTTPS URLs are supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the remote file to verify it's accessible and get content type
    const headResp = await fetch(url, { method: 'HEAD' });
    if (!headResp.ok) {
      console.error(`HEAD request failed: ${headResp.status}`);
      return new Response(
        JSON.stringify({ error: `Could not access URL (HTTP ${headResp.status})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentType = headResp.headers.get('content-type') || '';
    const isMedia = contentType.startsWith('audio/') || contentType.startsWith('video/') || 
                    contentType === 'application/octet-stream' ||
                    /\.(mp3|wav|m4a|ogg|mp4|webm|mov|aac|flac)$/i.test(parsedUrl.pathname);

    if (!isMedia) {
      console.log(`Content-Type: ${contentType}, path: ${parsedUrl.pathname}`);
      return new Response(
        JSON.stringify({ error: "URL does not appear to point to an audio/video file. Please use a direct link to a media file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("URL validated as media, returning direct URL");

    return new Response(
      JSON.stringify({
        audioUrl: url,
        status: "redirect",
        filename: parsedUrl.pathname.split('/').pop() || null,
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
