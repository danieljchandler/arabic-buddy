import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB limit

/**
 * Extract media URLs from HTML content, including platform-specific JSON data.
 */
function extractMediaUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];

  const patterns = [
    /property="og:video(?::secure_url|:url)?"\s+content="([^"]+)"/gi,
    /content="([^"]+)"\s+property="og:video(?::secure_url|:url)?"/gi,
    /property="og:audio(?::secure_url|:url)?"\s+content="([^"]+)"/gi,
    /content="([^"]+)"\s+property="og:audio(?::secure_url|:url)?"/gi,
    /<video[^>]+src="([^"]+)"/gi,
    /<source[^>]+src="([^"]+)"/gi,
    /name="twitter:player:stream"\s+content="([^"]+)"/gi,
    /"(?:contentUrl|embedUrl|video_url)"\s*:\s*"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
  }

  // TikTok-specific patterns
  const tiktokPatterns = [
    /"playAddr"\s*:\s*"(https?:[^"]+)"/gi,
    /"downloadAddr"\s*:\s*"(https?:[^"]+)"/gi,
    /"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["(https?:[^"]+)"/gi,
    /"download_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["(https?:[^"]+)"/gi,
  ];

  for (const pattern of tiktokPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        const decoded = match[1].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&');
        urls.push(decoded);
      }
    }
  }

  // Generic video file URLs in JSON
  const genericVideoUrl = /https?:\\?\/\\?\/[^"'\s]+\.(?:mp4|mp3|m4a|webm|mov)(?:\\?\/[^"'\s]*)?/gi;
  let gMatch;
  while ((gMatch = genericVideoUrl.exec(html)) !== null) {
    const decoded = gMatch[0].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    urls.push(decoded);
  }

  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const raw of urls) {
    try {
      const clean = raw.replace(/\\\//g, '/').replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      const full = clean.startsWith('http') ? clean : new URL(clean, baseUrl).href;
      if (!seen.has(full)) {
        seen.add(full);
        resolved.push(full);
      }
    } catch { /* skip */ }
  }

  return resolved;
}

function looksLikeMedia(url: string, contentType?: string): boolean {
  if (contentType) {
    if (contentType.startsWith('audio/') || contentType.startsWith('video/')) return true;
    if (contentType === 'application/octet-stream') return true;
  }
  return /\.(mp3|mp4|m4a|wav|ogg|webm|mov|aac|flac)(\?|$)/i.test(url);
}

/**
 * Fetch actual audio bytes from a URL and return as base64.
 * Tries with browser-like headers to bypass CDN restrictions.
 */
async function fetchAudioAsBase64(mediaUrl: string): Promise<{ base64: string; contentType: string; size: number } | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': new URL(mediaUrl).origin + '/',
  };

  try {
    console.log(`Downloading audio from: ${mediaUrl.substring(0, 100)}...`);
    const resp = await fetch(mediaUrl, { headers, redirect: 'follow' });

    if (!resp.ok) {
      console.error(`Download failed: ${resp.status}`);
      return null;
    }

    const contentType = resp.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await resp.arrayBuffer();
    const size = arrayBuffer.byteLength;

    if (size > MAX_FILE_SIZE) {
      console.error(`File too large: ${(size / 1024 / 1024).toFixed(1)}MB`);
      return null;
    }

    console.log(`Downloaded ${(size / 1024 / 1024).toFixed(2)}MB, type: ${contentType}`);
    const base64 = base64Encode(new Uint8Array(arrayBuffer));

    return { base64, contentType, size };
  } catch (e) {
    console.error(`fetchAudioAsBase64 error:`, e);
    return null;
  }
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

    // Auto-prepend https://
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    console.log(`Processing URL: ${normalizedUrl}`);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
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

    // Step 1: Check if URL is a direct media file and download it
    try {
      const headResp = await fetch(normalizedUrl, { method: 'HEAD', redirect: 'follow' });
      const ct = headResp.headers.get('content-type') || '';
      const finalUrl = headResp.url || normalizedUrl;

      if (looksLikeMedia(finalUrl, ct)) {
        console.log(`Direct media URL detected (${ct}), downloading...`);
        const audioData = await fetchAudioAsBase64(finalUrl);
        if (audioData) {
          return new Response(
            JSON.stringify({
              audioBase64: audioData.base64,
              contentType: audioData.contentType,
              size: audioData.size,
              filename: new URL(finalUrl).pathname.split('/').pop() || 'audio.mp4',
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } catch (e) {
      console.log("HEAD check failed, continuing:", e);
    }

    // Step 2: Use Firecrawl or simple fetch to get page HTML
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    let html = "";
    let scrapedUrl = normalizedUrl;

    if (firecrawlKey) {
      console.log("Using Firecrawl to scrape JS-rendered page...");
      try {
        const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: normalizedUrl,
            formats: ["html", "links"],
            waitFor: 3000,
          }),
        });

        const fcData = await fcResp.json();
        if (fcResp.ok && fcData.success) {
          html = fcData.data?.html || fcData.html || "";
          scrapedUrl = fcData.data?.metadata?.sourceURL || normalizedUrl;
          console.log(`Firecrawl returned ${html.length} chars of HTML`);

          // Check links for direct media
          const links: string[] = fcData.data?.links || fcData.links || [];
          for (const link of links) {
            if (looksLikeMedia(link)) {
              console.log(`Found media in links, downloading: ${link.substring(0, 100)}`);
              const audioData = await fetchAudioAsBase64(link);
              if (audioData) {
                return new Response(
                  JSON.stringify({
                    audioBase64: audioData.base64,
                    contentType: audioData.contentType,
                    size: audioData.size,
                    filename: new URL(link).pathname.split('/').pop() || 'audio.mp4',
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
            }
          }
        } else {
          console.log("Firecrawl failed or unsupported, falling back:", fcData.error || fcResp.status);
        }
      } catch (e) {
        console.log("Firecrawl request failed, falling back:", e);
      }
    }

    // Fallback: simple fetch
    if (!html) {
      console.log("Using simple fetch to get page HTML...");
      try {
        const pageResp = await fetch(normalizedUrl, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          },
        });
        if (pageResp.ok) {
          html = await pageResp.text();
          scrapedUrl = pageResp.url || normalizedUrl;
          console.log(`Simple fetch returned ${html.length} chars`);
        }
      } catch (e) {
        console.error("Simple fetch also failed:", e);
      }
    }

    if (!html) {
      return new Response(
        JSON.stringify({ error: "Could not fetch the page content. Please try uploading the file directly." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Extract media URLs
    const mediaUrls = extractMediaUrls(html, scrapedUrl);
    console.log(`Extracted ${mediaUrls.length} media URL candidates`);

    if (mediaUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: "لم يتم العثور على ملف وسائط في هذه الصفحة. حاول تحميل الملف مباشرة بدلاً من ذلك." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Try to download each candidate
    for (const candidate of mediaUrls.slice(0, 5)) {
      const audioData = await fetchAudioAsBase64(candidate);
      if (audioData) {
        return new Response(
          JSON.stringify({
            audioBase64: audioData.base64,
            contentType: audioData.contentType,
            size: audioData.size,
            filename: new URL(candidate).pathname.split('/').pop() || 'audio.mp4',
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "تعذر تحميل ملف الوسائط. حاول تحميل الملف مباشرة بدلاً من ذلك." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("download-media error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
