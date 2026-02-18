import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BRIGHT_DATA_API_KEY = Deno.env.get('BRIGHT_DATA_API_KEY');
    if (!BRIGHT_DATA_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'BRIGHT_DATA_API_KEY is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize X/Twitter URL
    const normalizedUrl = url.replace('https://x.com/', 'https://twitter.com/').replace('http://x.com/', 'https://twitter.com/');

    // Validate it's an X/Twitter post URL
    const isXPost = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
    if (!isXPost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid X (Twitter) post URL, e.g. https://x.com/username/status/123' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Scraping X post:', normalizedUrl);

    // Use Bright Data's Web Unlocker API to scrape the post
    const scrapeResponse = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: 'web_unlocker1',
        url: normalizedUrl,
        format: 'raw',
      }),
    });

    if (!scrapeResponse.ok) {
      const errorBody = await scrapeResponse.text();
      console.error('Bright Data error:', scrapeResponse.status, errorBody.slice(0, 500));
      return new Response(
        JSON.stringify({ success: false, error: `Bright Data scraping failed [${scrapeResponse.status}]: ${errorBody.slice(0, 200)}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await scrapeResponse.text();
    console.log('Got HTML, length:', html.length);

    // Extract tweet text from the HTML
    // Twitter renders tweet text in og:description meta tag or article elements
    const arabicText = extractTweetText(html);

    if (!arabicText) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not extract text from the post. The post may be private or the URL is invalid.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if the extracted text contains Arabic
    const hasArabic = /[\u0600-\u06FF]/.test(arabicText);
    if (!hasArabic) {
      return new Response(
        JSON.stringify({ success: false, error: 'No Arabic text found in this post. Please link to a post with Arabic content.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, text: arabicText }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Extract tweet text from Twitter/X HTML.
 * Tries multiple strategies in order of reliability.
 */
function extractTweetText(html: string): string | null {
  // Strategy 1: og:description meta tag (most reliable for server-rendered pages)
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  
  if (ogDescMatch?.[1]) {
    const text = decodeHtmlEntities(ogDescMatch[1]);
    // og:description often starts with username, strip it
    // Format: "username on X: \"tweet text\""
    const quoteMatch = text.match(/[""](.+)[""]$/s) ?? text.match(/:\s*["""](.+)["""]$/s);
    if (quoteMatch?.[1]) return quoteMatch[1].trim();
    // Fall through to return the full og:description
    if (text.length > 10) return text.trim();
  }

  // Strategy 2: Twitter card description
  const twitterDescMatch = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:description["']/i);
  
  if (twitterDescMatch?.[1]) {
    const text = decodeHtmlEntities(twitterDescMatch[1]);
    if (text.length > 5) return text.trim();
  }

  // Strategy 3: JSON-LD data
  const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const articleBody = data?.articleBody ?? data?.description;
      if (typeof articleBody === 'string' && articleBody.length > 5) {
        return decodeHtmlEntities(articleBody).trim();
      }
    } catch { /* ignore */ }
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
