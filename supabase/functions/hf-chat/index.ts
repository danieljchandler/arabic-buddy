import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Native RunPod endpoints
const RUNPOD_JAIS_RUNSYNC = 'https://api.runpod.ai/v2/bbdh3g1cocdnhl/runsync';
const RUNPOD_FALCON_ENDPOINT = 'https://api.runpod.ai/v2/owodjrizyv47m0/openai/v1/chat/completions';

type ModelConfig = {
  model: string;
  endpoint: string;
  native?: boolean; // true = use native RunPod /runsync API
};

const MODEL_MAP: Record<string, ModelConfig> = {
  standard: {
    model: 'tiiuae/Falcon-H1R-7B',
    endpoint: RUNPOD_FALCON_ENDPOINT,
  },
  premium: {
    model: 'inceptionai/Jais-2-8B-Chat',
    endpoint: RUNPOD_JAIS_RUNSYNC,
    native: true,
  },
};

function formatChatPrompt(systemPrompt: string, userPrompt: string): string {
  return `### Instruction: ${systemPrompt}\n\n### Input: ${userPrompt}\n\n### Response:`;
}

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

    let content: string | undefined;

    if (config.native) {
      // Native RunPod /runsync API
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt: formatChatPrompt(DEFAULT_SYSTEM_PROMPT, prompt),
          },
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
      // Native RunPod returns { output: ... } or { output: { text: ... } }
      content = typeof data.output === 'string' ? data.output : data.output?.text ?? data.output?.choices?.[0]?.message?.content;
    } else {
      // OpenAI-compatible API
      const response = await fetch(config.endpoint, {
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
      content = data.choices?.[0]?.message?.content;
    }

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
