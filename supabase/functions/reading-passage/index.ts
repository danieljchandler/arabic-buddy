import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReadingPassage {
  title: string;
  titleEnglish: string;
  passage: string;
  passageEnglish: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  vocabulary: { arabic: string; english: string; inContext: string }[];
  questions: {
    question: string;
    questionEnglish: string;
    options: { text: string; textEnglish: string; correct: boolean }[];
  }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { difficulty = "beginner", topic, userVocab = [] } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build context from user's vocabulary if available
    const vocabContext = userVocab.length > 0
      ? `Include some of these words the student knows: ${userVocab.slice(0, 15).map((w: any) => w.word_arabic).join(", ")}`
      : "";

    const topicContext = topic ? `Topic: ${topic}` : "Topic: daily life, culture, or social situations in the Gulf";

    const systemPrompt = `You are a Gulf Arabic (Khaliji) language instructor creating reading comprehension exercises.

CRITICAL DIALECT RULES:
- For beginner and intermediate levels, use Gulf Arabic dialect EXCLUSIVELY. Do NOT use Modern Standard Arabic (فصحى).
- Use dialectal vocabulary: شلون، وين، هالحين، ليش، واجد، يبي، إمبي، خوش، زين instead of MSA equivalents.
- For advanced levels, you may introduce MSA comparisons but the primary text MUST be in Gulf Arabic dialect.
- Set passages in culturally authentic Gulf contexts (مجلس، سوق، مطار، كافيه، فريج).
- Generate engaging, culturally relevant passages appropriate for the difficulty level.

IMPORTANT: Return valid JSON only, no markdown code blocks.`;

    const difficultyGuide = {
      beginner: "2-3 short sentences, simple Gulf Arabic vocabulary, common everyday phrases",
      intermediate: "4-5 sentences, varied Gulf vocabulary, colloquial expressions and cultural references",
      advanced: "6-8 sentences, complex structures, idiomatic Gulf Arabic expressions, may include MSA comparisons",
    };

    const userPrompt = `Generate a reading comprehension exercise.

Difficulty: ${difficulty} (${difficultyGuide[difficulty as keyof typeof difficultyGuide]})
${topicContext}
${vocabContext}

Return JSON in this exact format:
{
  "title": "Gulf Arabic title",
  "titleEnglish": "English title",
  "passage": "Full Gulf Arabic passage text",
  "passageEnglish": "Full English translation",
  "difficulty": "${difficulty}",
  "vocabulary": [
    {"arabic": "كلمة", "english": "word", "inContext": "how it's used in passage"}
  ],
  "questions": [
    {
      "question": "Gulf Arabic question about the passage",
      "questionEnglish": "English translation of question",
      "options": [
        {"text": "Gulf Arabic option", "textEnglish": "English", "correct": true},
        {"text": "Gulf Arabic option", "textEnglish": "English", "correct": false},
        {"text": "Gulf Arabic option", "textEnglish": "English", "correct": false}
      ]
    }
  ]
}

Generate 3-4 vocabulary items and 2-3 comprehension questions.
Questions should test understanding, not just word lookup.`;

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
        return new Response(
          JSON.stringify({ error: "Not enough AI credits. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    // Parse JSON from response
    let passage: ReadingPassage;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        passage = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse passage:", e, content);
      // Return fallback passage in Gulf Arabic
      passage = {
        title: "في السوق",
        titleEnglish: "At the Market",
        passage: "رحت السوق اليوم. شريت خضار وفواكه طازجة.",
        passageEnglish: "I went to the market today. I bought fresh vegetables and fruits.",
        difficulty: "beginner",
        vocabulary: [
          { arabic: "السوق", english: "the market", inContext: "place of shopping" },
          { arabic: "شريت", english: "I bought (Gulf)", inContext: "Gulf Arabic past tense of buy" },
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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
