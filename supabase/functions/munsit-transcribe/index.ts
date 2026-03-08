/**
 * munsit-transcribe — DISABLED (api.cntxt.tools DNS not resolving as of Mar 2026).
 * Returns graceful null so the pipeline continues with Deepgram + Fanar.
 * Re-enable when CNTXT restores their DNS / publishes a new endpoint.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('Munsit ASR: disabled (api.cntxt.tools DNS dead)');
  return new Response(
    JSON.stringify({ text: null, error: 'Munsit disabled — api.cntxt.tools DNS not resolving' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
