import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { difficulty = "beginner", topic, userVocab = [], dialect = "Gulf" } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);

    const vocabContext = userVocab.length > 0
      ? `Include some of these words the student knows: ${userVocab.slice(0, 15).map((w: any) => w.word_arabic).join(", ")}`
      : "";

    const culturalContext = dialect === "Egyptian"
      ? "daily life, culture, or social situations in Egypt (Cairo, Alexandria, etc.)"
      : dialect === "Yemeni"
      ? "daily life, culture, or social situations in Yemen (Sana'a, Aden, Hadramaut, qat sessions, traditional architecture)"
      : "daily life, culture, or social situations in the Gulf";

    const topicContext = topic ? `Topic: ${topic}` : `Topic: ${culturalContext}`;

    const systemPrompt = `You are a ${dialectLabel} language instructor creating reading comprehension exercises.

${dialectRules}
- For advanced levels, you may introduce MSA comparisons but the primary text MUST be in ${dialectLabel} dialect.
- Set passages in culturally authentic contexts.
- Generate engaging, culturally relevant passages appropriate for the difficulty level.

IMPORTANT: Return valid JSON only, no markdown code blocks.`;

    const difficultyGuide: Record<string, string> = {
      beginner: `2-3 short sentences, simple ${dialectLabel} vocabulary, common everyday phrases`,
      intermediate: `4-5 sentences, varied ${dialectLabel} vocabulary, colloquial expressions and cultural references`,
      advanced: `6-8 sentences, complex structures, idiomatic ${dialectLabel} expressions`,
    };

    const userPrompt = `Generate a reading comprehension exercise.

Difficulty: ${difficulty} (${difficultyGuide[difficulty] || difficultyGuide.beginner})
${topicContext}
${vocabContext}

Return JSON in this exact format:
{
  "title": "${dialectLabel} title",
  "titleEnglish": "English title",
  "lines": [
    {"arabic": "One sentence in ${dialectLabel}", "english": "English translation of that sentence"}
  ],
  "difficulty": "${difficulty}",
  "vocabulary": [{"arabic": "كلمة", "english": "word", "inContext": "how it's used"}],
  "questions": [{"question": "${dialectLabel} question", "questionEnglish": "English translation", "options": [{"text": "option", "textEnglish": "English", "correct": true}, {"text": "option", "textEnglish": "English", "correct": false}]}]
}

IMPORTANT: Split the passage into individual sentences in the "lines" array. Each line should be one sentence with its Arabic text and English translation.
Generate 3-4 vocabulary items and 2-3 comprehension questions.`;

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
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let passage;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        passage = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse passage:", e, content);
      passage = {
        title: "في السوق",
        titleEnglish: "At the Market",
        passage: "رحت السوق اليوم. شريت خضار وفواكه طازجة.",
        passageEnglish: "I went to the market today. I bought fresh vegetables and fruits.",
        difficulty: "beginner",
        vocabulary: [
          { arabic: "السوق", english: "the market", inContext: "place of shopping" },
        ],
        questions: [
          {
            question: "وين راح الكاتب؟",
            questionEnglish: "Where did the writer go?",
            options: [
              { text: "السوق", textEnglish: "The market", correct: true },
              { text: "المدرسة", textEnglish: "School", correct: false },
              { text: "البيت", textEnglish: "Home", correct: false },
            ],
          },
        ],
      };
    }

    return new Response(JSON.stringify({ passage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reading-passage error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
