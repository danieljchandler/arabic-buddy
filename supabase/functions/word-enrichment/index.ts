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
    const { word, dialect, sentenceArabic, sentenceEnglish, isPhrase: isPhraseFlag } = await req.json();
    if (!word || typeof word !== 'string') {
      return new Response(JSON.stringify({ error: 'word is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dialectLabel = dialect === 'Egyptian' ? 'Egyptian Arabic' : 'Gulf Arabic';

    const trimmed = word.trim().slice(0, 200);
    const isPhrase = Boolean(isPhraseFlag) || /\s/.test(trimmed);

    const hasContext = typeof sentenceArabic === 'string' && sentenceArabic.trim().length > 0;
    const contextLine = hasContext
      ? `\n\nCONTEXT — the ${isPhrase ? 'phrase' : 'word'} appears in this sentence:\nArabic: "${String(sentenceArabic).trim()}"${typeof sentenceEnglish === 'string' && sentenceEnglish.trim() ? `\nEnglish: "${String(sentenceEnglish).trim()}"` : ''}\n\nFor "definition": choose the sense that fits THIS sentence — the meaning consistent with the English translation above, not the most common dictionary meaning. Root and uses can stay generic.`
      : '';

    const systemPrompt = isPhrase
      ? `You are an Arabic linguistics expert specialising in ${dialectLabel}. Given a multi-word Arabic PHRASE or expression, return its IDIOMATIC English meaning as a whole — NOT word-by-word. If it's a common collocation or idiom, give the figurative meaning. Also return the root of the head/most lexically meaningful word, and up to 3 related expressions. Reply ONLY with valid JSON, no other text.`
      : `You are an Arabic linguistics expert specialising in ${dialectLabel}. Given an Arabic word, return its English definition, its root, and 3 related words. Reply ONLY with valid JSON, no other text.`;

    const userPrompt = isPhrase
      ? `Phrase: ${trimmed}${contextLine}\n\nReturn JSON: {"definition":"the idiomatic English meaning of the WHOLE phrase","root":"ك-ت-ب","uses":[{"arabic":"related expression","english":"meaning"}]}`
      : `Word: ${trimmed}${contextLine}\n\nReturn JSON: {"definition":"the English meaning of the word","root":"ك-ت-ب","uses":[{"arabic":"...","english":"..."},{"arabic":"...","english":"..."},{"arabic":"...","english":"..."}]}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 402 || response.status === 429) {
        return new Response(JSON.stringify({ error: response.status === 402 ? 'Credits exhausted' : 'Rate limited' }), {
          status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('AI error:', response.status, await response.text().catch(() => ''));
      return new Response(JSON.stringify({ root: null, uses: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    // Extract JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return new Response(JSON.stringify({
          definition: parsed.definition || null,
          root: parsed.root || null,
          uses: Array.isArray(parsed.uses) ? parsed.uses.slice(0, 5) : [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch { /* fall through */ }
    }

    return new Response(JSON.stringify({ root: null, uses: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('word-enrichment error:', e);
    return new Response(JSON.stringify({ root: null, uses: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
