// Update per-user concept mastery from review/quiz outcomes.
// Body: { outcomes: [{ concept_id, correct: boolean }, ...] }
// Uses simple SM-2-ish bucket progression.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STRENGTH_ORDER = ["new", "learning", "familiar", "strong", "mastered"] as const;
const NEXT_INTERVAL_DAYS: Record<string, number> = {
  new: 1, learning: 2, familiar: 7, strong: 21, mastered: 60,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const outcomes: Array<{ concept_id: string; correct: boolean }> =
      Array.isArray(body?.outcomes) ? body.outcomes : [];
    if (!outcomes.length) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ids = [...new Set(outcomes.map(o => o.concept_id))];
    const { data: existing } = await service
      .from("user_concept_mastery")
      .select("concept_id, exposures, correct, incorrect, ease, strength")
      .eq("user_id", user.id)
      .in("concept_id", ids);
    const map = new Map<string, any>((existing ?? []).map(r => [r.concept_id, r]));

    const rows = outcomes.map(o => {
      const cur = map.get(o.concept_id) ?? {
        exposures: 0, correct: 0, incorrect: 0, ease: 2.5, strength: "new",
      };
      const exposures = cur.exposures + 1;
      const correct = cur.correct + (o.correct ? 1 : 0);
      const incorrect = cur.incorrect + (o.correct ? 0 : 1);
      const idx = STRENGTH_ORDER.indexOf(cur.strength as any);
      const newIdx = o.correct
        ? Math.min(STRENGTH_ORDER.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      const strength = STRENGTH_ORDER[newIdx];
      const ease = Math.max(1.3, Math.min(3.0, cur.ease + (o.correct ? 0.05 : -0.15)));
      const next_due_at = new Date(
        Date.now() + (NEXT_INTERVAL_DAYS[strength] || 1) * 86400_000,
      ).toISOString();
      return {
        user_id: user.id,
        concept_id: o.concept_id,
        exposures, correct, incorrect, ease, strength,
        last_seen_at: new Date().toISOString(),
        next_due_at,
      };
    });

    const { error } = await service
      .from("user_concept_mastery")
      .upsert(rows, { onConflict: "user_id,concept_id" });
    if (error) throw error;

    return new Response(JSON.stringify({ updated: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("update-mastery error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
