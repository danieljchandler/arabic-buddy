/**
 * tts-speak — the app's text-to-speech endpoint.
 *
 * POST { text, dialect?, role?, index?, stability?, speed? } → audio bytes.
 *
 * Callers name a *dialect*, never a voice. That is the whole point: which
 * provider and which voice serve a dialect is server configuration, so pointing
 * Yemeni at a cloned voice is a secret rather than a frontend deploy. It also
 * means the voice-injection surface that `elevenlabs-tts`'s allow-list exists to
 * close does not exist here — there is no caller-supplied ID to allow or deny.
 *
 * `azure-tts`, `munsit-tts` and `elevenlabs-tts` are untouched and still take an
 * explicit `voice`. They remain the way to reach one specific voice on purpose.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { EMPTY_USAGE } from "../_shared/llmUsageCore.ts";
import { logLlmUsage } from "../_shared/llmUsageLogger.ts";
import { synthesizeForDialect } from "../_shared/ttsVoiceRouting.ts";

/** Long enough for a Listen line; short enough that one call can't run up a bill. */
const MAX_TEXT_CHARS = 2000;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Same ceiling as the per-provider functions. This runs with verify_jwt=false,
  // so the cap requiring a signed-in user is the only access control.
  const cap = await enforceDailyCap(req, "tts-speak", 400, corsHeaders);
  if (cap.limited) return cap.response;

  let body: {
    text?: string;
    dialect?: string;
    role?: string;
    index?: number;
    stability?: number;
    speed?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const text = (body.text ?? "").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) {
    return new Response(
      JSON.stringify({ error: "text is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { bytes, plan } = await synthesizeForDialect(text, body.dialect ?? "Gulf", {
      role: body.role,
      index: typeof body.index === "number" ? body.index : 0,
      stability: typeof body.stability === "number" ? body.stability : undefined,
      speed: typeof body.speed === "number" ? body.speed : undefined,
    });

    // Munsit now carries every dialect, so without this the admin cost view goes
    // blind exactly as spend concentrates on one vendor.
    logLlmUsage({
      functionName: "tts-speak",
      model: plan.modelId ?? plan.provider,
      provider: plan.provider,
      usage: EMPTY_USAGE,
      units: text.length,
      unitKind: "characters",
    });

    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": plan.contentType,
        // `x-tts-source: azure-emergency` in normal operation means Munsit
        // discovery is failing and the app has quietly reverted to the voices
        // this endpoint exists to replace. It is the one header worth watching.
        "x-tts-provider": plan.provider,
        "x-tts-source": plan.source,
        "x-tts-voice-count": String(plan.voices.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("tts-speak: every provider failed:", msg);
    return new Response(
      JSON.stringify({ error: "TTS_FAILED", detail: msg.slice(0, 300) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
