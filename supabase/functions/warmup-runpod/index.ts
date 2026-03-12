/**
 * warmup-runpod — Pre-warms Jais HF Inference Endpoint (scaled to zero).
 *
 * Called from the Transcribe page on mount so that cold-start spin-up happens
 * *before* the user submits audio. The endpoint receives a tiny request
 * that forces the worker to boot without burning significant compute.
 *
 * Returns { jais: 'ok'|'skip'|'error' }.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JAIS_HF_ENDPOINT = 'https://u1lf1x17ye91ruw5.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions';

async function warmJaisHF(apiKey: string): Promise<'ok' | 'error'> {
  const startMs = Date.now();
  try {
    console.log('warmup jais: sending HF endpoint ping...');
    const resp = await fetch(JAIS_HF_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'inceptionai/jais-13b-chat',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const body = await resp.text();
    console.log(`warmup jais: HTTP ${resp.status} in ${elapsedSec}s — ${body.slice(0, 200)}`);
    // 200 = ready, 503 = waking up (still triggers scale-up)
    return (resp.ok || resp.status === 503) ? 'ok' : 'error';
  } catch (e) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.warn(`warmup jais failed in ${elapsedSec}s:`, e instanceof Error ? e.message : String(e));
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
      JSON.stringify({ jais: 'skip', reason: 'VITE_HF_TOKEN not set' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log('warmup-runpod: waking Jais HF Inference Endpoint...');

  const jais = await warmJaisHF(HF_TOKEN);

  console.log(`warmup-runpod: jais=${jais}`);

  return new Response(
    JSON.stringify({ jais }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
