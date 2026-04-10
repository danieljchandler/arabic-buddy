import { getDialectIdentity, getDialectVocabRules, type Dialect } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dialect = "Gulf", title_dialect, body_dialect, title_english, summary_english } = await req.json();

    if (!body_dialect) {
      return new Response(
        JSON.stringify({ error: "body_dialect is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dialectIdentity = getDialectIdentity(dialect as Dialect);
    const vocabRules = getDialectVocabRules(dialect as Dialect);

    const systemPrompt = `${dialectIdentity}

${vocabRules}

You are creating a reading comprehension quiz based on a news article written in dialect.
Generate exactly 3 multiple-choice questions that test the reader's understanding of the article content.

Rules:
- Questions should be in DIALECT Arabic (not MSA)
- Each question has exactly 4 choices
- Exactly one choice is correct
- Include a mix of: factual recall, vocabulary meaning, and inference
- Provide a brief explanation for the correct answer (in English)

Return a JSON array of 3 objects, each with:
- "question_arabic": The question in dialect (Arabic)
- "question_english": English translation of the question
- "choices": Array of 4 objects, each {"arabic": "...", "english": "...", "correct": boolean}
- "explanation": Brief English explanation of the correct answer

Return ONLY the JSON array, no markdown fencing.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Create a comprehension quiz for this dialect news article:\n\nHeadline (Arabic): ${title_dialect}\nStory (Arabic): ${body_dialect}\nHeadline (English): ${title_english}\nSummary (English): ${summary_english}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      const errBody = await aiRes.text();
      console.error("AI error:", status, errBody);
      return new Response(
        JSON.stringify({ error: status === 429 ? "Rate limit exceeded" : "Quiz generation failed" }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const questions = JSON.parse(cleaned);

    return new Response(
      JSON.stringify({ questions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("souq-news-quiz error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
