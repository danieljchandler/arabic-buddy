/**
 * warmup-runpod — Pre-warms RunPod serverless endpoints (Jais + Falcon).
 *
 * Called from the Transcribe page on mount so that cold-start spin-up happens
 * *before* the user submits audio. Each endpoint receives a tiny 1-token
 * request that forces the worker to boot without burning significant compute.
 *
 * Returns { jais: 'ok'|'skip'|'error', falcon: 'ok'|'skip'|'error' }.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RUNPOD_JAIS_ENDPOINT = 'https://api.runpod.ai/v2/xx0wek543611i5/openai/v1/chat/completions';
const RUNPOD_FALCON_ENDPOINT = 'https://api.runpod.ai/v2/owodjrizyv47m0/openai/v1/chat/completions';

async function warmEndpoint(
  endpoint: string,
  model: string,
  apiKey: string,
): Promise<'ok' | 'error'> {
  const controller = new AbortController();
  // Allow up to 150s for cold start — RunPod serverless can take 90s+ to spin up.
  const timeout = setTimeout(() => controller.abort(), 150_000);
  const startMs = Date.now();
  try {
    console.log(`warmup ${model}: sending ping...`);
    const resp = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: 'hi' },
        ],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const body = await resp.text();
    console.log(`warmup ${model}: HTTP ${resp.status} in ${elapsedSec}s — ${body.slice(0, 100)}`);
    return resp.ok ? 'ok' : 'error';
  } catch (e) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.warn(`warmup ${model} failed in ${elapsedSec}s:`, e instanceof Error ? e.message : String(e));
    return 'error';
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const RUNPOD_API_KEY = Deno.env.get('RUNPOD_API_KEY');
  if (!RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({ jais: 'skip', falcon: 'skip', reason: 'RUNPOD_API_KEY not set' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log('warmup-runpod: waking Jais + Falcon endpoints...');

  const [jais, falcon] = await Promise.all([
    warmEndpoint(RUNPOD_JAIS_ENDPOINT, 'inceptionai/Jais-2-8B-Chat', RUNPOD_API_KEY),
    warmEndpoint(RUNPOD_FALCON_ENDPOINT, 'tiiuae/Falcon-H1R-7B', RUNPOD_API_KEY),
  ]);

  console.log(`warmup-runpod: jais=${jais}, falcon=${falcon}`);

  return new Response(
    JSON.stringify({ jais, falcon }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
