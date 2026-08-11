/**
 * Session tracker for live voice conversations.
 *
 * Logs session start/stop events to track:
 * - Session duration for billing/analytics
 * - Active user counts
 * - Idle session cleanup for cost control
 *
 * All times in UTC; operations are async but errors are logged without blocking.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

/**
 * Log a session start event.
 * Returns the session_id for later reference in stop/heartbeat calls.
 * Non-blocking: errors are logged but do not throw.
 */
export async function logSessionStart(
  userId: string,
  mode: "practice" | "assistant",
  dialect: string,
): Promise<string> {
  const sessionId = `session_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  try {
    const supa = admin();
    const { error } = await supa.from("voice_sessions").insert({
      session_id: sessionId,
      user_id: userId,
      mode,
      dialect,
      started_at: new Date().toISOString(),
      status: "active",
    });
    if (error) {
      console.error("[sessionTracker] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[sessionTracker] logSessionStart error:", e);
  }
  return sessionId;
}

/**
 * Log a session stop event with final duration.
 * Non-blocking: errors are logged but do not throw.
 */
export async function logSessionStop(
  sessionId: string,
  durationSeconds: number,
  reason: "user_disconnected" | "idle_timeout" | "duration_limit" | "error",
): Promise<void> {
  try {
    const supa = admin();
    const { error } = await supa
      .from("voice_sessions")
      .update({
        ended_at: new Date().toISOString(),
        status: "closed",
        duration_seconds: durationSeconds,
        close_reason: reason,
      })
      .eq("session_id", sessionId);
    if (error) {
      console.error("[sessionTracker] update failed:", error.message);
    }
  } catch (e) {
    console.error("[sessionTracker] logSessionStop error:", e);
  }
}

/**
 * Periodic heartbeat for long-running sessions.
 * Could be used to detect client crashes or orphaned connections.
 * Non-blocking: errors are logged but do not throw.
 */
export async function logSessionHeartbeat(sessionId: string): Promise<void> {
  try {
    const supa = admin();
    const { error } = await supa
      .from("voice_sessions")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("session_id", sessionId);
    if (error) {
      console.error("[sessionTracker] heartbeat failed:", error.message);
    }
  } catch (e) {
    console.error("[sessionTracker] logSessionHeartbeat error:", e);
  }
}
