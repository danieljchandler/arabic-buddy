import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import {
  aLesson,
  aLessonProgress,
  aVocabularyWord,
  aWordReview,
  daysAgo,
  lessonId,
  reviewId,
  wordId,
} from "@/test/support/factories";
import { all as queuedRatings, enqueue as enqueueRating, remove as removeRating } from "@/lib/reviewQueue";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useDueWords } from "./useReview";

/**
 * The curriculum deck's due list, and the quiz's boss in it.
 *
 * A rating goes into the offline queue (useReviewQueue) and reaches the server
 * later, so until it does the server still holds the card's old schedule and
 * calls it due. The list leaves such a card out, on the schedule the rating is
 * for: a refetch at the end of the list used to serve a card just rated.
 */

let cleanup: (() => void) | undefined;
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function seed(backend: SupabaseBackend) {
  backend.db.seed("vocabulary_words", [
    aVocabularyWord({ id: wordId(0), word_arabic: "سوق", word_english: "the market" }),
    aVocabularyWord({ id: wordId(1), word_arabic: "بيت", word_english: "house" }),
  ]);
  // A review row admits a word to the deck, whatever the scope. Both are due
  // on recognition; the market is due to be said as well.
  backend.db.seed("word_reviews", [
    aWordReview({ id: reviewId(0), word_id: wordId(0), next_review_at: daysAgo(2), production_next_review_at: daysAgo(1), ease_factor: 20 }),
    aWordReview({ id: reviewId(1), word_id: wordId(1), next_review_at: daysAgo(1) }),
  ]);
}

const queue = (word: string, direction: "recognition" | "production") =>
  enqueueRating(TEST_USER_ID, { wordId: word, rating: "good", direction, currentReview: null });

function render(extraSeed?: (backend: SupabaseBackend) => void) {
  const r = renderHookWithProviders(() => useDueWords(false), {
    persona: "free",
    seed: (backend) => {
      seed(backend);
      extraSeed?.(backend);
    },
  });
  cleanup = r.cleanup;
  return r;
}

const cardsOf = (data: Array<{ id: string; card_type: string }> | undefined) =>
  (data ?? []).map((card) => `${card.id === wordId(0) ? "market" : "house"}:${card.card_type === "production" ? "production" : "recognition"}`);

describe("cards whose rating has not reached the server", () => {
  it("are all served while nothing is queued", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(cardsOf(result.current.data).sort()).toEqual(["house:recognition", "market:production", "market:recognition"]);
  });

  it("are left out, on the schedule the rating is for and no other", async () => {
    queue(wordId(0), "recognition");
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());

    // The market's production card is a separate schedule, still due.
    expect(cardsOf(result.current.data).sort()).toEqual(["house:recognition", "market:production"]);
  });

  it("are left out when the rating lands while the fetch is out, and the server answered before it did", async () => {
    // Queued at the start, saved while the fetch waits on the reviews: the
    // read after the fetch no longer sees it, and the server's row is the
    // one from before the rating.
    const item = queue(wordId(1), "recognition");
    const { result, backend } = render((b) => {
      b.db.delay("word_reviews", 300);
    });
    await waitFor(() => expect(backend.db.readsOf("vocabulary_words").length).toBeGreaterThan(0));
    removeRating(TEST_USER_ID, item.id);
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(cardsOf(result.current.data)).not.toContain("house:recognition");
  });

  it("are served again once their rating has waited a day: a queue that cannot drain does not hide them for good", async () => {
    queue(wordId(1), "recognition");
    const key = `hakiya:review-queue:${TEST_USER_ID}`;
    const stale = queuedRatings(TEST_USER_ID).map((entry) => ({ ...entry, queuedAt: Date.now() - 25 * 3_600_000 }));
    localStorage.setItem(key, JSON.stringify(stale));

    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(cardsOf(result.current.data)).toContain("house:recognition");
  });

  it("are left out when the rating was given while the fetch was out", async () => {
    const { result, backend } = render((b) => {
      // Hold the reviews read open, so the rating is queued mid-fetch.
      b.db.delay("word_reviews", 300);
    });
    await waitFor(() => expect(backend.db.readsOf("vocabulary_words").length).toBeGreaterThan(0));
    queue(wordId(1), "recognition");
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(cardsOf(result.current.data)).not.toContain("house:recognition");
  });
});

describe("the new-card cap", () => {
  const LESSON = lessonId(0);

  // Six words never reviewed, in a lesson the learner has opened: new cards.
  function seedNew(backend: SupabaseBackend) {
    backend.db.seed("lessons", [aLesson({ id: LESSON })]);
    backend.db.seed(
      "vocabulary_words",
      Array.from({ length: 6 }, (_, i) =>
        aVocabularyWord({ id: wordId(i), lesson_id: LESSON, word_arabic: `كلمة${i}`, word_english: `new ${i}` }),
      ),
    );
    backend.db.seed("word_reviews", []);
    backend.db.seed("lesson_progress", [aLessonProgress({ user_id: TEST_USER_ID, lesson_id: LESSON })]);
  }

  it("counts a first rating still queued against today's new cards", async () => {
    localStorage.setItem("mywords.newCap", "5");
    // Rated once already, not yet saved, so not yet on the server's count.
    enqueueRating(TEST_USER_ID, { wordId: wordId(0), rating: "good", direction: "recognition", currentReview: null });

    const r = renderHookWithProviders(() => useDueWords(false), { persona: "free", seed: seedNew });
    cleanup = r.cleanup;
    await waitFor(() => expect(r.result.current.data).toBeDefined());

    const served = r.result.current.data!.map((card) => card.word_english);
    // Five a day: the queued one, and four more. It is not served again.
    expect(served).not.toContain("new 0");
    expect(served).toHaveLength(4);
  });
});

/**
 * With `bossFirst` (quiz Phase 7), the recognition leech with the most lapses,
 * counted on both schedules, opens the session. It is chosen from what is due
 * and only moved: nothing is added to the deck or dropped from it.
 */
describe("the boss", () => {
  function seedLeeches(backend: SupabaseBackend) {
    backend.db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), word_arabic: "سوق", word_english: "most overdue" }),
      aVocabularyWord({ id: wordId(1), word_arabic: "بيت", word_english: "a leech" }),
      aVocabularyWord({ id: wordId(2), word_arabic: "مدرسة", word_english: "the worst leech" }),
      aVocabularyWord({ id: wordId(3), word_arabic: "سيارة", word_english: "a quiet word" }),
    ]);
    backend.db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), word_id: wordId(0), next_review_at: daysAgo(7) }),
      aWordReview({ id: reviewId(1), word_id: wordId(1), is_leech: true, lapses: 5 }),
      // Fewer misses than the other leech on recognition, more on both
      // schedules together: "the most lapses" is the word's, not one side's.
      aWordReview({ id: reviewId(2), word_id: wordId(2), is_leech: true, lapses: 2, production_lapses: 4 }),
      aWordReview({ id: reviewId(3), word_id: wordId(3), next_review_at: daysAgo(2) }),
    ]);
  }

  async function deck(bossFirst: boolean) {
    const r = renderHookWithProviders(() => useDueWords(false, { bossFirst }), { persona: "free", seed: seedLeeches });
    cleanup = r.cleanup;
    await waitFor(() => expect(r.result.current.data).toBeDefined());
    const order = r.result.current.data!.map((card) => card.word_english);
    r.cleanup();
    cleanup = undefined;
    return order;
  }

  it("is not first without it: the most overdue card is", async () => {
    const order = await deck(false);
    expect(order[0]).toBe("most overdue");
    expect(order).toHaveLength(4);
  });

  it("opens the deck with it: the leech with the most lapses on both schedules, the rest in their order", async () => {
    const plain = await deck(false);
    const withBoss = await deck(true);

    expect(withBoss).toEqual(["the worst leech", ...plain.filter((w) => w !== "the worst leech")]);
  });
});
