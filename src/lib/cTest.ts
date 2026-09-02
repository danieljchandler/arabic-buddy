/**
 * C-test: a passage in which the second half of every second word is
 * deleted and the learner restores it. One of the outcome instruments the
 * Duolingo efficacy study used (docs/language-learning-research-2026-09.md
 * §6) — a fast, reliable overall-proficiency measure — and one that needs
 * no new generation: any level-controlled passage (reading-passage) will do.
 *
 * Pure. Classic construction: the first sentence stays intact as context;
 * from the second on, every second word of three or more letters loses its
 * second half (the first ⌈n/2⌉ letters remain). Scoring is exact match on
 * the normalised form — spelling variants a speaker cannot hear (hamza
 * seats, ة/ه, ى/ي, tashkeel) count as right.
 */
import { normalizeArabicWord } from "@/lib/arabicWord";

export interface CTestItem {
  /** Index into the flattened word list, for rendering in place. */
  index: number;
  /** What is shown. */
  stem: string;
  /** What must be typed to complete the word. */
  answer: string;
  /** The whole word, for the reveal. */
  word: string;
}

export interface CTest {
  /** Every word of the passage, in order, tashkeel stripped for display consistency. */
  words: string[];
  /** Word indices that are gaps. */
  items: CTestItem[];
}

export interface CTestScore {
  correct: number;
  total: number;
  /** 0..100 */
  percent: number;
  /** Per item: whether the learner's answer matched. */
  results: boolean[];
}

/** Words shorter than this are never gapped — too little to reconstruct. */
export const MIN_GAP_WORD_LENGTH = 3;
/** Gaps per test the instrument aims for; classic C-tests use 20–25 per text. */
export const TARGET_GAPS = 20;

const TASHKEEL = /[ً-ْٰـ]/g;
const ARABIC_LETTER = /[ء-ي]/;

function splitWords(line: string): string[] {
  return line
    .replace(TASHKEEL, "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/** Letters only, for deciding whether a word is gappable and where to cut. */
function letterCount(word: string): number {
  return [...word].filter((ch) => ARABIC_LETTER.test(ch)).length;
}

/**
 * Build the test from a passage's sentences.
 *
 * Gapping continues until `maxGaps` is reached, then the rest of the passage
 * is left whole — a tail of intact text is fine, a truncated passage is not.
 */
export function buildCTest(lines: string[], options: { maxGaps?: number } = {}): CTest {
  const maxGaps = options.maxGaps ?? TARGET_GAPS;
  const words: string[] = [];
  const items: CTestItem[] = [];
  let everyOther = false;

  lines.forEach((line, lineIndex) => {
    for (const word of splitWords(line)) {
      const index = words.length;
      words.push(word);
      if (lineIndex === 0) continue; // first sentence intact
      if (letterCount(word) < MIN_GAP_WORD_LENGTH) continue;
      everyOther = !everyOther;
      if (!everyOther) continue;
      if (items.length >= maxGaps) continue;
      const chars = [...word];
      const keep = Math.ceil(chars.length / 2);
      items.push({ index, stem: chars.slice(0, keep).join(""), answer: chars.slice(keep).join(""), word });
    }
  });

  return { words, items };
}

/** Does the learner's completion restore the word? Whole-word comparison, normalised. */
export function completionMatches(item: CTestItem, typed: string): boolean {
  const attempt = normalizeArabicWord(item.stem + (typed ?? "").trim());
  return attempt.length > 0 && attempt === normalizeArabicWord(item.word);
}

export function scoreCTest(test: CTest, answers: Array<string | null | undefined>): CTestScore {
  const results = test.items.map((item, i) => completionMatches(item, answers[i] ?? ""));
  const correct = results.filter(Boolean).length;
  const total = test.items.length;
  return { correct, total, percent: total === 0 ? 0 : Math.round((correct / total) * 100), results };
}
