import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Falcon uses dedicated HF Inference Endpoint (resolved from env)

function parseNumberedTranslations(generatedText: string, arabicLines: string[]): string[] {
  const translations: string[] = [];
  const lines = generatedText.split('\n').filter((l: string) => l.trim());
  for (let i = 0; i < arabicLines.length; i++) {
    const lineNum = i + 1;
    const match = lines.find((l: string) => {
      const trimmed = l.trim();
      return trimmed.startsWith(`${lineNum}.`) || trimmed.startsWith(`${lineNum})`);
    });
    if (match) {
      translations.push(match.trim().replace(/^\d+[\.\)]\s*/, ''));
    } else if (i < lines.length) {
      translations.push(lines[i]?.trim().replace(/^\d+[\.\)]\s*/, '') || '');
    } else {
      translations.push('');
    }
  }
  return translations;
}

async function callOpenRouterTranslate(
  model: string,
  numberedLines: string,
  apiKey: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert translator specializing in Gulf Arabic (Khaliji) dialect. Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary.',
          },
          {
            role: 'user',
            content: `Translate these Gulf Arabic lines to English:\n\n${numberedLines}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`OpenRouter ${model} error:`, response.status);
      return null;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.warn(`OpenRouter ${model} failed:`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callHuggingFace(
  numberedLines: string,
  hfToken: string,
): Promise<string | null> {
  const falconEndpoint = Deno.env.get('FALCON_HF_ENDPOINT_URL');
  if (!falconEndpoint) {
    console.warn('FALCON_HF_ENDPOINT_URL not set, skipping Falcon call');
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${falconEndpoint}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tiiuae/Falcon-H1-7B-Instruct',
        messages: [
          {
            role: 'system',
            content: 'You are an expert translator specializing in Gulf Arabic (Khaliji) dialect. Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary.',
          },
          {
            role: 'user',
            content: `Translate these Gulf Arabic lines to English:\n\n${numberedLines}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      console.warn('Falcon H1 HF error:', response.status);
      return null;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.warn('Falcon H1 HF failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
    const { arabicLines } = await req.json();

    if (!Array.isArray(arabicLines) || arabicLines.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty arabicLines array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const HF_TOKEN = Deno.env.get('VITE_HF_TOKEN');
    const falconAvailable = Boolean(HF_TOKEN) && Boolean(Deno.env.get('FALCON_HF_ENDPOINT_URL'));

    console.log(`falcon-translate: processing ${arabicLines.length} lines`);

    const numberedLines = arabicLines.map((line: string, i: number) => `${i + 1}. ${line}`).join('\n');

    const [qwenText, geminiText, falconText] = await Promise.all([
      callOpenRouterTranslate('qwen/qwen3-235b-a22b', numberedLines, OPENROUTER_API_KEY),
      callOpenRouterTranslate('google/gemini-2.5-flash', numberedLines, OPENROUTER_API_KEY),
      falconAvailable
        ? callHuggingFace(numberedLines, HF_TOKEN!).catch((e) => {
            console.warn('Falcon H1 HF failed (non-blocking):', e);
            return null;
          })
        : Promise.resolve(null),
    ]);

    const generatedText = qwenText ?? geminiText ?? falconText ?? '';

    if (!generatedText) {
      console.error('All translation models returned empty content');
      return new Response(
        JSON.stringify({ error: 'Translation failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`falcon-translate: response length=${generatedText.length} (qwen=${!!qwenText}, gemini=${!!geminiText}, falcon=${!!falconText})`);

    const translations = parseNumberedTranslations(generatedText, arabicLines);

    console.log(`falcon-translate: produced ${translations.filter(t => t.length > 0).length}/${arabicLines.length} translations`);

    return new Response(
      JSON.stringify({ translations }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in falcon-translate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
