import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userVocab = [], streakDays = 0 } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Determine challenge type based on day of week for variety
    const dayOfWeek = new Date().getDay();
    const challengeTypes = ["translate", "fill_blank", "unscramble", "match", "dictation", "culture", "speed"];
    const todayType = challengeTypes[dayOfWeek];

    const vocabContext = userVocab.length > 0
      ? userVocab.slice(0, 15).map((w: any) => `${w.word_arabic} (${w.word_english})`).join(", ")
      : "مرحبا (hello), شكراً (thanks), شلونك (how are you), ماي (water), بيت (house)";

    // Bonus XP for streaks
    const streakMultiplier = streakDays >= 7 ? 2.0 : streakDays >= 3 ? 1.5 : 1.0;

    const systemPrompt = `You are a Gulf Arabic (Khaliji) language challenge generator for a daily challenge feature.

CRITICAL DIALECT RULES:
- Always use Gulf Arabic (Khaliji) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: شلونك (not كيف حالك), وين (not أين), هالحين (not الآن), ليش (not لماذا), واجد (not كثير), يبي (not يريد), إمبي (not أريد), شي (not شيء).
- Arabic script must reflect Gulf pronunciation and spelling conventions.
- Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).

IMPORTANT: Return valid JSON only, no markdown.`;

    const prompts: Record<string, string> = {
      translate: `Generate 5 translation challenges using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Translation", "titleArabic": "ترجمة اليوم", "questions": [{"prompt": "English phrase", "answer": "Gulf Arabic answer", "options": ["Gulf Arabic option 1", "Gulf Arabic option 2", "Gulf Arabic option 3"]}] }
Options should include the correct answer plus 2 wrong ones. Shuffle the positions.`,

      fill_blank: `Generate 5 fill-in-the-blank sentences using these words: ${vocabContext}
Return JSON: { "type": "fill_blank", "title": "Fill the Gap", "titleArabic": "أكمل الفراغ", "questions": [{"sentence": "Gulf Arabic sentence with ___ blank", "sentenceEnglish": "English translation", "answer": "missing word", "options": ["option1", "option2", "option3"]}] }`,

      unscramble: `Generate 5 word unscramble challenges using these words: ${vocabContext}
Return JSON: { "type": "unscramble", "title": "Word Scramble", "titleArabic": "ترتيب الحروف", "questions": [{"scrambled": "shuffled Arabic letters with spaces", "answer": "correct Arabic word", "hint": "English meaning"}] }`,

      match: `Generate 5 matching pairs using these words: ${vocabContext}
Return JSON: { "type": "match", "title": "Match Pairs", "titleArabic": "وصّل الكلمات", "questions": [{"arabic": "Gulf Arabic word", "english": "English word"}] }`,

      dictation: `Generate 5 short Gulf Arabic phrases for dictation using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Dictation", "titleArabic": "إملاء اليوم", "questions": [{"prompt": "English phrase to translate", "answer": "Correct Gulf Arabic", "options": ["Gulf Arabic option 1", "Gulf Arabic option 2", "Gulf Arabic option 3"]}] }`,

      culture: `Generate 5 Gulf Arabic culture questions about traditions, food, customs from the UAE, Saudi, Kuwait, Qatar, Bahrain, and Oman.
Return JSON: { "type": "translate", "title": "Culture Quiz", "titleArabic": "اختبار ثقافي", "questions": [{"prompt": "Cultural question in English", "answer": "Correct answer", "options": ["option 1", "option 2", "option 3"]}] }`,

      speed: `Generate 5 quick-fire Gulf Arabic vocabulary questions using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Speed Round", "titleArabic": "جولة سريعة", "questions": [{"prompt": "What does this mean: Gulf Arabic word", "answer": "Correct English", "options": ["English option 1", "English option 2", "English option 3"]}] }`,
    };

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
          { role: "user", content: prompts[todayType] || prompts.translate },
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

    let challenge;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        challenge = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse challenge:", e, content);
      challenge = {
        type: "translate",
        title: "Daily Challenge",
        titleArabic: "تحدي اليوم",
        questions: [
          { prompt: "Hello", answer: "هلا", options: ["هلا", "شكراً", "مع السلامة"] },
          { prompt: "Thank you", answer: "مشكور", options: ["هلا", "مشكور", "إي"] },
        ],
      };
    }

    return new Response(
      JSON.stringify({ challenge, streakMultiplier, baseXP: 15 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("daily-challenge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
