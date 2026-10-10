import { act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserPhrase, phraseId, TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useDueUserPhrases, useUpdateUserPhraseReview } from "./useUserPhrases";

/**
 * The saved-phrase deck's due list, and the quiz's boss in it (quiz Phase 7):
 * with `bossFirst`, the leech asked for its meaning with the most lapses
 * opens the session. Nothing is added to the deck or dropped from it, and a
 * phrase settled enough to be said (the production side) is never the boss.
 */

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();

function seed(backend: SupabaseBackend) {
  backend.db.seed("user_phrases", [
    aUserPhrase({ id: phraseId(0), user_id: TEST_USER_ID, dialect: "Gulf", phrase_english: "most overdue", next_review_at: lastWeek, ease_factor: 2 }),
    aUserPhrase({ id: phraseId(1), user_id: TEST_USER_ID, dialect: "Gulf", phrase_english: "a leech", next_review_at: yesterday, ease_factor: 1, is_leech: true, lapses: 6 }),
    aUserPhrase({ id: phraseId(2), user_id: TEST_USER_ID, dialect: "Gulf", phrase_english: "the worst leech", next_review_at: yesterday, ease_factor: 1, is_leech: true, lapses: 9 }),
    // Settled enough to be said: the production side, never the boss.
    aUserPhrase({ id: phraseId(3), user_id: TEST_USER_ID, dialect: "Gulf", phrase_english: "a settled leech", next_review_at: yesterday, ease_factor: 20, is_leech: true, lapses: 12 }),
  ]);
}

function due(bossFirst: boolean) {
  const r = renderHookWithProviders(() => useDueUserPhrases(false, { bossFirst }), { persona: "free", seed });
  cleanup = r.cleanup;
  return r;
}

describe("the due phrases", () => {
  it("come most overdue first", async () => {
    const { result } = due(false);
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.map((p) => p.phrase_english)[0]).toBe("most overdue");
  });

  it("open on the boss in the quiz: the leech asked for its meaning with the most lapses, the rest in order", async () => {
    const { result } = due(true);
    await waitFor(() => expect(result.current.data).toBeDefined());
    const order = result.current.data!.map((p) => p.phrase_english);
    expect(order[0]).toBe("the worst leech");
    expect(order).toHaveLength(4);
    expect(order[1]).toBe("most overdue");
    expect(order.slice(2).sort()).toEqual(["a leech", "a settled leech"]);
  });
});

describe("rating a phrase", () => {
  it("leaves the due list alone, so the session's next card does not shift under it", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const r = renderHookWithProviders(() => useUpdateUserPhraseReview(), { persona: "free", seed });
    cleanup = r.cleanup;

    await act(async () => {
      await r.result.current.mutateAsync({
        phraseId: phraseId(0),
        stability: 3,
        difficulty: 5,
        intervalDays: 3,
        repetitions: 2,
        nextReviewAt: new Date(Date.now() + 3 * 86_400_000),
        rating: "good",
      });
    });

    // The badge's count is refreshed; the list the page is walking is not.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-phrases-due-count"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["user-phrases-due"] });
    invalidate.mockRestore();
  });
});
