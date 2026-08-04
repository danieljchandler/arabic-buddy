import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getTashkeelMandate, getDialectTransliterationRules, primeDialectPrompt, measureTashkeelCoverage, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { LITERAL_GLOSS_RULE, literalSchema } from "../_shared/literalGloss.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";

/**
 * Structural quality gate: returns null when the draft is finished (so the
 * expensive critic rewrite pass is skipped), or a short reason otherwise.
 */
function passageQualityGate(parsed: unknown): string | null {
  const p = parsed as any;
  if (!p || typeof p !== "object") return "draft is not an object";
  if (!p.title || typeof p.title !== "string" || !p.title.trim()) return "missing title";

  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (lines.length === 0) return "no lines";
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  for (const [i, l] of lines.entries()) {
    if (!nonEmpty(l?.arabic)) return `line ${i + 1} missing arabic`;
    if (!nonEmpty(l?.transliteration)) return `line ${i + 1} missing transliteration`;
    if (!nonEmpty(l?.english)) return `line ${i + 1} missing english`;
    const lit = l?.literal;
    const litOk = nonEmpty(lit) || (Array.isArray(lit) && lit.length > 0) || (lit && typeof lit === "object" && Object.keys(lit).length > 0);
    if (!litOk) return `line ${i + 1} missing literal gloss`;
  }

  if (!Array.isArray(p.vocabulary) || p.vocabulary.length === 0) return "no vocabulary items";

  const questions = Array.isArray(p.questions) ? p.questions : [];
  const goodQuestion = questions.some((q: any) =>
    nonEmpty(q?.question) &&
    Array.isArray(q?.options) &&
    q.options.length >= 2 &&
    q.options.some((o: any) => o?.correct === true)
  );
  if (!goodQuestion) return "no usable comprehension question";

  const arabicText = [p.title, ...lines.map((l: any) => l?.arabic ?? "")].join("\n");
  const coverage = measureTashkeelCoverage(arabicText);
  if (coverage <= 0.45) return `tashkeel coverage too low (${coverage.toFixed(2)})`;

  return null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const tStart = Date.now();
  const timing: Record<string, number> = {};

  try {
    const { difficulty = "beginner", topic, dialect = "Gulf" } = await req.json();

    // Rulebook priming depends on nothing else — start it immediately so it
    // overlaps the cap check and the learner-profile lookup.
    const rulesPromise = primeDialectPrompt(dialect as Dialect).catch(() => {});

    // Free-tier daily cap
    const tCap = Date.now();
    const cap = await enforceDailyCap(req, "reading-passage", 15, corsHeaders);
    timing.cap_ms = Date.now() - tCap;
    if (cap.limited) return cap.response;

    const dialectLabel = getDialectLabel(dialect);

    // Learner model, built server-side from the caller's real SRS state across
    // both decks. This replaces the old client-supplied `userVocab` argument,
    // which was fed the entire curriculum vocabulary shuffled (useAllWords) and
    // labelled "words the student knows" — so passages were being built around
    // words the learner had often never seen. Callers may still send `userVocab`;
    // it is deliberately ignored.
    const tProfile = Date.now();
    const [learnerBlock] = await Promise.all([
      learnerPromptBlock({ userId: cap.userId, dialect }),
      rulesPromise,
    ]);
    timing.profile_rules_ms = Date.now() - tProfile;

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
    const tGen = Date.now();
    try {
      const brain = await askBrain<any>({
        purpose: "reading_passage",
        dialect: dialect as Dialect,
        strategy: "draft_critic",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 3072,
        temperature: 0.8,
        budgetMs: 80_000,
        qualityGate: passageQualityGate,

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
                  required: ["arabic", "transliteration", "english"],
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
