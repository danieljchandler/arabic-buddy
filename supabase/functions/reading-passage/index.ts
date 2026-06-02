import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "reading-passage", 15, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { difficulty = "beginner", topic, userVocab = [], dialect = "Gulf" } = await req.json();

    const dialectLabel = getDialectLabel(dialect);

    const vocabContext = userVocab.length > 0
      ? `Include some of these words the student knows: ${userVocab.slice(0, 15).map((w: any) => w.word_arabic).join(", ")}`
      : "";

    const culturalContext = dialect === "Egyptian"
      ? "daily life, culture, or social situations in Egypt (Cairo, Alexandria, etc.)"
      : dialect === "Yemeni"
      ? "daily life, culture, or social situations in Yemen (Sana'a, Aden, Hadramaut, qat sessions, traditional architecture)"
      : "daily life, culture, or social situations in the Gulf";

    const topicContext = topic ? `Topic: ${topic}` : `Topic: ${culturalContext}`;

    const difficultyGuide: Record<string, string> = {
      beginner: `2-3 short sentences, simple ${dialectLabel} vocabulary, common everyday phrases`,
      intermediate: `4-5 sentences, varied ${dialectLabel} vocabulary, colloquial expressions and cultural references`,
      advanced: `6-8 sentences, complex structures, idiomatic ${dialectLabel} expressions`,
    };

    const systemExtra = `You are a ${dialectLabel} language instructor creating reading comprehension exercises.
- Set passages in culturally authentic contexts.
- Generate engaging, culturally relevant passages appropriate for the difficulty level.
- The primary passage text MUST be in ${dialectLabel} dialect, not MSA.
- Return the structured fields via the provided tool only.`;

    const userPrompt = `Generate a reading comprehension exercise.

Difficulty: ${difficulty} (${difficultyGuide[difficulty] || difficultyGuide.beginner})
${topicContext}
${vocabContext}

Split the passage into individual sentences in the "lines" array (each line = one sentence with its Arabic text and English translation). Generate 3-4 vocabulary items and 2-3 comprehension questions.`;

    let passage: any;
    try {
      const brain = await askBrain<any>({
        purpose: "reading_passage",
        dialect: dialect as Dialect,
        strategy: "draft_critic",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.8,
        arabicTextPath: (p: any) => {
          const parts: string[] = [];
          if (typeof p?.title === "string") parts.push(p.title);
          if (Array.isArray(p?.lines)) for (const l of p.lines) if (typeof l?.arabic === "string") parts.push(l.arabic);
          if (Array.isArray(p?.questions)) for (const q of p.questions) if (typeof q?.question === "string") parts.push(q.question);
          return parts.join("\n");
        },
        tool: {
          name: "emit_reading_passage",
          description: `Reading passage in ${dialectLabel}.`,
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              titleEnglish: { type: "string" },
              lines: {
                type: "array",
                items: {
                  type: "object",
                  properties: { arabic: { type: "string" }, english: { type: "string" } },
                  required: ["arabic", "english"],
                },
              },
              difficulty: { type: "string" },
              vocabulary: {
                type: "array",
                items: {
                  type: "object",
                  properties: { arabic: { type: "string" }, english: { type: "string" }, inContext: { type: "string" } },
                  required: ["arabic", "english"],
                },
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string" },
                    questionEnglish: { type: "string" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { text: { type: "string" }, textEnglish: { type: "string" }, correct: { type: "boolean" } },
                        required: ["text", "textEnglish", "correct"],
                      },
                    },
                  },
                  required: ["question", "options"],
                },
              },
            },
            required: ["title", "titleEnglish", "lines", "vocabulary", "questions"],
          },
        },
      });
      passage = brain.output;
      if (brain.msaLeaks.leaks.length > 0) {
        console.warn("reading-passage MSA leaks after repair:", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
      }
    } catch (e: any) {
      console.error("reading-passage brain error:", e?.status, e?.message);
      if (e?.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (e?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      passage = {
        title: "في السوق",
        titleEnglish: "At the Market",
        lines: [
          { arabic: "رحت السوق اليوم.", english: "I went to the market today." },
          { arabic: "شريت خضار وفواكه طازجة.", english: "I bought fresh vegetables and fruits." },
        ],
        difficulty,
        vocabulary: [{ arabic: "السوق", english: "the market", inContext: "place of shopping" }],
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
