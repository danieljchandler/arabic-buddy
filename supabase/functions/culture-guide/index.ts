import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectIdentity, getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildSystemPrompt(dialect: string): string {
  const dialectLabel = getDialectLabel(dialect);
  const identity = getDialectIdentity(dialect);
  const vocabRules = getDialectVocabRules(dialect);

  const regionDesc = dialect === 'Egyptian'
    ? 'Egyptian Arabic (مصري) — an Arabic language learning platform focused on Egyptian culture (Cairo, Alexandria, Upper Egypt, Delta region).'
    : 'Gulf Arabic (Saudi, Emirati, Kuwaiti, Qatari, Bahraini, Omani culture).';

  const regionGuidelines = dialect === 'Egyptian'
    ? `- Always provide the Egyptian Arabic phrase/response in Arabic script, transliteration, and English translation
- Explain the cultural reasoning behind your advice
- Mention if customs vary between regions of Egypt (Cairo vs Upper Egypt vs Alexandria etc.)
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms
- When giving Arabic phrases, prefer Egyptian dialect over MSA unless the context calls for formal Arabic`
    : `- Always provide the Gulf Arabic phrase/response in Arabic script, transliteration, and English translation
- Explain the cultural reasoning behind your advice
- Mention if customs vary between Gulf countries (Saudi vs UAE vs Kuwait etc.)
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms
- When giving Arabic phrases, prefer Gulf dialect over MSA unless the context calls for formal Arabic`;

  return `${identity}

You are a ${dialectLabel} cultural advisor for the app "Lahja" — an Arabic language learning platform focused on ${regionDesc}

Your role: Help users navigate real-life social situations with culturally appropriate responses, phrases, and etiquette.

${vocabRules}

Guidelines:
${regionGuidelines}
- If the situation involves religious or sensitive topics, be respectful and factual
- If you're not confident about specific regional customs, say so clearly
- Keep responses warm, practical, and conversational
- You can respond in English or Arabic depending on which language the user writes in

If the user's question is completely unrelated to Arabic culture, politely redirect them.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, dialect = "Gulf" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SYSTEM_PROMPT = buildSystemPrompt(dialect);

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable. Please try again later." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("culture-guide error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
