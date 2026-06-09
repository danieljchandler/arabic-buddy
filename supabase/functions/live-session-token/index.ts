// live-session-token — mints a short-lived ephemeral token so the browser can
// open a Gemini Live API WebSocket directly (audio in/out) without ever seeing
// GEMINI_API_KEY. Token is bound to model + system instruction + voice.
import { getDialectIdentity, getDialectVocabRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LIVE_MODEL = "models/gemini-2.0-flash-live-001";

// Native-audio voices that work with the Live preview model.
// Mapping aims to roughly match each dialect module's persona.
const DIALECT_VOICE: Record<string, string> = {
  Gulf: "Charon",     // deep, grounded male — Khaliji elder vibe
  Egyptian: "Aoede",  // warm, expressive female — Cairo storyteller
  Yemeni: "Orus",     // measured male — Sana'ani host
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

You are a friendly conversation partner on a voice call. This is spoken dialogue — keep every turn short (1-2 sentences), natural, and back-and-forth. NEVER read out long monologues.

${difficultyExtras(difficulty)}

Strict rules:
- Speak ONLY in your assigned dialect — no Modern Standard Arabic (فصحى).
- Never switch to another Arabic dialect.
- If the student speaks English, briefly answer in dialect and gently guide them back.
- No transliteration, no Latin-letter pronunciation guides.

${topic}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 30 live sessions/user/day on free tier.
  const cap = await enforceDailyCap(req, "live-session", 30, corsHeaders);
  if (cap.limited) return cap.response;

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dialect = (body.dialect ?? "Gulf") as Dialect;
    const difficulty = (body.difficulty ?? "beginner") as string;
    const topicHint = (body.topicHint ?? "") as string;

    const voiceName = DIALECT_VOICE[dialect] ?? DIALECT_VOICE.Gulf;
    const systemInstruction = buildSystemInstruction(dialect, difficulty, topicHint);

    // Token is single-use; once consumed it lets the resulting session run for ~10min.
    const now = Date.now();
    const tokenExpire = new Date(now + 60 * 1000).toISOString();
    const sessionExpire = new Date(now + 10 * 60 * 1000).toISOString();

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime: tokenExpire,
          newSessionExpireTime: sessionExpire,
          bidiGenerateContentSetup: {
            model: LIVE_MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
                languageCode: "ar-XA",
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {},
            },
          },
        }),
      },
    );

    if (!upstream.ok) {
      const txt = await upstream.text();
      console.error("[live-session-token] upstream error", upstream.status, txt);
      return new Response(
        JSON.stringify({ error: "Failed to mint Live session token", details: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await upstream.json();
    return new Response(
      JSON.stringify({
        token: data.name,
        expireTime: data.expireTime ?? tokenExpire,
        model: LIVE_MODEL,
        voice: voiceName,
        sessionExpireTime: sessionExpire,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[live-session-token] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
