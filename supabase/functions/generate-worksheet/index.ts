// generate-worksheet — a printable worksheet from the learner's own deck.
//
// Builds the content for /print/worksheet from the words this learner is
// weakest on and the ones due now, in the dialect they are studying. The
// browser renders and prints it (edge functions cannot run Chromium), so this
// only ever returns a spec: a fixed set of components the page knows how to
// lay out, and an answer key that is derived, never generated.
//
// Through askBrain, so the dialect identity, worked examples and the MSA
// repair pass all apply — except to "spot the Fusha", whose MSA is the point
// and which `worksheetArabicText` keeps out of the repair pass. The model's
// tool output is validated with zod before anything trusts it, then
// `assembleWorksheet` (_shared/worksheetCore.ts) drops any part it cannot
// print honestly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.25.76";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { buildLearnerProfile } from "../_shared/learnerProfile.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import {
  assembleWorksheet,
  BLANK,
  isPrintable,
  MAX_WORDS,
  MIN_WORDS,
  pickWorksheetWords,
  type WorksheetDraft,
  worksheetArabicText,
  type WorksheetWord,
} from "../_shared/worksheetCore.ts";

const DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);
const DUE_FETCH = 40;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** The model's draft. Strings are bounded so a runaway answer cannot flood a page. */
const line = (max: number) => z.string().trim().min(1).max(max);
/**
 * An optional word. The tool schema asks for "" rather than null, because
 * nullable types are not portable across the providers askBrain may route
 * to; null is accepted too, and both become null here.
 */
const optionalWord = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).transform((v) => (v ? v : null));
const DraftSchema = z.object({
  title_arabic: line(80),
  title_english: line(120),
  cloze: z.array(z.object({ sentence: line(200), answer: line(60), english: line(200) })).min(2).max(8),
  dialogue: z.object({
    setting_english: line(200),
    lines: z
      .array(
        z.object({
          speaker: z.enum(["A", "B"]),
          text: line(200),
          answer: optionalWord(60),
          english: line(200),
        }),
      )
      .min(3)
      .max(10),
  }),
  writing: z.object({ prompt_english: line(240), prompt_arabic: z.string().trim().max(240) }),
  spot_the_fusha: z
    .array(z.object({ arabic: line(200), english: line(200), fusha_word: optionalWord(40) }))
    .min(3)
    .max(8),
});

/** Cards due now in the active dialect, from both decks. Failures yield none rather than an error. */
async function dueWords(userId: string, dialect: Dialect): Promise<WorksheetWord[]> {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();
  const [personal, curriculum] = await Promise.all([
    db
      .from("user_vocabulary")
      .select("word_arabic, word_english")
      .eq("user_id", userId)
      .eq("dialect", dialect)
      .lte("next_review_at", now)
      .order("next_review_at", { ascending: true })
      .limit(DUE_FETCH),
    db
      .from("word_reviews")
      .select("next_review_at, vocabulary_words!inner(word_arabic, word_english, dialect_module)")
      .eq("user_id", userId)
      .eq("vocabulary_words.dialect_module", dialect)
      .lte("next_review_at", now)
      .order("next_review_at", { ascending: true })
      .limit(DUE_FETCH),
  ]);
  const out: WorksheetWord[] = [];
  for (const row of (personal.data ?? []) as Array<{ word_arabic: string | null; word_english: string | null }>) {
    if (row.word_arabic && row.word_english) out.push({ arabic: row.word_arabic, english: row.word_english });
  }
  type CurriculumRow = { vocabulary_words: { word_arabic: string | null; word_english: string | null } | null };
  for (const row of (curriculum.data ?? []) as unknown as CurriculumRow[]) {
    const w = row.vocabulary_words;
    if (w?.word_arabic && w.word_english) out.push({ arabic: w.word_arabic, english: w.word_english });
  }
  if (personal.error) console.warn("[generate-worksheet] due personal words unavailable:", personal.error.message);
  if (curriculum.error) console.warn("[generate-worksheet] due curriculum words unavailable:", curriculum.error.message);
  return out;
}

function draftTool(dialectLabel: string) {
  const s = { type: "string" };
  return {
    name: "emit_worksheet",
    description: `Worksheet content in ${dialectLabel}.`,
    parameters: {
      type: "object",
      properties: {
        title_arabic: { ...s, description: "A short title in the dialect, fully vocalised (tashkeel)." },
        title_english: s,
        cloze: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              sentence: { ...s, description: `A short dialect sentence with exactly one ${BLANK} where the answer goes.` },
              answer: { ...s, description: "The missing word, copied exactly from the word list." },
              english: { ...s, description: "The whole sentence in English." },
            },
            required: ["sentence", "answer", "english"],
          },
        },
        dialogue: {
          type: "object",
          properties: {
            setting_english: s,
            lines: {
              type: "array",
              minItems: 4,
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  speaker: { type: "string", enum: ["A", "B"] },
                  text: { ...s, description: `The line in the dialect. Two or three lines carry one ${BLANK} each.` },
                  answer: {
                    type: "string",
                    description: "The missing word, from the word list, for a line with a blank; an empty string otherwise.",
                  },
                  english: s,
                },
                required: ["speaker", "text", "answer", "english"],
              },
            },
          },
          required: ["setting_english", "lines"],
        },
        writing: {
          type: "object",
          properties: {
            prompt_english: { ...s, description: "One everyday writing task using some of the words." },
            prompt_arabic: { ...s, description: "The same prompt in the dialect." },
          },
          required: ["prompt_english", "prompt_arabic"],
        },
        spot_the_fusha: {
          type: "array",
          minItems: 4,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              arabic: s,
              english: s,
              fusha_word: {
                type: "string",
                description: "The one MSA word you swapped in, exactly as written; an empty string for an all-dialect sentence.",
              },
            },
            required: ["arabic", "english", "fusha_word"],
          },
        },
      },
      required: ["title_arabic", "title_english", "cloze", "dialogue", "writing", "spot_the_fusha"],
    },
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // DECISION FOR DANIEL: three a day on the free tier, ten and thirty on the
  // paid ones. One model call each, but a whole page of output.
  const cap = await enforceDailyCap(req, "generate-worksheet", 3, cors, { standard: 10, allin: 30 });
  if (cap.limited) return cap.response;

  const body = await req.json().catch(() => ({}));
  const rawDialect = typeof body?.dialect === "string" ? body.dialect : "Gulf";
  const dialect = (DIALECTS.has(rawDialect) ? rawDialect : "Gulf") as Dialect;
  const dialectLabel = getDialectLabel(dialect);

  // Built server-side from the learner's real SRS state, never from a list the client sends.
  const [profile, due] = await Promise.all([
    buildLearnerProfile({ userId: cap.userId, dialect }).catch((e) => {
      console.warn("[generate-worksheet] profile unavailable:", e);
      return null;
    }),
    dueWords(cap.userId, dialect),
  ]);
  const words = pickWorksheetWords(profile?.weak ?? [], due, MAX_WORDS);
  if (words.length < MIN_WORDS) {
    return json(
      {
        error: "not_enough_words",
        message: `A worksheet needs at least ${MIN_WORDS} words that are weak or due in ${dialectLabel}. Review or save a few more and try again.`,
        words: words.length,
      },
      422,
      cors,
    );
  }

  const wordList = words.map((w) => `- ${w.arabic} — ${w.english}`).join("\n");
  let brain;
  try {
    brain = await askBrain<unknown>({
      purpose: "worksheet",
      dialect,
      temperature: 0.6,
      maxTokens: 3000,
      systemPromptExtra: `You write the content for a one-page printed worksheet in ${dialectLabel} for an adult learner. The layout is fixed; you only fill it in.

THE LEARNER'S WORDS (weak or due for review — the worksheet is built around exactly these):
${wordList}

Rules:
- Every Arabic sentence is everyday spoken ${dialectLabel}, short (under 12 words), and natural, except in "spot_the_fusha".
- cloze: 3-6 sentences, each with exactly one ${BLANK}. The answer is one of the learner's words, copied exactly as listed, and each word is used at most once.
- dialogue: a 4-8 line exchange between A and B in an everyday setting. Two or three lines have one ${BLANK} whose answer is one of the learner's words; every other line has no blank and an empty answer.
- spot_the_fusha: 4-6 short ${dialectLabel} sentences. In about half, swap exactly ONE word for its Modern Standard Arabic equivalent and give that word as fusha_word; the rest are pure dialect with an empty fusha_word. Use common MSA giveaways (سوف، الآن، الذي، ليس، ماذا، أيضاً).
- writing: one short, concrete task the learner can answer in two or three written sentences using some of the words.
- Vocalise the title fully. Everywhere else, write as natives text: no tashkeel needed.

Return ONLY the structured tool call.`,
      userPrompt: "Write the worksheet content.",
      arabicTextPath: worksheetArabicText,
      tool: draftTool(dialectLabel),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-worksheet] brain error", msg);
    if (err instanceof BrainHttpError && (err.status === 402 || err.status === 429)) {
      return json(
        {
          error: err.status === 429 ? "rate_limited" : "no_credit",
          message: err.status === 429 ? "The AI is busy right now. Try again in a minute." : "The AI has run out of credit. Try again later.",
        },
        err.status,
        cors,
      );
    }
    return json({ error: "ai_failed", message: "The worksheet couldn't be written. Try again." }, 502, cors);
  }

  const parsed = DraftSchema.safeParse(brain.output);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    console.warn("[generate-worksheet] draft failed validation", issues);
    return json({ error: "bad_draft", message: "The worksheet came back malformed. Try again.", issues }, 502, cors);
  }

  // The seed fixes every shuffle, so the page and its key always agree.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const spec = assembleWorksheet(parsed.data as WorksheetDraft, words, dialect, seed);
  if (spec.dropped.length) console.warn("[generate-worksheet] dropped:", spec.dropped);
  if (!isPrintable(spec)) {
    return json(
      { error: "too_little_content", message: "Too little of the worksheet survived the checks. Try again.", dropped: spec.dropped },
      502,
      cors,
    );
  }
  return json({ spec }, 200, cors);
});
