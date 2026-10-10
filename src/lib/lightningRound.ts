import type { QuizFormat } from "@/lib/quizLadder";
import { seededShuffle } from "@/lib/quizDistractors";

/**
 * The lightning round (quiz Phase 7): after a quiz session, sixty seconds
 * over the words the learner got right on the way in, at the ladder's first
 * four steps. Score and time, and nothing else.
 *
 * It is the one part of the quiz that is pure game, so it is fenced off from
 * everything the session does: no answer in it is a rating, nothing is
 * written to any schedule, no XP is paid, and nothing new is synthesised or
 * generated — the round asks only what the cards can ask from what the
 * session already had. A word is asked once; the round ends when the clock
 * runs out or every word has been asked, whichever is first, and the time is
 * part of the result.
 *
 * Everything here is pure, with the clock passed in, so the round can be
 * tested without a timer.
 */

/** The round's clock. */
export const LIGHTNING_SECONDS = 60;
export const LIGHTNING_MS = LIGHTNING_SECONDS * 1000;

/** The highest step the round draws from: the gap, the picture, hearing it. */
export const LIGHTNING_TOP_STEP = 4;

/** Fewest words a round is offered over; below this it is not a round. */
export const LIGHTNING_MIN_WORDS = 3;

/**
 * How long an answer stays on screen before the next question: long enough
 * to see a right one land, and to read the right answer after a wrong one.
 * The clock runs on through it.
 */
export const LIGHTNING_REVEAL_MS = { right: 500, wrong: 1200 } as const;

/**
 * The question a word is asked in the round. Fewer than the ladder's: the
 * gap, without the first look's hint (the word was just answered right); the
 * word shown, to pick its meaning (the picture question's direction, word to
 * meaning, with the meanings as words); and the word heard alone.
 */
export type LightningFormat = "cloze" | "meaning" | "listen";

/** What the round needs of a session's right answer. */
export interface LightningAnswer {
  correct: boolean;
  /**
   * The ladder's step for the card, from its own memory (`QuizGraded.step`).
   * A boss asked as a first look reports its own step, so a boss well past
   * step 4 is not in the round.
   */
  step: number;
  /** The question it was asked as. */
  format: QuizFormat;
}

/**
 * The question a right answer is asked in the round, or null when it does
 * not belong in one: a wrong answer, a step above the first four, or a
 * question the round does not ask (a self-rated flip card).
 *
 * `hasRecording` says whether the word has audio of its own. Hearing it
 * alone needs a sound, and the round synthesises nothing, so a word whose
 * only voice was synthesised is shown instead.
 */
export function lightningFormat(answer: LightningAnswer, hasRecording: boolean): LightningFormat | null {
  if (!answer.correct || answer.step < 1 || answer.step > LIGHTNING_TOP_STEP) return null;
  switch (answer.format) {
    case "cloze-hint":
    case "cloze":
      return "cloze";
    case "meaning":
    case "picture-choice":
      return "meaning";
    case "listen":
      return hasRecording ? "listen" : "meaning";
    default:
      return null;
  }
}

/** A word in the round: its id, the question it is asked, and the card's material. */
export interface LightningWord<T> {
  id: string;
  format: LightningFormat;
  item: T;
}

/**
 * A recording the round may play: a stored one. A `blob:` url is a voice a
 * page synthesised for the card on screen, revoked once the card changes, so
 * by the end of the session it plays nothing.
 */
export function storedRecording(url: string | null | undefined): string | null {
  return url && !url.startsWith("blob:") ? url : null;
}

/**
 * A session's answer as a word for the round, or null when it is not one:
 * the question (`lightningFormat`), and the card with only a stored
 * recording kept on it.
 */
export function lightningWordFor<T extends { id: string; audioUrl?: string | null }>(
  answer: LightningAnswer,
  item: T,
): LightningWord<T> | null {
  const audioUrl = storedRecording(item.audioUrl);
  const format = lightningFormat(answer, audioUrl !== null);
  return format ? { id: item.id, format, item: { ...item, audioUrl } } : null;
}

/**
 * Today's right answers, kept for the round: the word added the first time
 * it is right, and never twice (a word relearnt in the session is right
 * again under the same id, and is still one word).
 */
export function addLightningWord<T>(words: readonly LightningWord<T>[], word: LightningWord<T>): LightningWord<T>[] {
  return words.some((w) => w.id === word.id) ? [...words] : [...words, word];
}

/** Whether a session's right answers make a round. */
export function canOfferLightning(words: readonly unknown[]): boolean {
  return words.length >= LIGHTNING_MIN_WORDS;
}

export interface LightningState {
  /** The word ids, in the order they are asked. */
  order: string[];
  /** The word on screen. */
  index: number;
  /** Answers given, and how many were right. */
  answered: number;
  right: number;
  /** The word on screen has been answered and is showing its answer. */
  revealing: boolean;
  startedAt: number;
  /** When the round ended: the clock ran out, or the last word was answered. */
  endedAt: number | null;
}

/**
 * A round over `ids`, dealt in an order of its own (`seed`), started at `now`.
 * Given the last round's order, never the same one again: "Play again" is a
 * new deal, not the same run from memory.
 */
export function startLightning(
  ids: readonly string[],
  seed: string,
  now: number,
  previous: readonly string[] = [],
): LightningState {
  let order = seededShuffle([...new Set(ids)], `${seed}:lightning`);
  if (order.length > 1 && order.every((id, i) => previous[i] === id)) order = [...order.slice(1), order[0]];
  return {
    order,
    index: 0,
    answered: 0,
    right: 0,
    revealing: false,
    startedAt: now,
    endedAt: order.length === 0 ? now : null,
  };
}

/** Milliseconds left on the clock at `now`. */
export function lightningRemainingMs(state: LightningState, now: number): number {
  const end = state.endedAt ?? now;
  return Math.max(0, LIGHTNING_MS - (end - state.startedAt));
}

/** The clock ran out at `now`: the round ends on the minute, mid-question or not. */
export function expireLightning(state: LightningState, now: number): LightningState {
  if (state.endedAt !== null || now - state.startedAt < LIGHTNING_MS) return state;
  return { ...state, endedAt: state.startedAt + LIGHTNING_MS, revealing: false };
}

/**
 * The word on screen was answered at `now`. The last word's answer ends the
 * round then and there, so the clock stops on it; its reveal still plays, off
 * the clock, so a learner who missed it sees the right answer. An answer after
 * the end, or a second answer to one word, changes nothing.
 */
export function answerLightning(state: LightningState, correct: boolean, now: number): LightningState {
  const expired = expireLightning(state, now);
  if (expired.endedAt !== null || expired.revealing) return expired;
  const last = expired.index >= expired.order.length - 1;
  return {
    ...expired,
    answered: expired.answered + 1,
    right: expired.right + (correct ? 1 : 0),
    revealing: true,
    endedAt: last ? now : null,
  };
}

/** The reveal is over: on to the next word, or to the result after the last. */
export function nextLightning(state: LightningState, now: number): LightningState {
  if (!state.revealing) return expireLightning(state, now);
  if (state.endedAt !== null) return { ...state, revealing: false };
  const expired = expireLightning(state, now);
  if (expired.endedAt !== null) return expired;
  return { ...expired, index: expired.index + 1, revealing: false };
}

/** The word on screen: the one being asked, or the last one while its answer shows; null once the result is up. */
export function currentLightningId(state: LightningState): string | null {
  if (state.endedAt !== null && !state.revealing) return null;
  return state.order[state.index] ?? null;
}

/** Whether the result is up: the round is over and nothing is still showing its answer. */
export function lightningOver(state: LightningState): boolean {
  return state.endedAt !== null && !state.revealing;
}

export interface LightningResult {
  right: number;
  answered: number;
  /** Words in the round. */
  total: number;
  /** Whole seconds the round took: the minute, or less when every word was asked first. */
  seconds: number;
  /** Every word was asked before the clock ran out. */
  cleared: boolean;
}

/** The score and the time, once the round is over; null while it runs or its last answer shows. */
export function lightningResult(state: LightningState): LightningResult | null {
  if (!lightningOver(state) || state.endedAt === null) return null;
  const elapsed = Math.min(LIGHTNING_MS, state.endedAt - state.startedAt);
  return {
    right: state.right,
    answered: state.answered,
    total: state.order.length,
    seconds: Math.ceil(elapsed / 1000),
    cleared: state.answered === state.order.length,
  };
}
