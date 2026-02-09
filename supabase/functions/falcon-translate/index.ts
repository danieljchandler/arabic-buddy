import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FALCON_ENDPOINT = "https://k5gka3aa0dgchbd4.us-east-1.aws.endpoints.huggingface.cloud";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { arabicLines } = await req.json();

    if (!Array.isArray(arabicLines) || arabicLines.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty arabicLines array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const FALCON_HF_API_KEY = Deno.env.get('FALCON_HF_API_KEY');
    if (!FALCON_HF_API_KEY) {
      console.error('FALCON_HF_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Falcon API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Falcon translate: processing ${arabicLines.length} lines`);

    // Build a single prompt with all lines numbered for batch translation
    const numberedLines = arabicLines.map((line: string, i: number) => `${i + 1}. ${line}`).join('\n');

    const prompt = `<|system|>
You are an expert translator specializing in Gulf Arabic (Khaliji) dialect. Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match.
<|user|>
Translate these Gulf Arabic lines to English:

${numberedLines}
<|assistant|>`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    let response: Response;
    try {
      response = await fetch(FALCON_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${FALCON_HF_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: Math.min(arabicLines.length * 100, 4096),
            temperature: 0.3,
            top_p: 0.9,
            do_sample: true,
            return_full_text: false,
          },
        }),
      });
    } catch (e) {
      clearTimeout(timeout);
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      console.error('Falcon fetch failed:', { isAbort, error: String(e) });
      return new Response(
        JSON.stringify({ error: isAbort ? 'Falcon request timed out' : String(e) }),
        { status: isAbort ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Falcon API error:', response.status, errorText?.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `Falcon API error (${response.status})`, details: errorText?.slice(0, 300) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Falcon raw response type:', typeof data, Array.isArray(data) ? 'array' : 'object');

    // HF text-generation returns either [{ generated_text }] or { generated_text }
    let generatedText = '';
    if (Array.isArray(data) && data[0]?.generated_text) {
      generatedText = data[0].generated_text;
    } else if (data?.generated_text) {
      generatedText = data.generated_text;
    } else {
      console.error('Unexpected Falcon response format:', JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'Unexpected Falcon response format' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Falcon generated text length:', generatedText.length);

    // Parse numbered translations from the generated text
    const translations: string[] = [];
    const lines = generatedText.split('\n').filter((l: string) => l.trim());

    for (let i = 0; i < arabicLines.length; i++) {
      const lineNum = i + 1;
      // Try to find a line starting with the number
      const match = lines.find((l: string) => {
        const trimmed = l.trim();
        return trimmed.startsWith(`${lineNum}.`) || trimmed.startsWith(`${lineNum})`);
      });

      if (match) {
        // Strip the number prefix
        translations.push(match.trim().replace(/^\d+[\.\)]\s*/, ''));
      } else if (i < lines.length) {
        // Fallback: use positional mapping
        translations.push(lines[i]?.trim().replace(/^\d+[\.\)]\s*/, '') || '');
      } else {
        translations.push('');
      }
    }

    console.log(`Falcon translate: produced ${translations.filter(t => t.length > 0).length}/${arabicLines.length} translations`);

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
