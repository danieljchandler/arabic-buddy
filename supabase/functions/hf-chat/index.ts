import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HF_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';

const MODEL_MAP: Record<string, string> = {
  standard: 'tiiuae/Falcon-H1-7B-Instruct:cheapest',
  premium: 'inceptionai/Jais-2-8B-Chat:cheapest',
};

const DEFAULT_SYSTEM_PROMPT =
  'You are an expert Gulf Arabic of all varieties language tutor. Respond accurately using the specific dialect requested, focusing on authenticity and cultural nuance.';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, modelTier } = await req.json() as { prompt: string; modelTier: 'standard' | 'premium' };

    const hfToken = Deno.env.get('VITE_HF_TOKEN');
    if (!hfToken) {
      return new Response(
        JSON.stringify({ error: 'Authentication token is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const model = MODEL_MAP[modelTier];
    if (!model) {
      return new Response(
        JSON.stringify({ error: `Unknown modelTier: ${modelTier}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const response = await fetch(HF_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: errText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Empty response from model' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[hf-chat] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
