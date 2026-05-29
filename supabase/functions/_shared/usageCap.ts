/**
 * Daily AI usage cap helper for edge functions.
 *
 * Used to enforce a free-tier limit per (user, feature, day).
 * Paid/beta users (with an active subscription row) bypass the cap.
 *
 * Usage:
 *   const cap = await enforceDailyCap(req, "transcribe", 10);
 *   if (cap.limited) return cap.response;   // 429 with friendly message
 *   // ... do the expensive work ...
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

interface CapResult {
  limited: false;
  userId: string;
  count: number;
  limit: number;
}
interface CapBlocked {
  limited: true;
  response: Response;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns the authenticated user_id from the request Authorization header,
 * or null if the request is anonymous / invalid.
 */
async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Returns true if the user has an active (paid or beta) subscription
 * and should bypass free-tier caps.
 */
async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const supa = admin();
    const { data } = await supa
      .from("subscribers")
      .select("subscribed, subscription_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return false;
    if (data.subscribed !== true) return false;
    if (data.subscription_end && new Date(data.subscription_end) < new Date()) return false;
    return true;
  } catch {
    // If the subscribers table doesn't exist or query fails, fail closed
    // (treat as free-tier) so we still protect AI spend.
    return false;
  }
}

/**
 * Enforce a daily cap. Increments the counter atomically and returns either:
 *   - { limited: false, ... } if within limit (proceed)
 *   - { limited: true, response } 429 to return to the client
 *
 * Anonymous calls are blocked (return 401) — only authed users can hit
 * capped endpoints. If you need to allow anon, check the user before calling.
 */
export async function enforceDailyCap(
  req: Request,
  key: string,
  limit: number,
): Promise<CapResult | CapBlocked> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({
          error: "auth_required",
          message: "Please sign in to use this feature.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      ),
    };
  }

  // Paid users bypass caps.
  if (await hasActiveSubscription(userId)) {
    return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
  }

  const supa = admin();
  const { data, error } = await supa.rpc("increment_usage_counter", {
    _user_id: userId,
    _key: key,
    _amount: 1,
  });

  if (error) {
    // Don't block on counter failure — log and proceed so a transient DB
    // error doesn't take the feature down.
    console.error(`[usageCap] increment failed for ${key}:`, error.message);
    return { limited: false, userId, count: 0, limit };
  }

  const count = typeof data === "number" ? data : Number(data);

  if (count > limit) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({
          error: "daily_limit_reached",
          message: `Daily free limit reached (${limit}/day). Upgrade for unlimited use.`,
          key,
          count,
          limit,
          upgrade_url: "/pricing",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      ),
    };
  }

  return { limited: false, userId, count, limit };
}
