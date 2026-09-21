// storyDialect.ts — the fusha→dialect conversion behind the reading library.
//
// The library's source texts are deliberately Modern Standard Arabic: they are
// real public-domain stories, and `generate-suggested-story-text` writes them
// in fusha on purpose (see its `targetRegister: "msa"`). What a learner reads
// is not. This module is the one place that turns those fusha lines into the
// dialect the app actually teaches, so the two callers that need it —
// `import-authentic-story`, which runs it as part of every import, and
// `translate-story-dialect`, which re-runs it on demand — cannot drift apart
// on the prompt, the alignment rule or the shape of what gets stored.
//
// Splitting it out is what fixed the original bug: the conversion existed, but
// only behind an admin button nobody had to press, so every story reached the
// shelf in fusha.

import { askBrain } from "./aiBrain.ts";
import { type Dialect } from "./dialectHelpers.ts";

/** A source line as the import and review paths hold one. */
export interface StorySourceLine {
  arabic?: string | null;
  arabic_vocalized?: string | null;
}

/** One line rendered in the target dialect, with and without tashkeel. */
export interface StoryDialectLine {
  dialect: string;
  dialect_vocalized: string;
}

const ARABIC_LETTER = /[ء-ي٠-٩ٱ-ۓ]/;

/** Labels for Modern Standard Arabic, which is a register and not a dialect. */
const FUSHA_LABELS = new Set(["msa", "fusha", "fus7a", "standard", "classical"]);

/**
 * Whether there is a dialect to convert *to*.
 *
 * The import form offers "MSA (Fusha)" alongside the three dialects, and a
 * story filed under it is already in the register it is meant to be read in.
 * Running the converter anyway asks a model to render Modern Standard Arabic
 * in the MSA dialect, under a prompt that tells it anything looking like fusha
 * is wrong — so whatever Arabic came back would be stored as `body_dialect`
 * and shown by default, quietly replacing a valid MSA story with some dialect
 * while still labelling it MSA.
 */
export function isDialectTarget(dialect: string | null | undefined): boolean {
  const label = (dialect ?? "").trim().toLowerCase();
  return label.length > 0 && !FUSHA_LABELS.has(label);
}

/**
 * The instruction, kept next to the alignment rule that reads its output.
 *
 * The middle paragraph is the load-bearing one. Translating *from* fusha drags
 * the answer toward fusha — MADAR's corpus builders measured it and went
 * through English to avoid it — so the prompt has to name the trap and ask for
 * a restructure rather than a word swap.
 */
export function buildStoryDialectPrompt(dialect: string): string {
  return `You are a native ${dialect} Arabic speaker and translator. Convert the given Modern Standard Arabic (Fusha) text into natural, authentic ${dialect} dialect Arabic.
The SOURCE IS FUSHA, AND THAT IS A TRAP: text elicited from an MSA source drifts toward MSA — its word order, its verb forms, its vocabulary (MADAR's corpus builders measured this and translated from English to avoid it). Do not translate word by word. Say what a ${dialect} speaker would actually say to mean the same thing, even when that restructures the sentence or swaps the lexeme (نافذة → شباك, أريد → أبغى/عايز, سوف أذهب → بروح/هروح). If a line comes out looking like Fusha with a few dialect words, it is wrong. For each line:
1. Provide the dialect version in natural Arabic script
2. Provide the dialect version with full tashkeel (diacritics)
Keep the meaning faithful but make it sound natural in the dialect. Use authentic dialect vocabulary, grammar patterns, and expressions.
Return exactly one entry per numbered source line, in the same order. Never merge two lines into one entry and never split one into two.`;
}

/** The tool the model answers through. */
export const STORY_DIALECT_TOOL = {
  name: "emit_dialect_lines",
  description: "Return dialect translations for each line.",
  parameters: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dialect: { type: "string", description: "Dialect Arabic text" },
            dialect_vocalized: { type: "string", description: "Dialect Arabic with full tashkeel" },
          },
          required: ["dialect", "dialect_vocalized"],
        },
      },
    },
    required: ["lines"],
  },
} as const;

/** The text of a source line, preferring the unvocalized form. */
export function sourceText(line: StorySourceLine): string {
  return (line.arabic || line.arabic_vocalized || "").trim();
}

/**
 * Drop anything that is not Arabic.
 *
 * The one failure worth guarding is a model answering in English or with a
 * note about what it did: the line renders RTL as the sentence the learner is
 * supposed to be reading, so an English sentence there is not a visible error,
 * it is a wrong lesson. An empty string is better — the reader falls back to
 * the fusha for that line.
 */
function sanitize(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text || !ARABIC_LETTER.test(text)) return "";
  return text;
}

/**
 * Align the model's array to the lines it was asked about.
 *
 * Positional and unforgiving, for the same reason the Fusha row is: a model
 * that answers with nine renderings for ten lines has merged two of them, and
 * sliding the array into place files every later line's dialect under the
 * wrong sentence — invisible to exactly the learner it is for. Short answers
 * pad with empty strings (that line keeps its fusha) rather than shifting.
 */
export function alignStoryDialectLines(parsed: unknown, count: number): StoryDialectLine[] {
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { lines?: unknown })?.lines)
      ? (parsed as { lines: unknown[] }).lines
      : [];

  const out: StoryDialectLine[] = [];
  for (let i = 0; i < count; i++) {
    const item = source[i];
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : null;
    const plain = sanitize(record ? (record.dialect ?? record.text ?? record.arabic) : item);
    const vocalized = sanitize(record?.dialect_vocalized ?? record?.vocalized);
    // Tashkeel without a base rendering is still a rendering; keep it rather
    // than dropping the line for want of the plainer of the two.
    out.push(
      plain
        ? { dialect: plain, dialect_vocalized: vocalized }
        : { dialect: vocalized, dialect_vocalized: vocalized },
    );
  }
  return out;
}

/** True when the conversion produced something for at least one line. */
export function hasDialectLines(lines: StoryDialectLine[]): boolean {
  return lines.some((l) => Boolean(l.dialect));
}

/**
 * The story-level bodies, built from the per-line renderings.
 *
 * A line the model skipped keeps its fusha here rather than leaving a hole:
 * `body_dialect` is what the shelf reads to estimate coverage and what the
 * assistant is handed as the document, so a story with one blank line in the
 * middle would be worse than one with a single fusha sentence in it.
 */
export function storyDialectBodies(
  source: StorySourceLine[],
  dialectLines: StoryDialectLine[],
): { body_dialect: string; body_dialect_vocalized: string } {
  const plain: string[] = [];
  const vocalized: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const line = dialectLines[i];
    plain.push(line?.dialect || sourceText(source[i]));
    vocalized.push(
      line?.dialect_vocalized || line?.dialect ||
        (source[i].arabic_vocalized || source[i].arabic || "").trim(),
    );
  }
  return {
    body_dialect: plain.join("\n"),
    body_dialect_vocalized: vocalized.join("\n"),
  };
}

/**
 * Convert fusha story lines into `dialect`.
 *
 * Returns one entry per source line — empty strings where the model gave
 * nothing usable, never a shorter array, so callers can zip it against their
 * own rows by index.
 */
export async function translateStoryLinesToDialect(
  source: StorySourceLine[],
  dialect: Dialect,
  opts: { budgetMs?: number } = {},
): Promise<StoryDialectLine[]> {
  const blank = () => source.map(() => ({ dialect: "", dialect_vocalized: "" }));

  // An MSA story is already in its target register; there is nothing to
  // convert, and converting anyway would overwrite it with a dialect.
  if (!isDialectTarget(dialect)) return blank();

  const texts = source.map(sourceText);
  if (texts.every((t) => !t)) return blank();

  const result = await askBrain<{ lines?: Array<Partial<StoryDialectLine>> }>({
    purpose: "utility",
    dialect,
    strategy: "draft_critic",
    // The CONTENT lineup drafts and critiques; enforceDialect is what makes
    // the critique real for a conversion whose failure mode is "fusha with a
    // few dialect words", which the token blacklist cannot see.
    enforceDialect: true,
    systemPromptExtra: buildStoryDialectPrompt(dialect),
    userPrompt: `Translate these ${texts.length} Fusha Arabic lines into ${dialect} dialect:\n${
      texts.map((t, i) => `${i + 1}. ${t}`).join("\n")
    }`,
    // Point the validator at the unvocalized dialect lines only — the fallback
    // walk would also feed it the tashkeel duplicates.
    arabicTextPath: (p) =>
      ((p as { lines?: Array<{ dialect?: string }> } | null)?.lines ?? [])
        .map((l) => l.dialect ?? "")
        .join("\n"),
    // Two renderings per line, in a script that costs more tokens than it
    // looks like it should. A fixed 6000 was fine for the five-line stories
    // this was first run on and silently truncated the long ones, and a
    // truncated answer is a *short* answer — which pads, so the tail of a long
    // story would simply never be converted.
    maxTokens: Math.min(12_000, Math.max(3_000, texts.length * 220)),
    // The re-run can take its time; the import cannot, since it is holding a
    // request open behind the segmentation call that produced these lines.
    ...(opts.budgetMs ? { budgetMs: opts.budgetMs } : {}),
    temperature: 0.3,
    tool: STORY_DIALECT_TOOL,
  });

  return alignStoryDialectLines(result.output, texts.length);
}

/** A stored story line, as the narration path reads one. */
export interface StoryLineRow extends StorySourceLine {
  dialect?: string | null;
  dialect_vocalized?: string | null;
}

/**
 * The text a narrator should read for a story line.
 *
 * Dialect first, and *both* dialect forms before either fusha form. The
 * narration path used to ask for `dialect_vocalized || arabic_vocalized ||
 * dialect || arabic`, which reads as a preference for tashkeel but is really a
 * preference for fusha: a story converted to dialect without diacritics — the
 * ordinary outcome when a model returns a plain rendering and no vocalized one
 * — was narrated in Modern Standard Arabic while the page showed the dialect.
 * Missing tashkeel costs a little pronunciation precision; the wrong register
 * costs the lesson.
 */
export function spokenStoryLine(line: StoryLineRow): string {
  return (line.dialect_vocalized || line.dialect || line.arabic_vocalized || line.arabic || "")
    .trim();
}
