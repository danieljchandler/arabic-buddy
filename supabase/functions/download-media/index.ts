import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Extract media URLs from HTML using regex patterns.
 * Looks for og:video, og:audio, video source tags, and direct media links.
 */
function extractMediaUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];

  // Open Graph video/audio meta tags
  const ogPatterns = [
    /property="og:video(?::secure_url|:url)?"\s+content="([^"]+)"/gi,
    /content="([^"]+)"\s+property="og:video(?::secure_url|:url)?"/gi,
    /property="og:audio(?::secure_url|:url)?"\s+content="([^"]+)"/gi,
    /content="([^"]+)"\s+property="og:audio(?::secure_url|:url)?"/gi,
  ];

  for (const pattern of ogPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
  }

  // <video src="..."> and <source src="...">
  const videoSrcPatterns = [
    /<video[^>]+src="([^"]+)"/gi,
    /<source[^>]+src="([^"]+)"[^>]*type="(?:video|audio)\/[^"]+"/gi,
    /<source[^>]+src="([^"]+)"/gi,
  ];

  for (const pattern of videoSrcPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
  }

  // Twitter/X player card
  const twitterPlayer = /name="twitter:player:stream"\s+content="([^"]+)"/gi;
  let m;
  while ((m = twitterPlayer.exec(html)) !== null) {
    if (m[1]) urls.push(m[1]);
  }

  // JSON-LD contentUrl / embedUrl
  const jsonLdPattern = /"(?:contentUrl|embedUrl)"\s*:\s*"([^"]+)"/gi;
  while ((m = jsonLdPattern.exec(html)) !== null) {
    if (m[1]) urls.push(m[1]);
  }

  // Deduplicate and resolve relative URLs
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const raw of urls) {
    try {
      const full = raw.startsWith('http') ? raw : new URL(raw, baseUrl).href;
      const decoded = full.replace(/&amp;/g, '&');
      if (!seen.has(decoded)) {
        seen.add(decoded);
        resolved.push(decoded);
      }
    } catch {
      // skip invalid URLs
    }
  }

  return resolved;
}

/**
 * Check if a URL points to a media file by content type or extension.
 */
function looksLikeMedia(url: string, contentType?: string): boolean {
  if (contentType) {
    if (contentType.startsWith('audio/') || contentType.startsWith('video/')) return true;
    if (contentType === 'application/octet-stream') return true;
  }
  return /\.(mp3|mp4|m4a|wav|ogg|webm|mov|aac|flac)(\?|$)/i.test(url);
}

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

    // Step 1: Try HEAD request to see if URL is direct media
    try {
      const headResp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      const ct = headResp.headers.get('content-type') || '';
      const finalUrl = headResp.url || url;

      if (looksLikeMedia(finalUrl, ct)) {
        console.log(`Direct media URL detected (${ct})`);
        return new Response(
          JSON.stringify({
            audioUrl: finalUrl,
            status: "redirect",
            filename: new URL(finalUrl).pathname.split('/').pop() || null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (e) {
      console.log("HEAD request failed, trying GET:", e);
    }

    // Step 2: Fetch the page HTML and extract embedded media URLs
    console.log("Fetching page HTML to extract media...");
    const pageResp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    });

    if (!pageResp.ok) {
      return new Response(
        JSON.stringify({ error: `Could not access URL (HTTP ${pageResp.status})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const finalUrl = pageResp.url || url;
    const html = await pageResp.text();
    console.log(`Fetched ${html.length} chars of HTML from ${finalUrl}`);

    const mediaUrls = extractMediaUrls(html, finalUrl);
    console.log(`Found ${mediaUrls.length} candidate media URLs`);

    if (mediaUrls.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "Could not find any media on this page. Try using a direct link to an audio/video file, or download the file and upload it instead." 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Validate candidates — pick the first one that responds as media
    for (const candidate of mediaUrls) {
      try {
        console.log(`Checking candidate: ${candidate.substring(0, 100)}`);
        const check = await fetch(candidate, { method: 'HEAD', redirect: 'follow' });
        const ct = check.headers.get('content-type') || '';

        if (looksLikeMedia(candidate, ct) || check.ok) {
          console.log(`Found valid media: ${ct}`);
          return new Response(
            JSON.stringify({
              audioUrl: check.url || candidate,
              status: "tunnel",
              filename: new URL(candidate).pathname.split('/').pop() || null,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        console.log(`Candidate failed: ${e}`);
      }
    }

    // If no candidate validated, return the first one anyway (best effort)
    console.log("No candidate validated via HEAD, returning first match");
    return new Response(
      JSON.stringify({
        audioUrl: mediaUrls[0],
        status: "tunnel",
        filename: null,
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
