/**
 * Daily AI usage cap helper for edge functions.
 *
 * Enforces a free-tier per-(user, feature, day) limit. Paid users (active
 * row in `subscribers`) bypass the cap. Anonymous calls are rejected with 401.
 *
 * Self-contained: does not import the shared cors module so it can be dropped
 * into edge functions that already define their own corsHeaders object.
 *
 * Usage:
 *   import { enforceDailyCap } from "../_shared/usageCap.ts";
 *   const cap = await enforceDailyCap(req, "transcribe", 10, corsHeaders);
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

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await supa.auth.getUser(token);
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
    if (data.subscription_end && new Date(data.subscription_end) < new Date()) return false;
    return true;
  } catch {
    return false; // fail closed — treat as free-tier
  }
}

export async function enforceDailyCap(
  req: Request,
  key: string,
  limit: number,
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

  return { limited: false, userId, count, limit };
}
