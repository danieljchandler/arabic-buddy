// realtime-session-token — creates an OpenAI Realtime WebRTC call through the
// current /v1/realtime/calls unified interface. The browser sends its SDP offer
// here; this function attaches the dialect-specific session config server-side
// and returns OpenAI's SDP answer. If an older preview sends no SDP, we fall
// back to minting a short-lived client secret. The OPENAI_API_KEY never leaves
// the server.
//
// Per-dialect system prompt + voice is baked into the session config.
import { getDialectIdentity, getDialectVocabRules, primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REALTIME_MODEL = "gpt-realtime-2";

// OpenAI Realtime voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse.
// Mapping chosen to roughly match each dialect persona.
const DIALECT_VOICE: Record<string, string> = {
  Gulf: "ballad",     // warm, grounded — Khaliji vibe
  Egyptian: "shimmer",// bright, expressive — Cairo storyteller
  Yemeni: "verse",    // measured — Sana'ani host
};

function difficultyExtras(difficulty: string): string {
  if (difficulty === "advanced") {
    return "The student is advanced. Speak naturally at full pace. Use idioms and culturally rich expressions. Challenge them.";
  }
  if (difficulty === "intermediate") {
    return "The student is intermediate. Mix common and less common vocabulary. Correct mistakes briefly and warmly.";
  }
  return "The student is a beginner. Use short, simple sentences. Speak slowly and clearly. Be patient and encouraging.";
}

function buildSystemInstruction(dialect: Dialect, difficulty: string, topicHint?: string): string {
  const identity = getDialectIdentity(dialect);
  const vocab = getDialectVocabRules(dialect);
  const topic = topicHint?.trim()
    ? `Today's topic: ${topicHint}. Open by inviting them to talk about it in one short sentence.`
    : "Greet the student warmly and ask what they'd like to talk about — keep it to one short sentence.";

  return `${identity}

${vocab}

You are a friendly conversation partner on a voice call. This is spoken dialogue — keep every turn short (1-2 sentences), natural, and back-and-forth. NEVER read long monologues. Wait for the student to respond.

${difficultyExtras(difficulty)}

Strict rules:
- Speak ONLY in your assigned dialect — no Modern Standard Arabic (فصحى).
- Never switch to another Arabic dialect.
- If the student speaks English, briefly answer in dialect and gently guide them back.
- No transliteration, no Latin-letter pronunciation guides.
- Use natural spoken intonation, not reading-aloud style.

${topic}`;
}

async function safetyIdentifier(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cap = await enforceDailyCap(req, "live-session", 30, corsHeaders);
  if (cap.limited) return cap.response;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sdp = typeof body.sdp === "string" ? body.sdp.trim() : "";
    const dialect = (body.dialect ?? "Gulf") as Dialect;
    const difficulty = (body.difficulty ?? "beginner") as string;
    const topicHint = (body.topicHint ?? "") as string;

    // Warm the dialect rulebook cache so identity/vocab include admin edits.
    try { await primeDialectPrompt(dialect); } catch { /* fallback to hard-coded */ }

    const voice = DIALECT_VOICE[dialect] ?? DIALECT_VOICE.Gulf;
    const instructions = buildSystemInstruction(dialect, difficulty, topicHint);
    const sessionConfig = {
      type: "realtime",
      model: REALTIME_MODEL,
      output_modalities: ["audio"],
      instructions,
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            language: "ar",
            prompt: `Arabic speech. The learner may use ${dialect} dialect or English. Preserve Arabic dialect wording in the transcript.`,
          },
          turn_detection: {
            type: "semantic_vad",
          },
        },
        output: {
          voice,
        },
      },
    };

    if (!sdp) {
      const tokenUpstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": await safetyIdentifier(cap.userId),
        },
        body: JSON.stringify({ session: sessionConfig }),
      });

      if (!tokenUpstream.ok) {
        const txt = await tokenUpstream.text();
        console.error("[realtime-session-token] client secret upstream error", tokenUpstream.status, txt);
        return new Response(
          JSON.stringify({ error: "Failed to mint Realtime client secret", details: txt }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const data = await tokenUpstream.json();
      return new Response(
        JSON.stringify({
          value: data.value,
          client_secret: data.value,
          expires_at: data.expires_at,
          model: REALTIME_MODEL,
          voice,
          session_id: data.session?.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!sdp.startsWith("v=")) {
      return new Response(
        JSON.stringify({
          error: "Invalid SDP offer",
          message: "The browser sent a malformed WebRTC offer. Refresh the preview and try Live voice again in Chrome or Edge.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(sessionConfig));

    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Safety-Identifier": await safetyIdentifier(cap.userId),
      },
      body: form,
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      console.error("[realtime-session-token] upstream error", upstream.status, txt);
      return new Response(
        JSON.stringify({ error: "Failed to mint Realtime session token", details: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const answerSdp = await upstream.text();
    return new Response(answerSdp, {
      headers: { ...corsHeaders, "Content-Type": "application/sdp" },
    });
  } catch (e) {
    console.error("[realtime-session-token] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
