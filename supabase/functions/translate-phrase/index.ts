import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const { phrase } = await req.json();
    if (!phrase || typeof phrase !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing phrase' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('Translating phrase:', phrase);

    const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
    const translationMessages = [
      {
        role: 'system',
        content: 'You are a Gulf Arabic translator. Translate the given Arabic word or phrase to English. Return ONLY the English translation — no explanation, no punctuation around it, just 1-5 words.'
      },
      {
        role: 'user',
        content: phrase,
      }
    ];

    async function callOpenRouter(model: string, timeoutMs: number): Promise<string | null> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(OPENROUTER_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: translationMessages,
            max_tokens: 30,
            temperature: 0.1,
          }),
        });
        if (!response.ok) {
          console.warn(`OpenRouter ${model} error:`, response.status);
          return null;
        }
        const data = await response.json();
        return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
      } catch (e) {
        console.warn(`OpenRouter ${model} failed:`, e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    const [qwenResult, geminiResult] = await Promise.all([
      callOpenRouter('qwen/qwen3-30b-a3b', 15_000),
      callOpenRouter('google/gemini-2.5-flash', 15_000),
    ]);

    const translation = qwenResult ?? geminiResult ?? '';
    console.log('Translation result:', phrase, '->', translation, `(qwen=${!!qwenResult}, gemini=${!!geminiResult})`);

    return new Response(JSON.stringify({ translation }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('translate-phrase error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
