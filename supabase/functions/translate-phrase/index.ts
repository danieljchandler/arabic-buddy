import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Strip punctuation from edges of Arabic text
function cleanPhrase(phrase: string): string {
  return phrase
    .replace(/^[،؟.!:؛…\-—–"'()[\]{}«»\s]+|[،؟.!:؛…\-—–"'()[\]{}«»\s]+$/g, '')
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const rawPhrase = body.phrase;
    const dialect = body.dialect || 'Gulf';
    const mode = body.mode || 'auto'; // 'word' | 'phrase' | 'auto'
    
    if (!rawPhrase || typeof rawPhrase !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing phrase' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const phrase = cleanPhrase(rawPhrase);
    if (!phrase) {
      return new Response(JSON.stringify({ translation: null, msa: null }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Try Lovable AI gateway first (no API key needed)
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const dialectLabel = dialect === 'Egyptian' ? 'Egyptian Arabic (مصري)' : dialect === 'Yemeni' ? 'Yemeni Arabic (يمني)' : 'Gulf Arabic (Khaliji)';
    
    const isWord = mode === 'word' || (mode === 'auto' && !phrase.includes(' '));
    
    const translationPrompt = isWord
      ? `You are a ${dialectLabel} translator. Translate the given Arabic word to English. Return ONLY the English translation — no explanation, no punctuation around it, just 1-4 words.`
      : `You are a ${dialectLabel} translator. Translate the given Arabic phrase to natural English. Return ONLY the English translation — no explanation, no punctuation around it, just a brief translation.`;

    const msaPrompt = `Convert this ${dialectLabel} word/phrase to Modern Standard Arabic (فصحى). Return ONLY the MSA Arabic script, no explanation.`;

    async function callLovable(systemPrompt: string, userContent: string, maxTokens: number): Promise<string | null> {
      if (!LOVABLE_API_KEY) return null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            max_tokens: maxTokens,
            temperature: 0.1,
          }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    // Run translation and MSA in parallel via Lovable gateway
    const [translation, msa] = await Promise.all([
      callLovable(translationPrompt, phrase, 50),
      callLovable(msaPrompt, phrase, 50),
    ]);

    // Fallback to OpenRouter if Lovable failed
    if (!translation) {
      const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
      if (OPENROUTER_API_KEY) {
        async function callOpenRouter(systemPrompt: string, userContent: string): Promise<string | null> {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'qwen/qwen3-235b-a22b',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent },
                ],
                max_tokens: 30,
                temperature: 0.1,
              }),
            });
            if (!response.ok) return null;
            const data = await response.json();
            return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
          } catch {
            return null;
          } finally {
            clearTimeout(timeout);
          }
        }

        const fallbackTranslation = await callOpenRouter(translationPrompt, phrase);
        const fallbackMsa = msa || await callOpenRouter(msaPrompt, phrase);
        
        return new Response(JSON.stringify({ 
          translation: fallbackTranslation || '', 
          msa: fallbackMsa || '' 
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    console.log('Translation:', phrase, '->', translation);

    return new Response(JSON.stringify({ translation: translation || '', msa: msa || '' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('translate-phrase error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});