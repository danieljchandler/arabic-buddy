// realtime-session-token — mints a short-lived OpenAI Realtime API ephemeral
// token so the browser can open a WebRTC connection to gpt-4o-realtime-preview
// directly. The OPENAI_API_KEY never leaves the server.
//
// Per-dialect system prompt + voice is baked into the session config.
import { getDialectIdentity, getDialectVocabRules, primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

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
    const dialect = (body.dialect ?? "Gulf") as Dialect;
    const difficulty = (body.difficulty ?? "beginner") as string;
    const topicHint = (body.topicHint ?? "") as string;

    // Warm the dialect rulebook cache so identity/vocab include admin edits.
    try { await primeDialectPrompt(dialect); } catch { /* fallback to hard-coded */ }

    const voice = DIALECT_VOICE[dialect] ?? DIALECT_VOICE.Gulf;
    const instructions = buildSystemInstruction(dialect, difficulty, topicHint);

    const upstream = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice,
        modalities: ["audio", "text"],
        instructions,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      console.error("[realtime-session-token] upstream error", upstream.status, txt);
      return new Response(
        JSON.stringify({ error: "Failed to mint Realtime session token", details: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await upstream.json();
    // data.client_secret = { value, expires_at }
    return new Response(
      JSON.stringify({
        client_secret: data.client_secret?.value,
        expires_at: data.client_secret?.expires_at,
        model: REALTIME_MODEL,
        voice,
        session_id: data.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[realtime-session-token] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
