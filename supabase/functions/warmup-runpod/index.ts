/**
 * warmup-runpod — Pre-warms RunPod serverless endpoint (Jais).
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

// Native RunPod async /run endpoint (NOT OpenAI-compatible path)
const RUNPOD_JAIS_RUN = 'https://api.runpod.ai/v2/hqckbihez3499f/run';

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
    return resp.ok ? 'ok' : 'error';
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

  const RUNPOD_API_KEY = Deno.env.get('RUNPOD_API_KEY');
  if (!RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({ jais: 'skip', reason: 'RUNPOD_API_KEY not set' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log('warmup-runpod: waking Jais (native /run) endpoint...');

  const jais = await warmJaisNative(RUNPOD_API_KEY);

  console.log(`warmup-runpod: jais=${jais}`);

  return new Response(
    JSON.stringify({ jais }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
