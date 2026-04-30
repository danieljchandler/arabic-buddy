// Ask AI questions about a sentence and its translation. Streams via Lovable AI Gateway.
import { getDialectIdentity, getDialectLabel, getDialectVocabRules, type Dialect } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  arabic: string;
  english?: string;
  dialect?: Dialect;
  messages: ChatMessage[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    const { arabic, english, dialect, messages } = body;

    if (!arabic || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "arabic and messages are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialectId = getDialectIdentity(dialect || "Gulf");
    const dialectLabel = getDialectLabel(dialect || "Gulf");
    const vocabRules = getDialectVocabRules(dialect || "Gulf");

    const systemPrompt = `You are a friendly, expert Arabic language tutor specializing in ${dialectLabel}.
A learner is studying this sentence and may ask anything about it (translation choices, grammar, vocabulary, cultural nuance, alternative phrasings, pronunciation hints, etymology, related expressions, etc.).

THE SENTENCE:
Arabic: ${arabic}
${english ? `English translation provided: ${english}` : "(no English translation provided)"}

DIALECT CONTEXT:
${dialectId}

${vocabRules}

GUIDELINES:
- Answer the learner's question directly and clearly in English (since they are learning).
- When showing Arabic words/phrases, use the script then a transliteration in parentheses, e.g. شلونك (shlonak).
- Explain WHY translations are phrased a certain way — idioms, word order, register, dialect-specific choices.
- Keep answers concise but rich. Use short paragraphs or bullet points. Markdown is rendered.
- If the learner asks for "more", expand with examples, related vocabulary, or cultural context.
- Stay scoped to this sentence and Arabic learning. Politely decline unrelated topics.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit reached. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiResponse.text();
      console.error("ask-translation gateway error", aiResponse.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (err) {
    console.error("ask-translation error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
