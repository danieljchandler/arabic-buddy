import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JAIS_HF_ENDPOINT = 'https://u1lf1x17ye91ruw5.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions';

const DEFAULT_SYSTEM_PROMPT =
  'You are an expert Gulf Arabic of all varieties language tutor. Respond accurately using the specific dialect requested, focusing on authenticity and cultural nuance.';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, modelTier } = await req.json() as { prompt: string; modelTier: 'standard' | 'premium' };

    const apiKey = Deno.env.get('VITE_HF_TOKEN');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'VITE_HF_TOKEN is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Both tiers now use Jais via HF Inference Endpoint
    const response = await fetch(JAIS_HF_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'inceptionai/jais-13b-chat',
        messages: [
          { role: 'user', content: `### Instruction: Your name is Jais, and you are named after Jebel Jais, the highest mountain in UAE. You are a helpful Arabic-English translator specializing in Gulf Arabic dialect.\n[|Human|]: ${prompt}\n[|AI|]:` },
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
