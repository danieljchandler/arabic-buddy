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
import { MODEL_IDS, MODEL_LINEUPS } from "../_shared/modelRegistry.ts";

/**
 * Wall-clock ceiling for the generation, kept under the client's own timeout so
 * a slow run surfaces as a real error with a retry rather than an unbounded
 * spinner. Deliberately BELOW PASSAGE_TIMEOUT_MS in
 * src/pages/ReadingPractice.tsx: when the two matched, a run that finished just
 * under the ceiling could still be cut off by the browser, and the reserve also
 * leaves room for the MSA repair pass (which was being skipped as "budget
 * spent" on Yemeni runs, letting leaks like أين/ماذا survive).
 *
 * This is a ceiling, not a target: the typical request finishes in one drafting
 * pass plus a short authenticity check, well inside it. It is sized to still fit
 * a draft *plus* the check *plus* a full rewrite when either gate demands one,
 * so bounding the pathological case never costs a passage that needed fixing.
 */
const GENERATION_BUDGET_MS = 78_000;

/**
 * How long a passage should be, per difficulty.
 *
 * `minLines` is enforced three ways — stated in the prompt, set as `minItems`
 * on the tool schema, and checked by the quality gate so a short draft is sent
 * back for a rewrite rather than shipped. It needs all three: when the sentence
 * count lived only in a parenthetical aside in the prompt, the drafting model
 * happily returned two sentences for an intermediate passage. Nothing caught it
 * because the gate only rejected an *empty* lines array.
 */
const PASSAGE_SHAPE: Record<
  string,
  { minLines: number; maxLines: number; style: (label: string) => string }
> = {
  beginner: {
    minLines: 3,
    maxLines: 4,
    style: (label) => `short sentences, simple ${label} vocabulary, common everyday phrases`,
  },
  intermediate: {
    minLines: 5,
    maxLines: 6,
    style: (label) => `varied ${label} vocabulary, colloquial expressions and cultural references`,
  },
  advanced: {
    minLines: 7,
    maxLines: 9,
    style: (label) => `complex structures, idiomatic ${label} expressions`,
  },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Stage timings, logged on every request and returned to the caller. "It's
  // slow" is not diagnosable without knowing which stage ate the wall clock.
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const mark = (stage: string, from: number) => { timing[stage] = Date.now() - from; };

  try {
    const { difficulty = "beginner", topic, dialect = "Gulf" } = await req.json();

    // Warm the dialect rulebook cache now. It depends on nothing else in the
    // request, so it has no business sitting behind the auth and learner-profile
    // round trips the way it did when askBrain was the first to touch it.
    const priming = primeDialectPrompt(dialect as Dialect);

    // Free-tier daily cap
    const capStart = Date.now();
    const cap = await enforceDailyCap(req, "reading-passage", 15, corsHeaders);
    mark("cap", capStart);
    if (cap.limited) return cap.response;

    const dialectLabel = getDialectLabel(dialect);

    // Learner model, built server-side from the caller's real SRS state across
    // both decks. This replaces the old client-supplied `userVocab` argument,
    // which was fed the entire curriculum vocabulary shuffled (useAllWords) and
    // labelled "words the student knows" — so passages were being built around
    // words the learner had often never seen. Callers may still send `userVocab`;
    // it is deliberately ignored.
    const profileStart = Date.now();
    const [learnerBlock] = await Promise.all([
      learnerPromptBlock({ userId: cap.userId, dialect }),
      priming,
    ]);
    mark("profile+rules", profileStart);

    const culturalContext = dialect === "Egyptian"
      ? "daily life, culture, or social situations in Egypt (Cairo, Alexandria, etc.)"
      : dialect === "Yemeni"
      ? "daily life, culture, or social situations in Yemen (Sana'a, Aden, Hadramaut, qat sessions, traditional architecture)"
      : "daily life, culture, or social situations in the Gulf";

    const topicContext = topic ? `Topic: ${topic}` : `Topic: ${culturalContext}`;

    const shape = PASSAGE_SHAPE[difficulty] ?? PASSAGE_SHAPE.beginner;
    const difficultyGuide = `${shape.minLines}-${shape.maxLines} sentences, ${shape.style(dialectLabel)}`;

    const systemExtra = `You are a ${dialectLabel} language instructor creating reading comprehension exercises.
- Set passages in culturally authentic contexts.
- Generate engaging, culturally relevant passages appropriate for the difficulty level.
- The primary passage text MUST be in ${dialectLabel} dialect, not MSA.

${getTashkeelMandate()}
- title and every line's "arabic" field must be fully vocalized.
- Vocalize for how the sentence is SPOKEN in ${dialectLabel}, never for MSA case.
  No إعراب: no damma/fatha/kasra as a case ending on a noun, and NEVER tanween
  (قَاتًا is wrong; قَات is right). Final consonants take sukuun.

NO FUSHA (this is the single most common failure — read it back and check):
- The passage must sound like someone TALKING, not like a news bulletin or a
  storybook in Classical Arabic. Dialect vocabulary alone is not enough: fusha
  grammar with a few dialect words sprinkled in is still fusha.
- Use the dialect's own verbs and function words rather than their MSA
  equivalents — e.g. prefer قعد over جَلَسَ, راح over ذَهَبَ, شاف over رَأَى,
  ربعه/أصحابه over رِفَاقِهِ, بس over لَكِنْ, عشان/علشان over لِأَنَّ.
- Use the dialect's present-tense verb prefixes and negation, not MSA's.
- Word order and phrasing should be conversational.

${getDialectTransliterationRules(dialect as Dialect)}
- Provide a transliteration for every line.

${LITERAL_GLOSS_RULE}
- Provide a "literal" gloss for every line.

- Return the structured fields via the provided tool only.

${learnerBlock}`;

    const userPrompt = `Write a short STORY for a ${difficulty} learner to read.

LENGTH (hard requirement): the "lines" array MUST contain at least ${shape.minLines} sentences, ideally ${shape.minLines}-${shape.maxLines}. A response with fewer than ${shape.minLines} will be rejected.

It must read as a story, not a couple of stray facts: something happens, in order — a setting, then events, then how it ends. ${difficultyGuide}.
${topicContext}

Put one sentence per entry in the "lines" array, each with its Arabic text, transliteration, natural English translation, and literal word-for-word gloss. Also generate 3-4 vocabulary items and 2-3 comprehension questions about the story.`;

    let passage: any;
    let brainPasses: unknown[] = [];
    const brainStart = Date.now();
    try {
      const brain = await askBrain<any>({
        purpose: "reading_passage",
        dialect: dialect as Dialect,
        strategy: "draft_critic",
        // Draft with the stable fast Gemini build rather than the lineup default
        // preview build: the preview model would not emit this large tool schema
        // for Yemeni requests, and discovering that cost the whole latency
        // budget in retries before any model had written a line.
        models: [MODEL_IDS.GEMINI_FAST, MODEL_LINEUPS.CONTENT.judge],
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 3072,
        temperature: 0.8,
        budgetMs: GENERATION_BUDGET_MS,
        // Have a native-speaker reviewer read the draft and send it back if it
        // comes out as fusha. The MSA token detector cannot catch this: text can
        // be MSA in grammar, register and case-marking while containing none of
        // the blacklisted words, which is exactly what a learner notices. Costs
        // one short classification call; only a failed verdict costs a rewrite.
        enforceDialect: true,
        // What the critic pass is actually there to guarantee, stated as a
        // check we can run locally in microseconds. A draft that already has
        // full tashkeel, a transliteration, a natural translation and a literal
        // gloss on every line — plus vocabulary and an answerable quiz — is
        // finished, and re-generating it through the critic only costs the
        // learner another 30-60s of spinner. Anything missing still triggers
        // the full rewrite. See _shared/passageQualityCore.ts.
        qualityGate: (parsed: unknown) => readingPassageGate(parsed, { minLines: shape.minLines }),
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
                // Stated in the schema as well as the prompt: a bare prose
                // instruction was being ignored, and a two-sentence
                // "intermediate" passage is not a story.
                minItems: shape.minLines,
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
      brainPasses = brain.passes ?? [];
      mark("generate", brainStart);
      if (brain.msaLeaks.leaks.length > 0) {
        console.warn("reading-passage MSA leaks after repair:", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
      }
    } catch (e: any) {
      mark("generate", brainStart);
      console.error("reading-passage brain error:", e?.status, e?.message);
      if (e?.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (e?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // No stub passage. There used to be a hardcoded two-sentence market story
      // here, served with a 200 as though it were real content — no
      // transliteration, no literal gloss, the same text every time, and
      // indistinguishable to the learner from a genuine generation. Now that
      // generation carries a deadline this path is reachable on a slow run, and
      // a silent two-line passage is exactly the failure it would look like.
      // The client already handles an error by offering a retry, which is the
      // honest outcome.
      return new Response(
        JSON.stringify({ error: "Could not generate a passage right now. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    timing.total = Date.now() - t0;
    console.log(
      `[reading-passage] ${difficulty}/${dialect} total=${timing.total}ms`,
      timing,
      brainPasses,
    );

    // `_timing` is diagnostic only — the client reads `passage`. It is here so a
    // slow generation can be attributed from the browser's network tab without
    // needing access to the function logs.
    return new Response(JSON.stringify({ passage, _timing: { ...timing, passes: brainPasses } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reading-passage error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
