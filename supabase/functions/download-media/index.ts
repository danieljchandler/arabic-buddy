import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Extract media URLs from HTML content.
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
    /"(?:contentUrl|embedUrl|video_url|playAddr|downloadAddr)"\s*:\s*"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
  }

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

    // Step 1: Check if URL is a direct media file
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
      console.log("HEAD check failed, continuing:", e);
    }

    // Step 2: Use Firecrawl to scrape the JS-rendered page
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

    let html = "";
    let scrapedUrl = url;

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
            url,
            formats: ["html", "links"],
            waitFor: 3000,
          }),
        });

        const fcData = await fcResp.json();
        if (fcResp.ok && fcData.success) {
          html = fcData.data?.html || fcData.html || "";
          scrapedUrl = fcData.data?.metadata?.sourceURL || url;
          console.log(`Firecrawl returned ${html.length} chars of HTML`);

          // Also check links for direct media files
          const links: string[] = fcData.data?.links || fcData.links || [];
          for (const link of links) {
            if (looksLikeMedia(link)) {
              console.log(`Found media in links: ${link.substring(0, 100)}`);
              return new Response(
                JSON.stringify({
                  audioUrl: link,
                  status: "tunnel",
                  filename: new URL(link).pathname.split('/').pop() || null,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } else {
          console.error("Firecrawl error:", fcData.error || fcResp.status);
        }
      } catch (e) {
        console.error("Firecrawl request failed:", e);
      }
    } else {
      console.log("No FIRECRAWL_API_KEY, falling back to simple fetch...");
      try {
        const pageResp = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          },
        });
        if (pageResp.ok) {
          html = await pageResp.text();
          scrapedUrl = pageResp.url || url;
          console.log(`Simple fetch returned ${html.length} chars`);
        }
      } catch (e) {
        console.error("Simple fetch failed:", e);
      }
    }

    if (!html) {
      return new Response(
        JSON.stringify({ error: "Could not fetch the page content. Please try uploading the file directly." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Extract media URLs from HTML
    const mediaUrls = extractMediaUrls(html, scrapedUrl);
    console.log(`Extracted ${mediaUrls.length} media URL candidates`);

    if (mediaUrls.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "لم يتم العثور على ملف وسائط في هذه الصفحة. حاول تحميل الملف مباشرة بدلاً من ذلك." 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Validate candidates
    for (const candidate of mediaUrls.slice(0, 5)) {
      try {
        console.log(`Validating: ${candidate.substring(0, 100)}`);
        const check = await fetch(candidate, { method: 'HEAD', redirect: 'follow' });
        const ct = check.headers.get('content-type') || '';

        if (looksLikeMedia(candidate, ct) || check.ok) {
          console.log(`Valid media found: ${ct || 'ok'}`);
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

    // Best effort: return first candidate
    console.log("Returning first candidate as best effort");
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
