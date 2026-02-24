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
    const RUNPOD_URL = Deno.env.get('RUNPOD_ENDPOINT_URL');
    const RUNPOD_KEY = Deno.env.get('RUNPOD_API_KEY');

    if (!RUNPOD_URL || !RUNPOD_KEY) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize: strip trailing /run, /runsync, or slash
    const baseUrl = RUNPOD_URL.replace(/\/(run|runsync)\/?$/, '').replace(/\/+$/, '');
    const runpodEndpoint = `${baseUrl}/runsync`;
    console.log('Jais warmup calling:', runpodEndpoint);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(runpodEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${RUNPOD_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: '### Instruction: Say hi.\n\n### Response:',
          max_tokens: 1,
        },
      }),
    });
    clearTimeout(timeout);

    console.log('Jais warmup response:', response.status);

    return new Response(JSON.stringify({ ok: true, status: response.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.warn('Jais warmup error (non-fatal):', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ ok: true, warmedUp: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
