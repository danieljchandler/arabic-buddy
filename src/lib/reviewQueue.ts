import type { Rating } from "@/lib/spacedRepetition";

export interface QueuedReviewSnapshot {
  id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string;
}

export interface QueuedRating {
  id: string;
  userId: string;
  wordId: string;
  rating: Rating;
  currentReview: QueuedReviewSnapshot | null;
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
