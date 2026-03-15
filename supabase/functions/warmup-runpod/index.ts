/**
 * warmup-runpod — Pre-warms Jais + ALLaM HF Inference Endpoints (scaled to zero).
 *
 * Called from the Transcribe page on mount so that cold-start spin-up happens
 * *before* the user submits audio.
 *
 * Returns { jais: 'ok'|'skip'|'error', allam: 'ok'|'skip'|'error' }.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JAIS_HF_ENDPOINT = 'https://u1lf1x17ye91ruw5.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions';
const ALLAM_HF_ENDPOINT = 'https://c9fwzzvaafq3cgfv.us-east4.gcp.endpoints.huggingface.cloud/v1/chat/completions';

async function warmEndpoint(name: string, endpoint: string, model: string, apiKey: string): Promise<'ok' | 'error'> {
  const startMs = Date.now();
  try {
    console.log(`warmup ${name}: sending HF endpoint ping...`);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const body = await resp.text();
    console.log(`warmup ${name}: HTTP ${resp.status} in ${elapsedSec}s — ${body.slice(0, 200)}`);
    return (resp.ok || resp.status === 503) ? 'ok' : 'error';
  } catch (e) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.warn(`warmup ${name} failed in ${elapsedSec}s:`, e instanceof Error ? e.message : String(e));
    return 'error';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const HF_TOKEN = Deno.env.get('VITE_HF_TOKEN');
  if (!HF_TOKEN) {
    return new Response(
      JSON.stringify({ jais: 'skip', allam: 'skip', reason: 'VITE_HF_TOKEN not set' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log('warmup-runpod: waking Jais + ALLaM HF Inference Endpoints...');

  const [jais, allam] = await Promise.all([
    warmEndpoint('jais', JAIS_HF_ENDPOINT, 'inceptionai/jais-13b-chat', HF_TOKEN),
    warmEndpoint('allam', ALLAM_HF_ENDPOINT, 'humain-ai/ALLaM-7B-Instruct-preview', HF_TOKEN),
  ]);

  console.log(`warmup-runpod: jais=${jais}, allam=${allam}`);

  return new Response(
    JSON.stringify({ jais, allam }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
