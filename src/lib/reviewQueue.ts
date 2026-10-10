import type { Rating } from "@/lib/spacedRepetition";
import type { ScheduleDirection } from "@/lib/reviewOrder";
import type { QuizAsked } from "@/lib/quizRatingFields";

export interface QueuedReviewSnapshot {
  id: string;
  ease_factor: number;
  difficulty?: number | null;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string;
  /** Lapse counters, needed to increment them correctly on a failed rating. */
  lapses?: number | null;
  production_lapses?: number | null;
  /**
   * Production schedule. Absent/null next_review_at means the word hasn't been
   * unlocked for production yet.
   */
  production_ease_factor?: number | null;
  production_difficulty?: number | null;
  production_interval_days?: number | null;
  production_repetitions?: number | null;
  production_last_reviewed_at?: string | null;
  production_next_review_at?: string | null;
}

export interface QueuedRating {
  id: string;
  userId: string;
  wordId: string;
  rating: Rating;
  /**
   * Which schedule this rating updates. Absent on entries queued before
   * directions existed — those are recognition ratings, so the flush treats a
   * missing value as "recognition" rather than dropping them. Writing a rating
   * to the wrong column set silently corrupts a card's schedule, so this is
   * never inferred from anything else.
   */
  direction?: ScheduleDirection;
  currentReview: QueuedReviewSnapshot | null;
  /**
   * What the quiz asked it as (quiz Phase 8), written with the rating for the
   * review log. Absent for a flip card, and on entries queued before it existed.
   */
  asked?: QuizAsked | null;
  queuedAt: number;
  attempts: number;
}

const KEY_PREFIX = "hakiya:review-queue:";

const storageKey = (userId: string) => `${KEY_PREFIX}${userId}`;

function safeRead(userId: string): QueuedRating[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(userId: string, items: QueuedRating[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // storage may be blocked in iframes; ignore
  }
}

export function all(userId: string): QueuedRating[] {
  return safeRead(userId);
}

export function enqueue(
  userId: string,
  entry: Omit<QueuedRating, "id" | "userId" | "queuedAt" | "attempts">
): QueuedRating {
  const item: QueuedRating = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    queuedAt: Date.now(),
    attempts: 0,
    ...entry,
  };
  const items = safeRead(userId);
  items.push(item);
  safeWrite(userId, items);
  return item;
}

export function peek(userId: string): QueuedRating | null {
  return safeRead(userId)[0] ?? null;
}

export function remove(userId: string, id: string) {
  safeWrite(
    userId,
    safeRead(userId).filter((it) => it.id !== id)
  );
}

export function bumpAttempts(userId: string, id: string) {
  const items = safeRead(userId);
  const next = items.map((it) =>
    it.id === id ? { ...it, attempts: it.attempts + 1 } : it
  );
  safeWrite(userId, next);
}

export function clearForUser(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}

export function count(userId: string): number {
  return safeRead(userId).length;
}

/**
 * How long a queued rating keeps its card out of the due list. A queue that
 * cannot drain (a head item failing forever with an error that reads as a
 * dropped connection) would otherwise hide its cards for good; past a day the
 * card is served again, and a second rating queues behind the first.
 */
export const QUEUED_HIDES_CARD_MS = 24 * 60 * 60 * 1000;

/** The queued ratings that still keep their cards out of the due list. */
export function ratingsHidingCards<T extends Pick<QueuedRating, "queuedAt">>(items: readonly T[], nowMs: number): T[] {
  return items.filter((item) => nowMs - item.queuedAt < QUEUED_HIDES_CARD_MS);
}

/**
 * A queued rating that will claim a place under the daily new-card cap once
 * it lands: a first rating (no review row yet), on the recognition side.
 */
export function claimsNewCard(item: Pick<QueuedRating, "currentReview" | "direction">): boolean {
  return item.currentReview == null && (item.direction ?? "recognition") === "recognition";
}

/**
 * The cards with no rating still queued for the schedule they are served on.
 *
 * A card whose rating has not reached the server is not due, whatever the
 * server says: it still holds the schedule from before the rating. The
 * curriculum deck's due list (`useDueWords`) drops these, reading the queue
 * before and after its fetch, so a refetch never serves a card just rated,
 * however slow or absent the connection.
 *
 * Keyed on the word and the schedule, since recognition and production are
 * separate schedules for the same word. An entry with no direction predates
 * directions and is a recognition rating, as the flush reads it.
 */
export function withoutQueued<T>(
  cards: readonly T[],
  queued: readonly Pick<QueuedRating, "wordId" | "direction">[],
  keyOf: (card: T) => { wordId: string; direction: ScheduleDirection },
): T[] {
  if (queued.length === 0) return [...cards];
  const key = (wordId: string, direction: ScheduleDirection) => `${wordId}|${direction}`;
  const pending = new Set(queued.map((item) => key(item.wordId, item.direction ?? "recognition")));
  return cards.filter((card) => {
    const { wordId, direction } = keyOf(card);
    return !pending.has(key(wordId, direction));
  });
}
