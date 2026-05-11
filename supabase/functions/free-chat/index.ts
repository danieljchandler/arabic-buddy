// free-chat — streaming dialect-aware Arabic tutor chat via Lovable AI Gateway.
// Replaces the scenario-based conversation simulator. Acts as an "active tutor":
// stays in dialect Arabic, calibrates to the user's CEFR level, gently corrects
// mistakes inline, and always nudges the conversation forward with a question.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectIdentity, getDialectVocabRules, getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const LEVEL_GUIDANCE: Record<string, string> = {
  A1: "Use VERY simple, short sentences (3–6 words). Stick to high-frequency words. Repeat key phrases. Avoid idioms.",
  A2: "Use simple sentences (5–10 words). Common everyday vocabulary. Light use of basic connectors.",
  B1: "Use natural conversational sentences (8–14 words). Common idioms allowed. Ask follow-up questions.",
  B2: "Speak naturally with mid-length sentences. Use idioms freely. Challenge the learner gently.",
  C1: "Speak as you would to another native. Use rich vocabulary, idioms, cultural references.",
  C2: "Fully native register. Nuanced phrasing, jokes, regional flavour.",
};

function buildSystemPrompt(dialect: Dialect, cefr: string, topicHint?: string) {
  const level = (cefr || "A2").toUpperCase();
  const levelRule = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.A2;

  return `${getDialectIdentity(dialect)}

${getDialectVocabRules(dialect)}

You are an ACTIVE TUTOR having a free-flowing conversation with a learner whose CEFR level is ${level}.
${levelRule}

CONVERSATION RULES:
1. Reply ONLY in Arabic (${getDialectLabel(dialect)}). Do NOT include English translations or transliteration in your reply text — the UI handles those.
2. Keep replies SHORT and natural — 1 to 3 sentences. This is a chat, not a monologue.
3. ALWAYS end with a question or conversational hook so the learner keeps talking.
4. Stay in dialect — never switch to MSA (فصحى).
5. Sound like a real friend chatting, not a textbook.

CORRECTION RULES (very important):
- If the learner's last message has a clear grammar/vocabulary mistake or used the wrong dialect/MSA, prepend a single line in this EXACT format on its own first line, then a blank line, then your normal Arabic reply:
  [[CORRECTION]] short friendly fix in English (one sentence, ≤ 20 words)
- Only correct genuinely wrong things. Do NOT correct stylistic choices or correct every message.
- If nothing to correct, do NOT include any [[CORRECTION]] line.

${topicHint ? `OPENING TOPIC HINT: The learner picked the topic "${topicHint}" — open the conversation naturally around that subject.` : "OPENING: Start with a warm friendly greeting and ask an open question to get to know the learner."}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, dialect, cefrLevel, topicHint } = await req.json() as {
      messages: ChatMessage[];
      dialect?: Dialect;
      cefrLevel?: string;
      topicHint?: string;
    };

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = buildSystemPrompt(dialect ?? "Gulf", cefrLevel ?? "A2", topicHint);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await resp.text();
      console.error("free-chat gateway error:", resp.status, t.slice(0, 300));
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(resp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("free-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
