import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuizQuestion {
  type: "dictation" | "comprehension" | "speed";
  audioText: string;
  audioTextEnglish: string;
  options?: { text: string; textArabic: string; correct: boolean }[];
  hint?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mode, words, count = 5 } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build context from user's vocabulary
    const vocabContext = words
      .slice(0, 20)
      .map((w: any) => `${w.word_arabic} (${w.word_english})`)
      .join(", ");

    const systemPrompt = `You are an Arabic language tutor creating listening comprehension exercises.
Focus on Gulf Arabic dialect when possible.
Generate exercises using these vocabulary words the student knows: ${vocabContext}

IMPORTANT: Return valid JSON only, no markdown.`;

    let userPrompt = "";

    if (mode === "dictation") {
      userPrompt = `Generate ${count} Arabic sentences for dictation practice.
Use simple, clear sentences with vocabulary the student knows.
Return JSON array:
[
  {
    "type": "dictation",
    "audioText": "Arabic sentence",
    "audioTextEnglish": "English translation",
    "hint": "First word hint"
  }
]`;
    } else if (mode === "comprehension") {
      userPrompt = `Generate ${count} listening comprehension questions.
Create a sentence in Arabic, then ask what a word means or what the sentence is about.
Return JSON array:
[
  {
    "type": "comprehension",
    "audioText": "Arabic sentence to listen to",
    "audioTextEnglish": "English translation",
    "options": [
      {"text": "Correct answer in English", "textArabic": "صحيح", "correct": true},
      {"text": "Wrong answer 1", "textArabic": "خطأ", "correct": false},
      {"text": "Wrong answer 2", "textArabic": "خطأ", "correct": false}
    ]
  }
]`;
    } else {
      // speed mode - shorter, clearer phrases
      userPrompt = `Generate ${count} short Arabic phrases for speed listening practice.
Keep them 2-4 words, clear and distinct.
Return JSON array:
[
  {
    "type": "speed",
    "audioText": "Short Arabic phrase",
    "audioTextEnglish": "English translation"
  }
]`;
    }

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
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    // Parse JSON from response
    let questions: QuizQuestion[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse quiz questions:", e, content);
      // Return fallback questions
      questions = [
        {
          type: mode,
          audioText: "مرحبا",
          audioTextEnglish: "Hello",
          hint: "م",
        },
      ];
    }

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("listening-quiz error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
