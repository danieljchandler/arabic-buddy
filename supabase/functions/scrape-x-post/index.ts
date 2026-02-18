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
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate it's an X/Twitter post URL
    const isXPost = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
    if (!isXPost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid X (Twitter) post URL, e.g. https://x.com/username/status/123' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Scraping X post via Jina Reader:', url);

    const jinaUrl = `https://r.jina.ai/${url}`;
    const jinaHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'X-Return-Format': 'markdown',
      'X-No-Cache': 'true',
    };

    // Optional: use API key for higher rate limits (free to register at jina.ai)
    const JINA_API_KEY = Deno.env.get('JINA_API_KEY');
    if (JINA_API_KEY) {
      jinaHeaders['Authorization'] = `Bearer ${JINA_API_KEY}`;
    }

    const jinaResponse = await fetch(jinaUrl, { headers: jinaHeaders });

    if (!jinaResponse.ok) {
      const errText = await jinaResponse.text();
      console.error('Jina Reader error:', jinaResponse.status, errText.slice(0, 300));
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch post [${jinaResponse.status}]. The post may be private or unavailable.` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await jinaResponse.json();
    console.log('Jina Reader response keys:', Object.keys(data?.data ?? {}));

    const arabicText = extractArabicText(data);

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
 * Extract tweet text from Jina Reader's JSON response.
 * Jina returns { data: { title, description, content, url } }.
 * For X posts, the title is typically: 'Username on X: "tweet text"'
 */
function extractArabicText(jinaData: unknown): string | null {
  const data = (jinaData as { data?: { title?: string; description?: string; content?: string } })?.data;
  if (!data) return null;

  // Strategy 1: Extract tweet text from title (format: `Username on X: "tweet text"`)
  const title = data.title ?? '';
  if (title) {
    // Match quoted portion after the colon
    const quoteMatch = title.match(/[""\u201C\u201D](.+?)[""\u201C\u201D]\s*$/s)
      ?? title.match(/:\s*[""\u201C\u201D](.+)/s);
    if (quoteMatch?.[1]?.trim().length > 5) return quoteMatch[1].trim();
    // If no quotes, take everything after ": "
    const colonMatch = title.match(/:\s*(.+)/s);
    if (colonMatch?.[1]?.trim().length > 5) return colonMatch[1].trim();
  }

  // Strategy 2: description field (often the tweet text directly)
  const description = data.description ?? '';
  if (description.trim().length > 5) return description.trim();

  // Strategy 3: Pull Arabic lines from the markdown content
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
