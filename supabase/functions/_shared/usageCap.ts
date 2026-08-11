/**
 * Daily AI usage cap helper for edge functions.
 *
 * Two-layer enforcement:
 * 1. Per-feature daily cap (e.g., 60 word-enrichments, 300 TTS plays)
 * 2. Per-user daily spend ceiling ($5–10/day free tier)
 *
 * Paid users (active row in `subscribers`) bypass both. Anonymous calls are
 * rejected with 401. Admins bypass both limits.
 *
 * Self-contained: does not import the shared cors module so it can be dropped
 * into edge functions that already define their own corsHeaders object.
 *
 * Usage:
 *   import { enforceDailyCap } from "../_shared/usageCap.ts";
 *   const cap = await enforceDailyCap(req, "transcribe", 10, corsHeaders, 5);
 *   // Last param is estimated cost in cents (optional, for spend ceiling check)
 *   if (cap.limited) return cap.response;
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface CapAllowed {
  limited: false;
  userId: string;
  count: number;
  limit: number;
}
interface CapBlocked {
  limited: true;
  response: Response;
}
export type CapResult = CapAllowed | CapBlocked;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// One client per isolate rather than one per call: every createClient here was
// building a fresh PostgREST/GoTrue stack on a path that runs before any user
// work starts.
let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const supa = admin();
    const { data } = await supa
      .from("subscribers")
      .select("subscribed, subscription_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data || data.subscribed !== true) return false;
    // The client is untyped here, so subscription_end widens to `{}` — narrow
    // it before constructing a Date.
    const endsAt = data.subscription_end as string | null | undefined;
    if (endsAt && new Date(endsAt) < new Date()) return false;
    return true;
  } catch {
    return false; // fail closed — treat as free-tier
  }
}

async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const supa = admin();
    const { data } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Gate a feature to active subscribers (and admins) outright — no free tier.
 *
 * Same result shape as enforceDailyCap so callers branch identically:
 * anonymous → 401 auth_required, signed-in free user → 403
 * subscription_required with an upgrade_url the client can route to.
 */
export async function requireActiveSubscription(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<CapResult> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  const [subscribed, isAdmin] = await Promise.all([
    hasActiveSubscription(userId),
    isAdminUser(userId),
  ]);
  if (subscribed || isAdmin) {
    return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
  }

  return {
    limited: true,
    response: new Response(
      JSON.stringify({
        error: "subscription_required",
        message: "Live voice for the AI assistant is available on a paid plan.",
        upgrade_url: "/pricing",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ),
  };
}

/**
 * Enforce daily cap with optional spend ceiling check.
 * @param req HTTP request with auth token
 * @param key Feature identifier (e.g., "word-enrichment")
 * @param limit Per-feature daily call limit
 * @param corsHeaders CORS headers to include in responses
 * @param estimatedCostCents Optional: cost in cents for spend ceiling check
 */
export async function enforceDailyCap(
  req: Request,
  key: string,
  limit: number,
  corsHeaders: Record<string, string>,
  estimatedCostCents?: number,
): Promise<CapResult> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  // Both are independent lookups; `await a || await b` serialised them on the
  // critical path of every AI request for no reason.
  const [subscribed, isAdmin] = await Promise.all([
    hasActiveSubscription(userId),
    isAdminUser(userId),
  ]);
  if (subscribed || isAdmin) {
    return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
  }

  // Check per-feature call count first
  const supa = admin();
  const { data, error } = await supa.rpc("increment_usage_counter", {
    _user_id: userId,
    _key: key,
    _amount: 1,
  });

  if (error) {
    console.error(`[usageCap] increment failed for ${key}:`, error.message);
    // Don't block on counter failure.
    return { limited: false, userId, count: 0, limit };
  }

  const count = typeof data === "number" ? data : Number(data);

  if (count > limit) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({
          error: "daily_limit_reached",
          message: `You've reached the free daily limit for this feature (${limit}/day). Upgrade for unlimited access.`,
          key,
          count,
          limit,
          upgrade_url: "/pricing",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  // If estimated cost is provided, also check per-user daily spend ceiling
  if (typeof estimatedCostCents === "number" && estimatedCostCents > 0) {
    try {
      const { data: totalSpendCents, error: spendError } = await supa.rpc("increment_user_ai_spend", {
        _user_id: userId,
        _feature: key,
        _cents: estimatedCostCents,
      });

      if (!spendError && typeof totalSpendCents === "number") {
        // Default ceiling: $10/day = 1000 cents (overridable via env var)
        const dailySpendCeilingCents = parseInt(Deno.env.get("DAILY_SPEND_CEILING_CENTS") || "1000", 10);

        if (totalSpendCents > dailySpendCeilingCents) {
          console.warn(`[usageCap] daily spend limit exceeded for ${userId}: ${totalSpendCents}¢ > ${dailySpendCeilingCents}¢`);
          return {
            limited: true,
            response: new Response(
              JSON.stringify({
                error: "daily_spend_limit_reached",
                message: `You've reached your daily AI budget ($${(dailySpendCeilingCents / 100).toFixed(2)}). Upgrade to unlimited access.`,
                currentSpend: `$${(totalSpendCents / 100).toFixed(2)}`,
                dailyLimit: `$${(dailySpendCeilingCents / 100).toFixed(2)}`,
                upgrade_url: "/pricing",
              }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            ),
          };
        }
      } else if (spendError) {
        console.error(`[usageCap] spend tracking failed:`, spendError.message);
        // Don't block on spend tracking failure (fail open)
      }
    } catch (e) {
      console.error(`[usageCap] spend check exception:`, e);
      // Don't block on exceptions (fail open)
    }
  }

  return { limited: false, userId, count, limit };
}
