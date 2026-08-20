/**
 * Word-level Arabic matching.
 *
 * Saved words and the text they came from routinely disagree in spelling
 * without disagreeing in word: AI enrichment returns vocalized forms
 * (بَيْت) while transcripts are bare, hamza carriers and ى/ة vary by
 * writer, and tokens carry sentence punctuation. Every feature that looks a
 * word up in running text — cloze minting, word-tap glossing, dictation —
 * must compare through this, not with `===`.
 */
import { normalizeArabic } from "../../supabase/functions/_shared/msaLeakDetector";

/** Arabic and Latin sentence punctuation that can ride along on a token. */
export const ARABIC_PUNCT_RE = /[،؛؟!.,?:;"'«»()[\]…–—-]/g;

/** A single word folded for comparison: punctuation off, then normalized. */
export function normalizeArabicWord(word: string): string {
  return normalizeArabic((word ?? "").replace(ARABIC_PUNCT_RE, ""));
}

/** Whether `sentence` contains `word` as a whole token, normalized. */
export function sentenceHasWord(sentence: string, word: string): boolean {
  const target = normalizeArabicWord(word);
  if (!sentence || !target) return false;
  return sentence.split(/\s+/).some((t) => normalizeArabicWord(t) === target);
}

export interface WordSpan {
  /** Offset of the word's first letter in the original string. */
  start: number;
  /** Offset just past the word's last letter (attached punctuation excluded). */
  end: number;
}

/**
 * The span of the first token matching `word`, with the token's attached
 * punctuation left outside the span — so blanking the span keeps the
 * sentence's own commas and question marks in place.
 */
export function findWordSpan(sentence: string, word: string): WordSpan | null {
  const target = normalizeArabicWord(word);
  if (!sentence || !target) return null;

  const tokenRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(sentence))) {
    const token = m[0];
    if (normalizeArabicWord(token) !== target) continue;

    let start = 0;
    let end = token.length;
    const isPunct = (ch: string) => {
      ARABIC_PUNCT_RE.lastIndex = 0;
      return ARABIC_PUNCT_RE.test(ch);
    };
    while (start < end && isPunct(token[start])) start++;
    while (end > start && isPunct(token[end - 1])) end--;
    return { start: m.index + start, end: m.index + end };
  }
  return null;
}
