import type { QuizDirection, QuizMemory } from "@/lib/quizLadder";

/**
 * The boss card (quiz Phase 7): the session opens on the learner's worst
 * word. Of the cards due, the leech with the most lapses comes first, and is
 * asked as a first look — the gap with its meaning beside it, the ladder's
 * gentlest question — with its memory hook and picture a tap away (opening
 * them first is help). Beating it is a celebration (`celebrate({ kind: "boss" })`).
 *
 * The boss is chosen from what is due, never added to it, so nothing is
 * reviewed early; and only on the recognition side, because a first look
 * grades the recognition schedule and a production card's rating lands on
 * the other one. Its answer is graded as any first look's is: right is Good,
 * right after opening the mnemonic is Hard (help, as the sentence is), wrong
 * is Again. The game is in the order and the moment, never in the rating.
 */

export interface BossCandidate {
  /** The card is flagged a leech (and the learner tracks leeches). */
  isLeech: boolean;
  /** Lapses on the schedule the card is served on. */
  lapses: number;
  /** The direction it is served in; only recognition can be asked as a first look. */
  direction: QuizDirection;
}

/** Whether a card can be the boss at all. */
export function canBeBoss(candidate: BossCandidate): boolean {
  return candidate.isLeech && candidate.direction === "recognition" && candidate.lapses > 0;
}

/**
 * Where the session's boss is in the deck: the recognition leech with the
 * most lapses, the earlier one on a tie (the deck's own order already put the
 * most overdue first), or -1 when no card due can be one.
 */
export function pickBoss<T>(cards: readonly T[], read: (card: T) => BossCandidate): number {
  let best = -1;
  let bestLapses = 0;
  cards.forEach((card, i) => {
    const candidate = read(card);
    if (!canBeBoss(candidate)) return;
    if (best === -1 || candidate.lapses > bestLapses) {
      best = i;
      bestLapses = candidate.lapses;
    }
  });
  return best;
}

/** The deck with its boss first and every other card in its order; the deck itself when it has none. */
export function withBossFirst<T>(cards: readonly T[], read: (card: T) => BossCandidate): T[] {
  const boss = pickBoss(cards, read);
  if (boss <= 0) return [...cards];
  return [cards[boss], ...cards.slice(0, boss), ...cards.slice(boss + 1)];
}

/**
 * Whether the card on screen is asked as the boss: the session's first card,
 * before anything has been answered, when it can be one. A deck rebuilt later
 * in the session (the end-of-list refetch) may put a leech first again, and
 * that one is an ordinary card: the boss opens a session once.
 */
export function isBossTurn(input: { answered: number; position: number; candidate: BossCandidate }): boolean {
  return input.answered === 0 && input.position === 0 && canBeBoss(input.candidate);
}

/**
 * Whether an answer beat the boss: the card was asked as the boss and the
 * answer was right. The page celebrates once the rating is saved, so a save
 * that fails is never celebrated.
 */
export function bossBeaten(graded: { correct: boolean; item: { boss?: unknown } }): boolean {
  return graded.correct && !!graded.item.boss;
}

/** The memory a boss is asked from: a first look, whatever its stability. */
export const BOSS_MEMORY: QuizMemory = { stability: 0, repetitions: 0 };

/** What the quiz is told about the boss on screen (`QuizItem.boss`). */
export interface BossInfo {
  /** How often the word has been missed, on either schedule. */
  lapses: number;
  /** The learner's memory hook for it, if they have one. */
  mnemonic?: string | null;
  /** The hook's picture, else the word's own. */
  pictureUrl?: string | null;
}

/** The card on screen, as a page knows it. */
export interface BossTurnCard {
  /** The card is flagged a leech. */
  isLeech: boolean;
  /** Lapses on every schedule the word has: "the most lapses". */
  lapses: number;
  /** The direction it is served in. */
  direction: QuizDirection;
  mnemonic?: string | null;
  pictureUrl?: string | null;
}

/**
 * The boss to put on the card on screen, or null. Every quiz deck asks this
 * the same way: the session's first card, before any answer (`isBossTurn`),
 * when the learner tracks leeches and it is a recognition leech with lapses.
 * A relearn card come back is never the boss: it is not the deck's first card,
 * whatever the list index says while it is on screen.
 */
export function bossFor(input: {
  /** Cards answered this session. */
  answered: number;
  /** Where the list's card is in the list. */
  position: number;
  /** The card on screen is a relearn card, not the list's. */
  relearn: boolean;
  /** The learner tracks leeches. */
  tracking: boolean;
  card: BossTurnCard;
}): BossInfo | null {
  if (input.relearn) return null;
  const candidate: BossCandidate = {
    isLeech: input.tracking && input.card.isLeech,
    lapses: input.card.lapses,
    direction: input.card.direction,
  };
  if (!isBossTurn({ answered: input.answered, position: input.position, candidate })) return null;
  return {
    lapses: input.card.lapses,
    mnemonic: input.card.mnemonic ?? null,
    pictureUrl: input.card.pictureUrl ?? null,
  };
}
