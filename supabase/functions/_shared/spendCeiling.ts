/**
 * Per-user daily AI spend ceiling — prevents free-tier users from incurring
 * unlimited costs by enforcing a global daily budget.
 *
 * Free tier: $5–10/day ceiling (configurable per environment)
 * Paid users: Unlimited (enforced at requireActiveSubscription)
 * Admins: Unlimited
 *
 * Example cost estimates:
 * - word-enrichment: 17 cents/call (ensemble)
 * - listening-quiz: 8 cents/call (ensemble)
 * - munsit-tts: 0.2 cents/call
 * - azure-tts: 0.3 cents/call
 * - live-session-minute: 30 cents/min (OpenAI realtime)
 *
 * A $10/day ceiling allows:
 * - 60 word enrichments, or
 * - 100 listening quizzes, or
 * - 30 minutes of live voice, or
 * - any combination that totals $10
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Free-tier daily ceiling in cents. Can be overridden via DAILY_SPEND_CEILING_CENTS env var.
const DEFAULT_CEILING_CENTS = 1000; // $10.00
const DAILY_CEILING_CENTS = parseInt(Deno.env.get("DAILY_SPEND_CEILING_CENTS") || String(DEFAULT_CEILING_CENTS), 10);

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

interface SpendCheckResult {
  allowed: boolean;
  currentSpend: number;  // in cents
  ceiling: number;       // in cents
  remaining: number;     // in cents
}

/**
 * Check if a user can afford an AI call. Returns the result and the updated spend.
 * Free/paid tier distinction is handled by the caller (this function doesn't know
 * which tier the user is on — that should be checked before calling this).
 *
 * Non-blocking on database errors: if tracking fails, we allow the call (fail open
 * on observability, fail closed on auth).
 */
export async function checkSpendCeiling(
  userId: string,
  featureName: string,
  estimatedCostCents: number,
): Promise<SpendCheckResult> {
  try {
    const supa = admin();

    // Record this spend and get updated total
    const { data: totalCents, error } = await supa.rpc("increment_user_ai_spend", {
      _user_id: userId,
      _feature: featureName,
      _cents: estimatedCostCents,
    });

    if (error) {
      console.error("[spendCeiling] rpc failed:", error.message);
      // Fail open: if tracking breaks, allow the call
      return {
        allowed: true,
        currentSpend: 0,
        ceiling: DAILY_CEILING_CENTS,
        remaining: DAILY_CEILING_CENTS,
      };
    }

    const current = typeof totalCents === "number" ? totalCents : Number(totalCents || 0);
    const allowed = current <= DAILY_CEILING_CENTS;

    return {
      allowed,
      currentSpend: current,
      ceiling: DAILY_CEILING_CENTS,
      remaining: Math.max(0, DAILY_CEILING_CENTS - current),
    };
  } catch (e) {
    console.error("[spendCeiling] error:", e);
    // Fail open on exceptions (network, etc)
    return {
      allowed: true,
      currentSpend: 0,
      ceiling: DAILY_CEILING_CENTS,
      remaining: DAILY_CEILING_CENTS,
    };
  }
}

/**
 * Known feature costs in cents. Used to estimate spend before making a call.
 * These should be updated as pricing changes.
 */
export const FEATURE_COSTS_CENTS: Record<string, number> = {
  "word-enrichment": 17,         // ensemble: Claude (5¢) + Gemini (12¢)
  "listening-quiz": 8,           // ensemble but structured, ~8¢
  "generate-sample-sentences": 8, // ensemble
  "how-do-i-say": 15,            // council (3 models + judge)
  "munsit-tts": 0.2,
  "azure-tts": 0.3,
  "elevenlabs-tts": 11,
  "free-chat": 4,                // solo Gemini
  "daily-challenge": 4,          // solo
  "culture-guide": 4,            // solo
  "pronunciation-feedback": 6,   // solo
  "live-session-minute": 30,     // OpenAI realtime at $0.30/min
};

/**
 * Get the estimated cost for a feature in cents. Returns a best-guess based on
 * FEATURE_COSTS_CENTS. If feature is unknown, returns 5 cents (conservative).
 */
export function getFeatureCostCents(featureName: string): number {
  return FEATURE_COSTS_CENTS[featureName] ?? 5;
}
