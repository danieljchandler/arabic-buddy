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

    const topicContext = topic ? `Topic: ${topic}` : "Topic: daily life, culture, or social situations";

    const systemPrompt = `You are an Arabic language instructor creating reading comprehension exercises.
Focus on Gulf Arabic dialect with some Modern Standard Arabic.
Generate engaging, culturally relevant passages appropriate for the difficulty level.

IMPORTANT: Return valid JSON only, no markdown code blocks.`;

    const difficultyGuide = {
      beginner: "2-3 short sentences, simple vocabulary, common phrases",
      intermediate: "4-5 sentences, varied vocabulary, some idiomatic expressions",
      advanced: "6-8 sentences, complex structures, cultural nuances, formal/informal mix",
    };

    const userPrompt = `Generate a reading comprehension exercise.

Difficulty: ${difficulty} (${difficultyGuide[difficulty as keyof typeof difficultyGuide]})
${topicContext}
${vocabContext}

Return JSON in this exact format:
{
  "title": "Arabic title",
  "titleEnglish": "English title",
  "passage": "Full Arabic passage text",
  "passageEnglish": "Full English translation",
  "difficulty": "${difficulty}",
  "vocabulary": [
    {"arabic": "كلمة", "english": "word", "inContext": "how it's used in passage"}
  ],
  "questions": [
    {
      "question": "Arabic question about the passage",
      "questionEnglish": "English translation of question",
      "options": [
        {"text": "Arabic option", "textEnglish": "English", "correct": true},
        {"text": "Arabic option", "textEnglish": "English", "correct": false},
        {"text": "Arabic option", "textEnglish": "English", "correct": false}
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
        model: "google/gemini-2.5-flash",
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
      // Return fallback passage
      passage = {
        title: "في السوق",
        titleEnglish: "At the Market",
        passage: "ذهبت إلى السوق اليوم. اشتريت خضار وفواكه طازجة.",
        passageEnglish: "I went to the market today. I bought fresh vegetables and fruits.",
        difficulty: "beginner",
        vocabulary: [
          { arabic: "السوق", english: "the market", inContext: "place of shopping" },
          { arabic: "خضار", english: "vegetables", inContext: "fresh produce" },
        ],
        questions: [
          {
            question: "أين ذهب الكاتب؟",
            questionEnglish: "Where did the writer go?",
            options: [
              { text: "إلى السوق", textEnglish: "To the market", correct: true },
              { text: "إلى المدرسة", textEnglish: "To school", correct: false },
              { text: "إلى البيت", textEnglish: "To home", correct: false },
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
