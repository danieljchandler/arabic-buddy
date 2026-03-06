import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_BASE = 'https://api.runpod.ai/v2';

const MODEL_MAP: Record<string, { model: string; getEndpoint: () => string | null }> = {
  standard: {
    model: 'tiiuae/Falcon-H1R-7B',
    getEndpoint: () => {
      const id = Deno.env.get('RUNPOD_FALCON_ENDPOINT_ID');
      return id ? `${RUNPOD_BASE}/${id}/openai/v1/chat/completions` : null;
    },
  },
  premium: {
    model: 'inceptionai/Jais-2-8B-Chat',
    getEndpoint: () => {
      const id = Deno.env.get('RUNPOD_JAIS_ENDPOINT_ID');
      return id ? `${RUNPOD_BASE}/${id}/openai/v1/chat/completions` : null;
    },
  },
};

const DEFAULT_SYSTEM_PROMPT =
  'You are an expert Gulf Arabic of all varieties language tutor. Respond accurately using the specific dialect requested, focusing on authenticity and cultural nuance.';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, modelTier } = await req.json() as { prompt: string; modelTier: 'standard' | 'premium' };

    const apiKey = Deno.env.get('RUNPOD_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'RUNPOD_API_KEY is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const config = MODEL_MAP[modelTier];
    if (!config) {
      return new Response(
        JSON.stringify({ error: `Unknown modelTier: ${modelTier}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const endpoint = config.getEndpoint();
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: `Endpoint not available for ${modelTier} (endpoint ID not configured)` }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
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
