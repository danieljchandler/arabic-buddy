import { normalizeArabicWord } from "@/lib/arabicWord";
import type { Rating } from "@/lib/spacedRepetition";
import { arabicSimilarity } from "../../supabase/functions/_shared/arabicMatch";
import { withoutProclitics } from "../../supabase/functions/_shared/wordDialogue";

/**
 * How a quiz answer becomes an FSRS rating.
 *
 * In the quiz style the app grades; the Again / Hard / Good / Easy buttons do
 * not appear. The map is deliberately conservative on the choice questions:
 * when the options were on screen the best a right answer can earn is Good,
 * because recognising the answer among four is weaker evidence than
 * recalling it — the same rule the lesson quiz and the video debrief apply
 * (`quizRating` in src/lib/videoDebrief.ts). A right answer reached with a
 * hint (the meaning on a first look, the sentence's translation) is Hard:
 * the card stays close without being called a lapse.
 *
 * A spoken answer is the one honest route to Easy, unless the learner asked
 * what a picture meant first — then the recall was from the meaning, and the
 * take is capped at Hard like a helped choice. The score is the
 * calibrated pronunciation score the `azure-pronunciation` function returns
 * (never Azure's raw number — see CLAUDE.md), and a take that was not the
 * target word at all is Again whatever it scored, since the assessment
 * scores the sounds against the reference even when a different word was
 * said. On "say the reply" the take is a whole line and the word is what the
 * step is about, so the comparison is made on the word's span of what was
 * heard (`wordSpanSimilarity`): a reply said without the word is Again.
 *
 * And a reply with the word clearly in it is never Again, however it scored.
 * The score is taken against the one stored reply, so a learner who answers
 * the line correctly in other words loses on completeness and can land below
 * the Hard band; rated Again, that would be a lapse on a production card a
 * month or more old, for an answer that was right. Decided by the owner on
 * 2026-10-10: such a take is Hard, not a lapse (`REPLY_WORD_CLEAR`).
 */

export interface ChoiceOutcome {
  kind: "choice";
  correct: boolean;
  /** The learner used help the step did not offer by default. */
  hintUsed?: boolean;
}

export interface SpeechOutcome {
  kind: "speech";
  /** Calibrated 0–100 pronunciation score. */
  score: number;
  /**
   * Character similarity (0–1) between what was recognised and the target,
   * or null when nothing was recognised to compare.
   */
  similarity: number | null;
  /** The learner asked for the meaning before saying a word shown as a picture. */
  hintUsed?: boolean;
  /**
   * The take is a whole reply (step 9), and `similarity` is the word's span
   * of what was heard (`wordSpanSimilarity`), not the take's.
   */
  reply?: boolean;
}

export type QuizOutcome = ChoiceOutcome | SpeechOutcome;

/** Score bands for a spoken answer, on the calibrated scale. */
export const SPEECH_THRESHOLDS = {
  easy: 85,
  good: 70,
  hard: 55,
} as const;

/**
 * Below this similarity the learner said something other than the target.
 * Generous on purpose: ASR on learner speech routinely drops a letter or
 * picks a spelling variant, and that is a pronunciation question for the
 * score, not a "wrong word" verdict.
 */
export const SPEECH_MATCH_FLOOR = 0.5;

/**
 * How close the word's span of a reply must come for the word to count as
 * clearly said. Stricter than `SPEECH_MATCH_FLOOR`, which only rules out a
 * different word: this one lifts a low-scoring reply out of Again, so it asks
 * for the word itself. A word of `SHORT_WORD_LETTERS` or fewer reaches it only
 * when heard exactly.
 */
export const REPLY_WORD_CLEAR = 0.8;

export function gradeQuizAnswer(outcome: QuizOutcome): Rating {
  if (outcome.kind === "choice") {
    if (!outcome.correct) return "again";
    return outcome.hintUsed ? "hard" : "good";
  }

  if (outcome.similarity != null && outcome.similarity < SPEECH_MATCH_FLOOR) return "again";
  const score = Number.isFinite(outcome.score) ? outcome.score : 0;
  if (score < SPEECH_THRESHOLDS.hard) {
    // A reply in the learner's own words with the word clearly in it scores
    // low against the stored line, and is still a right answer: not a lapse.
    const wordClearlySaid = outcome.reply === true && outcome.similarity != null && outcome.similarity >= REPLY_WORD_CLEAR;
    return wordClearlySaid ? "hard" : "again";
  }
  // A word said well after asking what the picture meant was recalled from
  // the meaning, not the picture: the sounds earn their band, capped at Hard.
  if (outcome.hintUsed) return "hard";
  if (score >= SPEECH_THRESHOLDS.easy) return "easy";
  if (score >= SPEECH_THRESHOLDS.good) return "good";
  return "hard";
}

/**
 * A word this short is one letter from another word (زين / وين, شو / شي,
 * مو / ما), and a letter is well inside the similarity floor's allowance, so
 * on "say the reply" only the word itself counts.
 */
export const SHORT_WORD_LETTERS = 3;

/**
 * How close the closest stretch of what was heard came to the word: the best
 * `arabicSimilarity` over every run of recognised words as long as the word
 * itself, with a conjunction, preposition or article attached to the first
 * of them taken off (والقهوة, بالسوق are the word). For a take that is a
 * whole line (say the reply), where the line may be said well and the word
 * left out — which is a different reply. A word of `SHORT_WORD_LETTERS` or
 * fewer must be heard exactly; anything else is scored as a different word.
 * Null when nothing was recognised, as for a single word.
 */
export function wordSpanSimilarity(recognized: string | null | undefined, word: string): number | null {
  const heard = (recognized ?? "")
    .split(/\s+/)
    .map((token) => normalizeArabicWord(token))
    .filter(Boolean);
  if (heard.length === 0) return null;
  const parts = word.trim().split(/\s+/);
  const size = Math.max(1, parts.length);
  const windows: string[][] = [];
  if (heard.length <= size) windows.push(heard);
  else for (let start = 0; start + size <= heard.length; start++) windows.push(heard.slice(start, start + size));

  let best = 0;
  for (const window of windows) {
    for (const first of withoutProclitics(window[0])) {
      best = Math.max(best, arabicSimilarity([first, ...window.slice(1)].join(" "), word));
    }
  }
  const short = size === 1 && normalizeArabicWord(word).length <= SHORT_WORD_LETTERS;
  return short && best < 1 ? Math.min(best, SPEECH_MATCH_FLOOR / 2) : best;
}

/** Whether a rating counts as a correct answer for the session's tally. */
export function isCorrectRating(rating: Rating): boolean {
  return rating !== "again";
}
