// voice-session-end — log session end event for billing and analytics
// Called by the browser when a voice session ends, to record the actual duration and close reason
// Non-blocking; does not require auth but session must exist

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body.session_id as string | undefined;
    const durationSeconds = body.duration_seconds as number | undefined;
    const closeReason = body.close_reason as string | undefined;

    if (!sessionId || typeof durationSeconds !== "number") {
      return new Response(
        JSON.stringify({ error: "missing_fields", message: "session_id and duration_seconds required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supa = admin();
    const { error } = await supa
      .from("voice_sessions")
      .update({
        ended_at: new Date().toISOString(),
        status: "closed",
        duration_seconds: durationSeconds,
        close_reason: closeReason || "user_disconnected",
      })
      .eq("session_id", sessionId);

    if (error) {
      console.error("[voice-session-end] update failed:", error.message);
      return new Response(
        JSON.stringify({ error: "update_failed", message: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, session_id: sessionId, duration_seconds: durationSeconds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[voice-session-end] error", e);
    return new Response(
      JSON.stringify({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
