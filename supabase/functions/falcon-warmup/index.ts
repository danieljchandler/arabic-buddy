import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const FALCON_URL = Deno.env.get('FALCON_HF_ENDPOINT_URL');
    const FALCON_KEY = Deno.env.get('FALCON_HF_API_KEY');

    if (!FALCON_URL || !FALCON_KEY) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${FALCON_URL}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${FALCON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tgi',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
    });
    clearTimeout(timeout);

    console.log('Falcon warmup response:', response.status);

    return new Response(JSON.stringify({ ok: true, status: response.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.warn('Falcon warmup error (non-fatal):', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ ok: true, warmedUp: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
