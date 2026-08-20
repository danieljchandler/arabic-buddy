/**
 * The in-session relearn queue.
 *
 * The scheduler assigns failed cards short learning steps (minutes), but a
 * review session used to walk its fetched list once and refetch at the end —
 * by which time a card rated Again (due at now+1min) was not yet due, so the
 * session ended and the failed card got no successful retrieval until the
 * next day. The relearning state FSRS wrote was never actually earned;
 * errors that aren't re-retrieved are the biggest leak in an SRS.
 *
 * This module is the pure policy: cards rated Again or Hard re-enter the
 * session a few cards later (far enough to prevent parroting the answer
 * from echo memory, near enough to still count as relearning), and the
 * session only ends once the queue is drained. The pages own the state; the
 * decisions live here where they can be tested.
 */

export interface RelearnEntry<T> {
  card: T;
  /** Session position (cards rated so far) at which this card comes due. */
  dueAtCount: number;
}

/**
 * How many cards later a failed card returns. Within the 6–10 window that
 * keeps the retrieval real; toward the low end so short sessions still get
 * their relearn pass before the main list runs out.
 */
export const RELEARN_GAP = 7;

/** Queue a failed card to come back `gap` cards from now. */
export function pushRelearn<T>(
  queue: RelearnEntry<T>[],
  card: T,
  sessionCount: number,
  gap: number = RELEARN_GAP,
): RelearnEntry<T>[] {
  return [...queue, { card, dueAtCount: sessionCount + gap }];
}

/**
 * The relearn card to present now, if any. The head is presented once its
 * position comes up — or immediately when the main list is exhausted, since
 * waiting any longer would end the session with the card untested.
 */
export function nextRelearn<T>(
  queue: RelearnEntry<T>[],
  sessionCount: number,
  mainExhausted: boolean,
): RelearnEntry<T> | null {
  const head = queue[0];
  if (!head) return null;
  return mainExhausted || head.dueAtCount <= sessionCount ? head : null;
}
