/**
 * Grading for typed-Arabic dictation.
 *
 * The old check was a strict `===` after whitespace collapse, so a learner
 * who typed بيت against a target بَيت — or spelled with ا for أ, ي for ى,
 * ه for ة, all legitimate variants in dialect writing — was told "Not
 * quite" while being right. Feedback that mis-corrects is worse than none.
 *
 * Words compare on `normalizeArabic` (tashkeel/tatweel stripped, hamza
 * carriers folded, ى→ي, ة→ه) with punctuation removed, and the grade comes
 * back per target word so the result panel can show *which* word missed
 * rather than a binary verdict. Alignment is a longest-common-subsequence
 * over normalized words: one missing word in the middle marks only itself,
 * not everything after it.
 */
import { normalizeArabicWord } from "./arabicWord";

export interface DictationWord {
  /** The target word as written, for display. */
  word: string;
  /** Whether the learner's answer contains this word (normalized). */
  ok: boolean;
}

export interface DictationGrade {
  correct: boolean;
  /** The target sentence, word by word, each marked matched or missed. */
  words: DictationWord[];
}

const tokens = (s: string): string[] => s.split(/\s+/).filter(Boolean);

const normalizeWord = normalizeArabicWord;

export function gradeDictation(answer: string, target: string): DictationGrade {
  const targetWords = tokens(target);
  const targetNorm = targetWords.map(normalizeWord).filter(Boolean);
  const answerNorm = tokens(answer).map(normalizeWord).filter(Boolean);

  // LCS table over normalized words.
  const m = targetNorm.length;
  const n = answerNorm.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i][j] =
        targetNorm[i - 1] === answerNorm[j - 1]
          ? lcs[i - 1][j - 1] + 1
          : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  // Walk back to mark which target words are part of the match.
  const matched = new Array<boolean>(m).fill(false);
  for (let i = m, j = n; i > 0 && j > 0; ) {
    if (targetNorm[i - 1] === answerNorm[j - 1]) {
      matched[i - 1] = true;
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Punctuation-only target tokens (rare) carry no norm entry; keep display
  // and marking aligned by re-deriving per display word.
  let normIndex = 0;
  const words: DictationWord[] = targetWords.map((word) => {
    if (!normalizeWord(word)) return { word, ok: true };
    return { word, ok: matched[normIndex++] };
  });

  // Correct means every target word was produced and nothing extra was —
  // extra words are a mishearing too, even when the rest lines up.
  const correct = m > 0 && lcs[m][n] === m && n === m;

  return { correct, words };
}
