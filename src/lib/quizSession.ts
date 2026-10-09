/**
 * The running tally of a quiz session: what the summary at the end shows and
 * what the combo on the progress bar reads from.
 *
 * None of this touches scheduling. The combo pays XP at milestones and the
 * summary counts words that climbed a step, but the rating a card gets is
 * decided by the answer alone (src/lib/quizGrading.ts). Game chrome that
 * leaked into intervals would be the one way to make the quiz worse than the
 * flashcards it is an alternative to.
 */

export interface QuizSessionStats {
  answered: number;
  correct: number;
  /** Consecutive correct answers, right now. */
  combo: number;
  bestCombo: number;
  /** Cards whose next question will be a step up the ladder. */
  promotions: number;
  /** Cards that dropped a step. */
  demotions: number;
}

export const EMPTY_QUIZ_SESSION: QuizSessionStats = {
  answered: 0,
  correct: 0,
  combo: 0,
  bestCombo: 0,
  promotions: 0,
  demotions: 0,
};

export interface QuizAnswerRecord {
  correct: boolean;
  /** The step the card was on, and the step its new memory state puts it on. */
  stepBefore: number;
  stepAfter: number;
}

export function recordQuizAnswer(stats: QuizSessionStats, answer: QuizAnswerRecord): QuizSessionStats {
  const combo = answer.correct ? stats.combo + 1 : 0;
  return {
    answered: stats.answered + 1,
    correct: stats.correct + (answer.correct ? 1 : 0),
    combo,
    bestCombo: Math.max(stats.bestCombo, combo),
    promotions: stats.promotions + (answer.stepAfter > answer.stepBefore ? 1 : 0),
    demotions: stats.demotions + (answer.stepAfter < answer.stepBefore ? 1 : 0),
  };
}

/** Accuracy as a 0–1 fraction, or null before anything was answered. */
export function quizAccuracy(stats: QuizSessionStats): number | null {
  return stats.answered === 0 ? null : stats.correct / stats.answered;
}

/**
 * Combo milestones and the XP each one pays, once, when the combo reaches it.
 * Small next to the flat per-card review XP, so a long combo is a flourish
 * rather than a reason to game the deck; a miss resets the combo and costs
 * nothing.
 */
export const COMBO_MILESTONES: ReadonlyArray<{ at: number; xp: number }> = [
  { at: 5, xp: 10 },
  { at: 10, xp: 25 },
  { at: 20, xp: 50 },
];

/** The XP a combo pays on reaching exactly `combo`, or null if none. */
export function comboBonus(combo: number): number | null {
  return COMBO_MILESTONES.find((m) => m.at === combo)?.xp ?? null;
}

/** The next milestone above the current combo, for "3 more to a bonus" copy. */
export function nextComboMilestone(combo: number): number | null {
  return COMBO_MILESTONES.find((m) => m.at > combo)?.at ?? null;
}
