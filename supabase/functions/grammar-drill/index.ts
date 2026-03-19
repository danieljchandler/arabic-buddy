import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { category, difficulty, dialect = "Gulf" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);

    const systemPrompt = `You are a ${dialectLabel} grammar teacher. Generate exactly 5 multiple-choice grammar drill questions.

${dialectRules}

Category: ${category || "mixed"}
Difficulty: ${difficulty || "beginner"}

Each question should test a specific ${dialectLabel} grammar concept. Include verb conjugation, pronoun usage, sentence structure, negation, and possessives as appropriate.

You MUST call the suggest_questions function with your response.`;

    const userPrompt = `Generate 5 ${difficulty || "beginner"} level ${dialectLabel} grammar questions about "${category || "mixed grammar"}". Each question should have the Arabic text, an English explanation of what's being tested, 4 answer choices (with Arabic text), and indicate the correct answer index (0-3). Include a brief explanation for why the correct answer is right.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_questions",
              description: "Return 5 grammar drill questions",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_arabic: { type: "string" },
                        question_english: { type: "string" },
                        grammar_point: { type: "string" },
                        choices: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text_arabic: { type: "string" },
                              text_english: { type: "string" },
                            },
                            required: ["text_arabic", "text_english"],
                            additionalProperties: false,
                          },
                        },
                        correct_index: { type: "number" },
                        explanation: { type: "string" },
                      },
                      required: ["question_arabic", "question_english", "grammar_point", "choices", "correct_index", "explanation"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_questions" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No tool call in response");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grammar-drill error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
