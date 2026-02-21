import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GPT5_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Lovable API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`GPT-5 translate: processing ${arabicLines.length} lines`);

    const numberedLines = arabicLines.map((line: string, i: number) => `${i + 1}. ${line}`).join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    let response: Response;
    try {
      response = await fetch(GPT5_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [
            {
              role: "system",
              content: "You are an expert translator specializing in Gulf Arabic (Khaliji) dialect. Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary."
            },
            {
              role: "user",
              content: `Translate these Gulf Arabic lines to English:\n\n${numberedLines}`
            }
          ],
        }),
      });
    } catch (e) {
      clearTimeout(timeout);
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      console.error('GPT-5 fetch failed:', { isAbort, error: String(e) });
      return new Response(
        JSON.stringify({ error: isAbort ? 'GPT-5 request timed out' : String(e) }),
        { status: isAbort ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GPT-5 API error:', response.status, errorText?.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `GPT-5 API error (${response.status})`, details: errorText?.slice(0, 300) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const generatedText = data?.choices?.[0]?.message?.content || '';

    if (!generatedText) {
      console.error('GPT-5 returned empty content');
      return new Response(
        JSON.stringify({ error: 'GPT-5 returned empty response' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('GPT-5 response length:', generatedText.length);

    // Parse numbered translations
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

    console.log(`GPT-5 translate: produced ${translations.filter(t => t.length > 0).length}/${arabicLines.length} translations`);

    return new Response(
      JSON.stringify({ translations }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in gpt5-translate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
