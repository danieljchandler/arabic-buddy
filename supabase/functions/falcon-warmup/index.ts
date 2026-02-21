import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const FALCON_URL = Deno.env.get('FALCON_HF_ENDPOINT_URL');
    const FALCON_KEY = Deno.env.get('FALCON_HF_API_KEY');

    if (!FALCON_URL || !FALCON_KEY) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${FALCON_URL}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${FALCON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tiiuae/Falcon-H1R-7B',
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
