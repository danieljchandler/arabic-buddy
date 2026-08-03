import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getDialectLabel,
  getTashkeelMandate,
  getDialectTransliterationRules,
  primeDialectPrompt,
  type Dialect,
} from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { LITERAL_GLOSS_RULE, literalSchema } from "../_shared/literalGloss.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { readingPassageGate } from "../_shared/passageQualityCore.ts";

/**
 * Wall-clock ceiling for the generation, kept under the client's own timeout so
 * a slow run surfaces as a real error with a retry rather than an unbounded
 * spinner. Must stay in sync with PASSAGE_TIMEOUT_MS in
 * src/pages/ReadingPractice.tsx.
 *
 * This is a ceiling, not a target: the typical request now finishes in one
 * drafting pass well inside it. It is sized to still fit a draft *plus* a full
 * critic rewrite when the quality gate demands one, so bounding the pathological
 * case never costs a passage that needed fixing.
 */
const GENERATION_BUDGET_MS = 80_000;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { difficulty = "beginner", topic, dialect = "Gulf" } = await req.json();

    // Warm the dialect rulebook cache now. It depends on nothing else in the
    // request, so it has no business sitting behind the auth and learner-profile
    // round trips the way it did when askBrain was the first to touch it.
    const priming = primeDialectPrompt(dialect as Dialect);

    // Free-tier daily cap
    const cap = await enforceDailyCap(req, "reading-passage", 15, corsHeaders);
    if (cap.limited) return cap.response;

    const dialectLabel = getDialectLabel(dialect);

    // Learner model, built server-side from the caller's real SRS state across
    // both decks. This replaces the old client-supplied `userVocab` argument,
    // which was fed the entire curriculum vocabulary shuffled (useAllWords) and
    // labelled "words the student knows" — so passages were being built around
    // words the learner had often never seen. Callers may still send `userVocab`;
    // it is deliberately ignored.
    const [learnerBlock] = await Promise.all([
      learnerPromptBlock({ userId: cap.userId, dialect }),
      priming,
    ]);

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

${getTashkeelMandate()}
- title and every line's "arabic" field must be fully vocalized.

${getDialectTransliterationRules(dialect as Dialect)}
- Provide a transliteration for every line.

${LITERAL_GLOSS_RULE}
- Provide a "literal" gloss for every line.

- Return the structured fields via the provided tool only.

${learnerBlock}`;

    const userPrompt = `Generate a reading comprehension exercise.

Difficulty: ${difficulty} (${difficultyGuide[difficulty] || difficultyGuide.beginner})
${topicContext}

Split the passage into individual sentences in the "lines" array (each line = one sentence with its Arabic text, natural English translation, and literal word-for-word gloss). Generate 3-4 vocabulary items and 2-3 comprehension questions.`;

    let passage: any;
    try {
      const brain = await askBrain<any>({
        purpose: "reading_passage",
        dialect: dialect as Dialect,
        strategy: "draft_critic",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 3072,
        temperature: 0.8,
        budgetMs: GENERATION_BUDGET_MS,
        // What the critic pass is actually there to guarantee, stated as a
        // check we can run locally in microseconds. A draft that already has
        // full tashkeel, a transliteration, a natural translation and a literal
        // gloss on every line — plus vocabulary and an answerable quiz — is
        // finished, and re-generating it through the critic only costs the
        // learner another 30-60s of spinner. Anything missing still triggers
        // the full rewrite. See _shared/passageQualityCore.ts.
        qualityGate: readingPassageGate,
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
                  properties: {
                    arabic: { type: "string" },
                    transliteration: { type: "string" },
                    english: { type: "string" },
                    literal: literalSchema("sentence"),
                  },
                  // `literal` is required here, not merely described: the quality
                  // gate below refuses a draft without it, and a schema that asks
                  // for it up front is much cheaper than a rewrite pass that adds it.
                  required: ["arabic", "transliteration", "english", "literal"],
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
                  required: ["question", "questionEnglish", "options"],
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
