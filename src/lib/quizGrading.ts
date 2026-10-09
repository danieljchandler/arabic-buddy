import type { Rating } from "@/lib/spacedRepetition";

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
 * said.
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

export function gradeQuizAnswer(outcome: QuizOutcome): Rating {
  if (outcome.kind === "choice") {
    if (!outcome.correct) return "again";
    return outcome.hintUsed ? "hard" : "good";
  }

  if (outcome.similarity != null && outcome.similarity < SPEECH_MATCH_FLOOR) return "again";
  const score = Number.isFinite(outcome.score) ? outcome.score : 0;
  if (score < SPEECH_THRESHOLDS.hard) return "again";
  // A word said well after asking what the picture meant was recalled from
  // the meaning, not the picture: the sounds earn their band, capped at Hard.
  if (outcome.hintUsed) return "hard";
  if (score >= SPEECH_THRESHOLDS.easy) return "easy";
  if (score >= SPEECH_THRESHOLDS.good) return "good";
  return "hard";
}

/** Whether a rating counts as a correct answer for the session's tally. */
export function isCorrectRating(rating: Rating): boolean {
  return rating !== "again";
}
