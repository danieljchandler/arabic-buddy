#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
/**
 * The AI Brain's pass over the authored curriculum.
 *
 * The tracks in curriculum/tracks/ are written by hand and held to the
 * syllabus and the MSA-leak detector in CI (scripts/check-curriculum-tracks.ts).
 * That catches structure and the known leak list; it cannot tell a stiff
 * sentence from a natural one, a Kuwaiti form quietly labelled Saudi, or a
 * transliteration that does not match how the word is said. This script asks
 * the Brain — the same askBrain() every content-generating edge function goes
 * through, with its dialect identity, worked examples, repair pass and
 * native-speaker validator — to review each lesson as a native speaker and
 * curriculum designer would, and to propose concrete edits.
 *
 * Two modes:
 *
 *   review (default)  For every lesson (or the selection), one CONTENT-lineup
 *                     draft_critic call with validateDialect on. The Brain
 *                     returns, per word and per example, a verdict
 *                     (authentic / awkward / wrong-dialect / msa) and a
 *                     suggested replacement, plus lesson-level notes and up to
 *                     three extra example sentences. Written to
 *                     curriculum/tracks/<dialect>/stage-<n>/_brain/<nn>-<slug>.review.json
 *                     with model ids, strategy, validator result and timestamp,
 *                     so the paper trail shows who changed what and why.
 *
 *   --apply           Merge accepted suggestions from existing review files
 *                     into the lesson files: replacements whose verdict is
 *                     wrong-dialect or msa are applied; awkward ones are
 *                     applied only with --apply-awkward. The lesson file is
 *                     rewritten; the review file is kept. Re-run
 *                     check-curriculum-tracks.ts and build-curriculum-seed.ts
 *                     afterwards — nothing here bypasses the guards.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-write --allow-net \
 *     scripts/curriculum-brain.ts [--dialect Egyptian] [--stage 2] [--lesson negation] [--limit 3]
 *   deno run --allow-read --allow-write scripts/curriculum-brain.ts --apply [--apply-awkward] [...same filters]
 *
 * Provider keys follow the model id exactly as in production (aiGateway):
 * google/* → GEMINI_API_KEY, openai/* → OPENAI_API_KEY, everything else →
 * OPENROUTER_API_KEY, which also covers the first two when their own key is
 * missing. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are optional: with them,
 * primeDialectPrompt loads the approved dialect_rules into the prompt, exactly
 * as the edge functions do; without them the Brain runs on its built-in
 * identity and worked examples and says so.
 */
import { askBrain, type BrainResult } from "../supabase/functions/_shared/aiBrain.ts";
import { hasAnyProvider } from "../supabase/functions/_shared/aiGateway.ts";
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector.ts";
import type { Dialect } from "../supabase/functions/_shared/dialectTypes.ts";

// ---------------------------------------------------------------------------
// Track shapes (mirrors src/lib/curriculumTracks.ts, kept local so this Deno
// script does not import the Vite-side module graph).

interface ArabicLine {
  arabic: string;
  transliteration: string;
  english: string;
}
interface Word extends ArabicLine {
  category: string;
  teaching_note: string;
  image_scene: string;
  concept_key?: string;
  variants?: string[];
  example: ArabicLine;
  video_hint?: string;
}
interface Lesson {
  slug: string;
  lesson_number: number;
  title: string;
  title_arabic: string;
  description: string;
  cefr_target: string;
  grammar: Array<{ category: string; title: string; explanation: string; examples: ArabicLine[] }>;
  culture: Array<{ title: string; note: string; phrases: ArabicLine[] }>;
  vocabulary: Word[];
  dialogue: Array<ArabicLine & { speaker: string }>;
  [key: string]: unknown;
}
interface StageMeta {
  dialect: Dialect;
  stage: number;
  variety: string;
}

// ---------------------------------------------------------------------------
// Review shape the Brain is asked to fill.

type Verdict = "authentic" | "awkward" | "wrong-dialect" | "msa";

interface LineReview {
  /** JSON path inside the lesson, e.g. vocabulary[3].example or dialogue[1]. */
  path: string;
  original: string;
  verdict: Verdict;
  reason: string;
  /** Full replacement line when the verdict is not authentic. */
  replacement?: ArabicLine;
}

interface LessonReview {
  lesson: string;
  dialect: Dialect;
  variety: string;
  reviewed_at: string;
  models: string[];
  strategy: string;
  validator?: unknown;
  msa_leaks_in_output: string[];
  summary: string;
  lines: LineReview[];
  extra_examples: ArabicLine[];
  teaching_notes: string[];
}

const REVIEW_TOOL = {
  name: "review_lesson",
  description: "Return the native-speaker review of one curriculum lesson.",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Two or three sentences on the lesson as a whole." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            original: { type: "string" },
            verdict: { type: "string", enum: ["authentic", "awkward", "wrong-dialect", "msa"] },
            reason: { type: "string" },
            replacement: {
              type: "object",
              properties: {
                arabic: { type: "string" },
                transliteration: { type: "string" },
                english: { type: "string" },
              },
              required: ["arabic", "transliteration", "english"],
            },
          },
          required: ["path", "original", "verdict", "reason"],
        },
      },
      extra_examples: {
        type: "array",
        description: "Up to three additional natural example sentences using this lesson's words.",
        items: {
          type: "object",
          properties: {
            arabic: { type: "string" },
            transliteration: { type: "string" },
            english: { type: "string" },
          },
          required: ["arabic", "transliteration", "english"],
        },
      },
      teaching_notes: {
        type: "array",
        description: "Things a learner at this level is likely to get wrong with this lesson's material.",
        items: { type: "string" },
      },
    },
    required: ["summary", "lines", "extra_examples", "teaching_notes"],
  },
};

// ---------------------------------------------------------------------------
// CLI

const args = Deno.args;
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const apply = args.includes("--apply");
const applyAwkward = args.includes("--apply-awkward");
const onlyDialect = opt("dialect");
const onlyStage = opt("stage") ? Number(opt("stage")) : null;
const onlyLesson = opt("lesson");
const limit = Number(opt("limit")) || Infinity;

const TRACKS = new URL("../curriculum/tracks/", import.meta.url);

function readJson<T>(url: URL): T {
  return JSON.parse(Deno.readTextFileSync(url)) as T;
}

interface LessonFile {
  meta: StageMeta;
  stageDir: URL;
  file: string;
  lesson: Lesson;
}

function* lessonFiles(): Generator<LessonFile> {
  for (const dialectDir of Deno.readDirSync(TRACKS)) {
    if (!dialectDir.isDirectory) continue;
    if (onlyDialect && dialectDir.name !== onlyDialect.toLowerCase()) continue;
    const base = new URL(`${dialectDir.name}/`, TRACKS);
    for (const stageDir of Deno.readDirSync(base)) {
      const m = /^stage-(\d+)$/.exec(stageDir.name);
      if (!m) continue;
      if (onlyStage !== null && Number(m[1]) !== onlyStage) continue;
      const dir = new URL(`${stageDir.name}/`, base);
      const meta = readJson<StageMeta>(new URL("_stage.json", dir));
      const files = [...Deno.readDirSync(dir)]
        .map((e) => e.name)
        .filter((n) => /^\d{2}-.+\.json$/.test(n))
        .sort();
      for (const file of files) {
        const lesson = readJson<Lesson>(new URL(file, dir));
        if (onlyLesson && lesson.slug !== onlyLesson) continue;
        yield { meta, stageDir: dir, file, lesson };
      }
    }
  }
}

function reviewUrl(entry: LessonFile): URL {
  return new URL(`_brain/${entry.file.replace(/\.json$/, ".review.json")}`, entry.stageDir);
}

/** Every Arabic line in a lesson with its path, in the order the reviewer sees them. */
function lines(lesson: Lesson): Array<{ path: string; line: ArabicLine }> {
  const out: Array<{ path: string; line: ArabicLine }> = [];
  lesson.vocabulary.forEach((w, i) => {
    out.push({ path: `vocabulary[${i}]`, line: { arabic: w.arabic, transliteration: w.transliteration, english: w.english } });
    out.push({ path: `vocabulary[${i}].example`, line: w.example });
  });
  lesson.grammar.forEach((g, i) => g.examples.forEach((ex, j) => out.push({ path: `grammar[${i}].examples[${j}]`, line: ex })));
  lesson.culture.forEach((c, i) => c.phrases.forEach((ph, j) => out.push({ path: `culture[${i}].phrases[${j}]`, line: ph })));
  lesson.dialogue.forEach((d, i) => out.push({ path: `dialogue[${i}]`, line: d }));
  return out;
}

function reviewPrompt(meta: StageMeta, lesson: Lesson): string {
  const listed = lines(lesson)
    .map(({ path, line }) => `${path} | ${line.arabic} | ${line.transliteration} | ${line.english}`)
    .join("\n");
  return `You are reviewing one lesson of a spoken ${meta.dialect} Arabic curriculum for adult learners.
Variety: ${meta.variety}. Lesson: "${lesson.title}" (${lesson.cefr_target}). ${lesson.description}

Review EVERY line below as a native speaker of that variety and an experienced curriculum designer.
For each line give a verdict:
- authentic: a native speaker of this variety would say exactly this, in this register;
- awkward: understandable but stiff, textbook-ish or unusual word choice — give a natural replacement;
- wrong-dialect: belongs to another dialect or another sub-variety than the one named — give the correct form;
- msa: Modern Standard Arabic leaked in — give the spoken form.
Check the transliteration reflects how the word is actually pronounced in this variety and fix it in the replacement if not.
Keep the English gloss unless it is wrong. Never replace a line with MSA. Never change the meaning.
Then add up to three extra natural example sentences that recycle this lesson's words at this level, and list the traps a learner will fall into.

Lines (path | arabic | transliteration | english):
${listed}`;
}

async function reviewLesson(entry: LessonFile): Promise<LessonReview> {
  const { meta, lesson } = entry;
  const result: BrainResult<Omit<LessonReview, "lesson" | "dialect" | "variety" | "reviewed_at" | "models" | "strategy" | "validator" | "msa_leaks_in_output">> =
    await askBrain({
      purpose: "curriculum-review",
      dialect: meta.dialect,
      userPrompt: reviewPrompt(meta, lesson),
      tool: REVIEW_TOOL,
      strategy: "draft_critic",
      validateDialect: true,
      alwaysCritique: true,
      temperature: 0.3,
      maxTokens: 6000,
      budgetMs: 180_000,
      // The Arabic the leak scan should look at: every replacement and extra
      // example the Brain proposes. A leak in a suggestion is worse than a leak
      // in the source, so the repair pass runs on exactly that.
      arabicTextPath: (parsed) => {
        const p = parsed as { lines?: LineReview[]; extra_examples?: ArabicLine[] };
        return [
          ...(p.lines ?? []).map((l) => l.replacement?.arabic ?? ""),
          ...(p.extra_examples ?? []).map((e) => e.arabic),
        ].join("\n");
      },
    });
  const out = result.output;
  const proposed = [...out.lines.map((l) => l.replacement?.arabic ?? ""), ...out.extra_examples.map((e) => e.arabic)].join("\n");
  return {
    lesson: lesson.slug,
    dialect: meta.dialect,
    variety: meta.variety,
    reviewed_at: new Date().toISOString(),
    models: result.models,
    strategy: result.strategy,
    validator: result.validator,
    msa_leaks_in_output: detectMsaLeaks(proposed, meta.dialect).leaks,
    summary: out.summary,
    lines: out.lines,
    extra_examples: out.extra_examples,
    teaching_notes: out.teaching_notes,
  };
}

// ---------------------------------------------------------------------------
// --apply: merge replacements back into the lesson file.

function setLine(lesson: Lesson, path: string, replacement: ArabicLine): boolean {
  const m = /^(vocabulary|grammar|culture|dialogue)\[(\d+)\](?:\.(example)|\.(examples|phrases)\[(\d+)\])?$/.exec(path);
  if (!m) return false;
  const [, section, idxRaw, example, sub, subIdxRaw] = m;
  const idx = Number(idxRaw);
  if (section === "vocabulary") {
    const w = lesson.vocabulary[idx];
    if (!w) return false;
    if (example) {
      w.example = replacement;
    } else {
      w.arabic = replacement.arabic;
      w.transliteration = replacement.transliteration;
      w.english = replacement.english;
    }
    return true;
  }
  if (section === "dialogue") {
    const d = lesson.dialogue[idx];
    if (!d) return false;
    Object.assign(d, replacement);
    return true;
  }
  if (section === "grammar" && sub === "examples") {
    const g = lesson.grammar[idx];
    if (!g?.examples[Number(subIdxRaw)]) return false;
    g.examples[Number(subIdxRaw)] = replacement;
    return true;
  }
  if (section === "culture" && sub === "phrases") {
    const c = lesson.culture[idx];
    if (!c?.phrases[Number(subIdxRaw)]) return false;
    c.phrases[Number(subIdxRaw)] = replacement;
    return true;
  }
  return false;
}

function applyReview(entry: LessonFile, review: LessonReview): number {
  let applied = 0;
  for (const line of review.lines) {
    if (!line.replacement) continue;
    if (line.verdict === "authentic") continue;
    if (line.verdict === "awkward" && !applyAwkward) continue;
    // Never apply a suggestion the detector itself rejects.
    if (detectMsaLeaks(line.replacement.arabic, entry.meta.dialect).leaks.length) continue;
    if (setLine(entry.lesson, line.path, line.replacement)) applied += 1;
  }
  if (applied > 0) {
    Deno.writeTextFileSync(new URL(entry.file, entry.stageDir), JSON.stringify(entry.lesson, null, 2) + "\n");
  }
  return applied;
}

// ---------------------------------------------------------------------------

if (apply) {
  let files = 0;
  let edits = 0;
  for (const entry of lessonFiles()) {
    let review: LessonReview;
    try {
      review = readJson<LessonReview>(reviewUrl(entry));
    } catch {
      continue;
    }
    const n = applyReview(entry, review);
    files += n > 0 ? 1 : 0;
    edits += n;
    if (n > 0) console.log(`${entry.meta.dialect}/s${entry.meta.stage}/${entry.lesson.slug}: ${n} line(s) replaced`);
  }
  console.log(`\n${edits} replacement(s) in ${files} lesson file(s). Now run check-curriculum-tracks.ts and build-curriculum-seed.ts.`);
  Deno.exit(0);
}

if (!hasAnyProvider()) {
  console.error("No provider key set. Export GEMINI_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY.");
  Deno.exit(2);
}
if (!Deno.env.get("SUPABASE_URL")) {
  console.error("SUPABASE_URL not set — reviewing with the Brain's built-in dialect identity only (approved dialect_rules not loaded).");
}

let done = 0;
let flagged = 0;
for (const entry of lessonFiles()) {
  if (done >= limit) break;
  const label = `${entry.meta.dialect}/s${entry.meta.stage}/${entry.lesson.slug}`;
  try {
    const review = await reviewLesson(entry);
    Deno.mkdirSync(new URL("_brain/", entry.stageDir), { recursive: true });
    Deno.writeTextFileSync(reviewUrl(entry), JSON.stringify(review, null, 2) + "\n");
    const problems = review.lines.filter((l) => l.verdict !== "authentic").length;
    flagged += problems;
    console.log(`${label}: ${review.lines.length} lines reviewed, ${problems} flagged, ${review.extra_examples.length} extra examples (${review.models.join(" + ")})`);
    if (review.msa_leaks_in_output.length) console.log(`  ! the Brain's own suggestions leak: ${review.msa_leaks_in_output.join(", ")}`);
  } catch (e) {
    console.error(`${label}: review failed — ${e instanceof Error ? e.message : String(e)}`);
  }
  done += 1;
}
console.log(`\n${done} lesson(s) reviewed, ${flagged} line(s) flagged. Inspect the _brain/*.review.json files, then --apply.`);
