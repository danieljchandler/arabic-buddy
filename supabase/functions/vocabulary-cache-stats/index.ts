// vocabulary-cache-stats — view cache statistics and analytics
// Admin-only endpoint (requires subscription or admin role) to monitor cache health
// and make decisions about cache management (cleanup, refresh, etc.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireActiveSubscription } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Gate to subscribers/admins only
  const gateResp = await requireActiveSubscription(req, corsHeaders);
  if (gateResp.limited) return gateResp.response;

  try {
    const supa = admin();

    // Get overall cache statistics
    const { data: stats } = await supa.from("vocabulary_cache_stats").select("*");

    // Get top 20 most-reused words
    const { data: topWords } = await supa
      .from("vocabulary_enrichments")
      .select("word,dialect,hit_count,created_at")
      .order("hit_count", { ascending: false })
      .limit(20);

    // Get recent additions (last 100 entries)
    const { data: recent } = await supa
      .from("vocabulary_enrichments")
      .select("word,dialect,is_phrase,hit_count,created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    // Estimate savings: assume each cached entry saves ~$0.002 in Claude/Gemini ensemble costs
    // and has been hit (avg_hits - 1) times
    const estimatedSavings = (stats || []).reduce((total: number, stat: any) => {
      const entriesReused = stat.reused_entries || 0;
      const avgHitsPerReused = (stat.avg_hits || 1) - 1; // subtract the initial generation
      return total + (entriesReused * avgHitsPerReused * 0.002);
    }, 0);

    return new Response(
      JSON.stringify({
        ok: true,
        stats: {
          by_dialect: stats || [],
          total_cached_entries: stats?.reduce((sum: number, s: any) => sum + (s.total_entries || 0), 0) || 0,
          total_reused_entries: stats?.reduce((sum: number, s: any) => sum + (s.reused_entries || 0), 0) || 0,
          estimated_savings_usd: Math.round(estimatedSavings * 100) / 100,
        },
        top_words: topWords || [],
        recent_additions: recent || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[vocabulary-cache-stats] error", e);
    return new Response(
      JSON.stringify({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
