import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceAnonymousDailyCap } from "../_shared/usageCap.ts";

type JinaResponse = {
  data?: { title?: string; description?: string; content?: string };
};

/**
 * An X/Twitter status URL, decided by parsing rather than by substring.
 *
 * Host equality (plus `www.`) and a `/{handle}/status/{id}` path — anything
 * else, including a URL that merely embeds one, is refused.
 */
function isXPostUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'twitter.com' && host !== 'x.com') return false;
  return /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(parsed.pathname);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // The URL below is concatenated into a Jina Reader request on our API key.
  // Unmetered and unauthenticated, that is a fetch-proxy anyone may point
  // anywhere; the cap is what makes it a feature rather than an offer.
  const cap = await enforceAnonymousDailyCap(req, 'scrape-x-post', 20, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate it's an X/Twitter post URL.
    //
    // This test used to be an unanchored regex, which asks "does an X post URL
    // appear anywhere in this string" — so `https://attacker.tld/?u=https://x.com/a/status/1`
    // passed it and was then fetched. Parse the URL and compare the host, the
    // way `download-media` does, rather than pattern-matching a string that
    // only has to *contain* the right shape.
    const isXPost = isXPostUrl(url);
    if (!isXPost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid X (Twitter) post URL, e.g. https://x.com/username/status/123' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const JINA_API_KEY = Deno.env.get('JINA_API_KEY');

    // Try free tier first, fall back to authenticated if it fails or returns no text
    console.log('Attempting Jina Reader (free tier)...');
    let arabicText = await fetchFromJina(url, null);

    if (!arabicText && JINA_API_KEY) {
      console.log('Free tier returned no text, retrying with API key...');
      arabicText = await fetchFromJina(url, JINA_API_KEY);
    }

    if (!arabicText) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not extract text from the post. The post may be private or the URL is invalid.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasArabic = /[\u0600-\u06FF]/.test(arabicText);
    if (!hasArabic) {
      return new Response(
        JSON.stringify({ success: false, error: 'No Arabic text found in this post. Please link to a post with Arabic content.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Extracted Arabic text, length:', arabicText.length);
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
 * Fetch an X post via Jina Reader. Pass apiKey=null to use the free tier.
 * Returns the extracted Arabic text, or null if the request failed or yielded nothing useful.
 */
async function fetchFromJina(url: string, apiKey: string | null): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Return-Format': 'markdown',
    'X-No-Cache': 'true',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(jinaUrl, { headers });
  } catch (err) {
    console.error('Jina fetch error:', err);
    return null;
  }

  if (!response.ok) {
    console.warn(`Jina Reader [${apiKey ? 'authenticated' : 'free'}] responded ${response.status}`);
    return null;
  }

  let data: JinaResponse;
  try {
    data = await response.json();
  } catch {
    console.warn('Jina Reader returned non-JSON body');
    return null;
  }

  console.log(`Jina [${apiKey ? 'authenticated' : 'free'}] response keys:`, Object.keys(data?.data ?? {}));
  return extractArabicText(data);
}

/**
 * Extract tweet text from Jina Reader's JSON response.
 * Jina returns { data: { title, description, content, url } }.
 *
 * X post titles look like: 'Username on X: "tweet text" / X'
 * Note the trailing ' / X' after the closing quote — we strip it.
 */
function extractArabicText(jinaData: JinaResponse): string | null {
  const data = jinaData?.data;
  if (!data) return null;

  // Strategy 1: Extract tweet text from title.
  // Handles the ' / X' suffix that X appends after the closing quote.
  const title = data.title ?? '';
  if (title) {
    const m = title.match(/:\s*"([\s\S]+?)"\s*\/\s*X\s*$/i)  // "text" / X  (most common)
           ?? title.match(/:\s*"([\s\S]+?)"\s*$/s)             // "text" at end
           ?? title.match(/:\s*"([\s\S]+)/s);                  // "text... (no closing quote)
    if (m?.[1]) {
      const text = m[1]
        .replace(/"\s*\/\s*X\s*$/i, '')  // strip stray trailing " / X
        .replace(/"$/, '')               // strip stray trailing quote
        .trim();
      if (text.length > 5) return text;
    }
  }

  // Strategy 2: description field (sometimes populated directly with tweet text)
  const description = data.description ?? '';
  if (description.trim().length > 5) return description.trim();

  // Strategy 3: Pull Arabic lines from the markdown content body
  const content = data.content ?? '';
  if (content) {
    const arabicLines = content
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0 && /[\u0600-\u06FF]/.test(l));
    if (arabicLines.length > 0) return arabicLines.join('\n');
  }

  return null;
}
