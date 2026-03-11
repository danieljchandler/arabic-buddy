/**
 * warmup-runpod — Pre-warms RunPod serverless endpoints (Jais + Falcon).
 *
 * Called from the Transcribe page on mount so that cold-start spin-up happens
 * *before* the user submits audio. Each endpoint receives a tiny request
 * that forces the worker to boot without burning significant compute.
 *
 * Returns { jais: 'ok'|'skip'|'error', falcon: 'ok'|'skip'|'error' }.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Native RunPod async /run endpoint (NOT OpenAI-compatible path)
const RUNPOD_JAIS_RUN = 'https://api.runpod.ai/v2/bbdh3g1cocdnhl/run';
// Falcon still uses OpenAI-compatible path
const RUNPOD_FALCON_ENDPOINT = 'https://api.runpod.ai/v2/owodjrizyv47m0/openai/v1/chat/completions';

async function warmJaisNative(apiKey: string): Promise<'ok' | 'error'> {
  const startMs = Date.now();
  try {
    console.log('warmup jais: sending native /run ping...');
    const resp = await fetch(RUNPOD_JAIS_RUN, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { prompt: 'hi' },
      }),
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const body = await resp.text();
    console.log(`warmup jais: HTTP ${resp.status} in ${elapsedSec}s — ${body.slice(0, 200)}`);
    // For /run, 200 means the job was queued successfully — that's enough to warm the worker
    return resp.ok ? 'ok' : 'error';
  } catch (e) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.warn(`warmup jais failed in ${elapsedSec}s:`, e instanceof Error ? e.message : String(e));
    return 'error';
  }
}

async function warmFalconOpenAI(apiKey: string): Promise<'ok' | 'error'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);
  const startMs = Date.now();
  try {
    console.log('warmup falcon: sending OpenAI-compat ping...');
    const resp = await fetch(RUNPOD_FALCON_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tiiuae/Falcon-H1R-7B',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const body = await resp.text();
    console.log(`warmup falcon: HTTP ${resp.status} in ${elapsedSec}s — ${body.slice(0, 100)}`);
    return resp.ok ? 'ok' : 'error';
  } catch (e) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.warn(`warmup falcon failed in ${elapsedSec}s:`, e instanceof Error ? e.message : String(e));
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

  console.log('warmup-runpod: waking Jais (native /run) + Falcon (OpenAI) endpoints...');

  const [jais, falcon] = await Promise.all([
    warmJaisNative(RUNPOD_API_KEY),
    warmFalconOpenAI(RUNPOD_API_KEY),
  ]);

  console.log(`warmup-runpod: jais=${jais}, falcon=${falcon}`);

  return new Response(
    JSON.stringify({ jais, falcon }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
