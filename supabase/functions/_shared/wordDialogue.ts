/**
 * A word's two-line exchange (quiz Phase 4): someone says something, and the
 * reply uses the word.
 *
 * The quiz's "answer the line" step (choose the reply) and its "say the reply"
 * step were built on a lesson's authored dialogue, which only some words
 * appear in. This is the shape of the exchange the shared store keeps for every
 * other word (`kind: "dialogue"` in `_shared/wordAssets.ts`), made once per
 * word, sense and dialect by `word-asset`'s `ensure` through the Brain, and the
 * rules both sides agree on: what counts as a usable exchange, what the model
 * is told, and what the leak detector is shown.
 *
 * What may reach the prompt is the same rule pictures follow: the key's folded
 * word, its folded sense and its dialect, and nothing a learner typed. The one
 * addition is the trusted path's (`authoredExample`): a curriculum word's
 * authored example sentence, from the service role or the content team only.
 * A learner's saved sentence is their own text — a transcript line, a note —
 * and the exchange is filed for every later learner of the key, so it must not
 * be steered by it.
 *
 * Pure: the browser imports it verbatim (the quiz reads stored exchanges with
 * the anon client and checks them with `asStoredDialogue`), and so does
 * `word-asset`. Tested from Vitest (`src/test/wordDialogue.test.ts`).
 */

import { normaliseAssetWord, type AssetDialect, type AssetKey } from "./wordAssets.ts";

/** One line of an exchange. Every field is a string; an absent one is "". */
export interface StoredDialogueLine {
  /** A short English role ("Friend", "Shopkeeper"), or "". */
  speaker: string;
  arabic: string;
  english: string;
  transliteration: string;
}

/** What the store keeps under a word's `dialogue` key, as `payload`. */
export interface StoredDialogue {
  /** The line said to the learner, then the reply that uses the word. */
  lines: [StoredDialogueLine, StoredDialogueLine];
}

/** A line longer than this is not a line a learner can be asked to say. */
export const MAX_DIALOGUE_LINE_LENGTH = 160;

/** The longest authored example a prompt carries; a track's are one sentence. */
export const MAX_EXAMPLE_LENGTH = 240;

/** At least one Arabic letter (tatweel excluded), as in `wordAssets.ts`. */
const ARABIC_LETTER_RE = /[ء-ؿف-يٮ-ۓۺ-ۿ]/;

/** Each whitespace token of `text`, folded as a saved word is. */
function foldedTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => normaliseAssetWord(token))
    .filter(Boolean);
}

/**
 * Whether a line uses the word, as a whole word or a run of whole words,
 * compared after the folding the store keys on (`normaliseAssetWord`). For a
 * single word this is exactly `sentenceHasWord` in `src/lib/arabicWord.ts`, the
 * test the quiz's gap and reply questions use: a word with the article or a
 * pronoun attached is a different token, so it does not count.
 */
export function lineUsesWord(line: string, word: string): boolean {
  const target = foldedTokens(word);
  if (target.length === 0) return false;
  const tokens = foldedTokens(line);
  for (let start = 0; start + target.length <= tokens.length; start++) {
    if (target.every((part, i) => tokens[start + i] === part)) return true;
  }
  return false;
}

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

function asLine(value: unknown): StoredDialogueLine | null {
  if (!value || typeof value !== "object") return null;
  const line = value as Record<string, unknown>;
  const arabic = str(line.arabic);
  if (!ARABIC_LETTER_RE.test(arabic) || arabic.length > MAX_DIALOGUE_LINE_LENGTH) return null;
  const english = str(line.english);
  if (!english) return null;
  return {
    speaker: str(line.speaker).slice(0, 40),
    arabic,
    english,
    transliteration: str(line.transliteration),
  };
}

/**
 * A stored exchange for `word`, or null when it is not one the quiz can ask:
 * fewer than two lines, a line with no Arabic or no English, a reply that does
 * not use the word, or an opening line that already says it (which would hand
 * the learner the answer before they choose or say it). Takes the payload as
 * the store keeps it (`{ lines }`) or the bare pair; anything past the second
 * line is not kept.
 */
export function asStoredDialogue(value: unknown, word: string): StoredDialogue | null {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { lines?: unknown }).lines)
      ? (value as { lines: unknown[] }).lines
      : null;
  if (!raw || raw.length < 2) return null;
  const first = asLine(raw[0]);
  const reply = asLine(raw[1]);
  if (!first || !reply) return null;
  if (!lineUsesWord(reply.arabic, word) || lineUsesWord(first.arabic, word)) return null;
  return { lines: [first, reply] };
}

/** Why a draft is not an exchange the quiz can use, for the Brain's critic; null when it is. */
export function dialogueProblem(value: unknown, word: string): string | null {
  if (asStoredDialogue(value, word)) return null;
  return (
    `The output must be exactly two lines, each with Arabic and an English translation. ` +
    `The second line must contain the word ${word} exactly as written, as a whole word with ` +
    `nothing attached to it; the first line must not contain it.`
  );
}

/** The Arabic of every line, for the Brain's leak scan. */
export function dialogueArabic(value: unknown): string {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { lines?: unknown }).lines)
      ? (value as { lines: unknown[] }).lines
      : [];
  return raw
    .map((line) => (line && typeof line === "object" ? str((line as { arabic?: unknown }).arabic) : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Each line's Arabic as the leak detector must see it before the exchange is
 * filed: with quotation marks taken out. The detector skips anything quoted
 * (so a contrastive example in a prompt is not a leak), and a line is never a
 * contrastive example — a learner is asked to say all of it.
 */
export function dialogueLinesForScan(dialogue: StoredDialogue): string[] {
  return dialogue.lines.map((line) => line.arabic.replace(/["“”«»]/g, " "));
}

/**
 * The folded Arabic a sense-keyed asset was filed under (`قهوه` for
 * `قهوه|coffee`). A shared prompt names the word in this form, never as a
 * learner typed it: the folding is all the key knows about the word.
 */
export function keyWord(key: Pick<AssetKey, "conceptKey">): string {
  const bar = key.conceptKey.indexOf("|");
  return bar < 0 ? key.conceptKey : key.conceptKey.slice(0, bar);
}

/**
 * An authored example sentence as a prompt carries it: one line, at most
 * `MAX_EXAMPLE_LENGTH`, or "" when it is not an example of this word — no
 * Arabic, the word not in it, or nothing in it but the word. The one rule for
 * what counts, so `word-asset` cannot take a token for an example and lift a
 * call onto the trusted path with it (as `authoredScene` is for a picture).
 */
export function authoredExample(text: string | null | undefined, word: string): string {
  const example = (text ?? "").replace(/\s+/g, " ").trim();
  if (!example || example.length > MAX_EXAMPLE_LENGTH || !ARABIC_LETTER_RE.test(example)) return "";
  if (!lineUsesWord(example, word)) return "";
  return foldedTokens(example).length > foldedTokens(word).length ? example : "";
}

const DIALECT_NAME: Readonly<Record<AssetDialect, string>> = {
  Gulf: "Gulf (Khaliji) Arabic",
  Egyptian: "Egyptian Arabic",
  Yemeni: "Yemeni Arabic",
};

const DIALECT_PLACES: Readonly<Record<AssetDialect, string>> = {
  Gulf: "everyday life in the Gulf today: home, the majlis, a café, the souq, work, the car",
  Egyptian: "everyday life in Egypt today: home, a Cairo street, a café, the market, work, a microbus",
  Yemeni: "everyday life in Yemen today: home, the souq, a qat chew, work, a family visit",
};

/** Quote-free and one line, since the sense and example sit inside quotes in the prompt. */
function promptSafe(text: string, max: number): string {
  return text.replace(/["“”«»]/g, "'").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The prompt for a word's exchange, built only from what the key was built
 * from (the folded word, the folded sense, the dialect) plus, on the trusted
 * path alone, an authored example. Nothing else a caller says reaches it, so
 * whoever misses first cannot decide what every later learner is asked.
 */
export function dialoguePrompt(input: {
  /** The key's folded word (`keyWord`). */
  word: string;
  /** The key's folded sense. */
  sense: string;
  dialect: AssetDialect;
  /** A curriculum word's authored example (`authoredExample`); never a learner's text. */
  example?: string | null;
}): string {
  const word = promptSafe(input.word, 80);
  const sense = promptSafe(input.sense, 120);
  const example = promptSafe(input.example ?? "", MAX_EXAMPLE_LENGTH);
  return [
    `Write a two-line exchange in everyday spoken ${DIALECT_NAME[input.dialect]}, the way two people really talk.`,
    `Line 1: one person says something natural (a question, an offer, a remark) that does not contain the word ${word}.`,
    `Line 2: the other person replies, and the reply uses the word ${word} (meaning "${sense}") in that meaning.`,
    `Write ${word} in the reply exactly as given, as a whole word on its own, with no article, pronoun or other letters attached to it.`,
    "Keep each line short: one sentence of at most ten words, something a learner could say aloud.",
    `Set it in ${DIALECT_PLACES[input.dialect]}.`,
    example ? `For context, the course uses the word like this: '${example}'. Do not copy that sentence.` : "",
    "For each line give the speaker (a short English role such as Friend or Shopkeeper), the Arabic as people write the dialect, a natural English translation, and a Latin transliteration.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The structured output the Brain is asked for. */
export const DIALOGUE_TOOL = {
  name: "emit_dialogue",
  description: "A two-line spoken exchange whose reply uses the word.",
  parameters: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            speaker: { type: "string" },
            arabic: { type: "string" },
            english: { type: "string" },
            transliteration: { type: "string" },
          },
          required: ["speaker", "arabic", "english", "transliteration"],
        },
      },
    },
    required: ["lines"],
  },
} as const;
