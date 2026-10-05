import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { STREAK_KEY, subscribeCelebrations, type CelebrationEvent } from "@/lib/celebrations";
import { localDateKey } from "@/lib/localDate";
import { useStreakMilestoneCelebration } from "./useStreakMilestoneCelebration";

/**
 * The streak celebration.
 *
 * `review_streaks` is written server-side and read by the client only for
 * display, so nothing else notices the morning a learner's run reaches 7 or
 * 30 days. This hook is that noticing — and its whole risk is noticing too
 * often: the row still reads 7 the day after it got there, and a celebration
 * that comes back every visit is a nag, not a reward.
 */

let cleanup: (() => void) | undefined;
let events: CelebrationEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  events = [];
  unsubscribe = subscribeCelebrations((event) => events.push(event));
});

afterEach(() => {
  unsubscribe();
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

const aStreakRow = (current: number) => ({
  id: "22222222-0000-4000-8000-000000000001",
  user_id: TEST_USER_ID,
  current_streak: current,
  longest_streak: current,
  last_review_date: localDateKey(),
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

async function render(current: number | null, persona: "free" | "anonymous" = "free") {
  const harness = renderHookWithProviders(() => useStreakMilestoneCelebration(), {
    persona,
    seed: (backend) => backend.db.seed("review_streaks", current === null ? [] : [aStreakRow(current)]),
  });
  cleanup = () => {
    harness.unmount();
    harness.cleanup();
  };
  await act(async () => {});
  return harness;
}

describe("useStreakMilestoneCelebration", () => {
  it("celebrates a streak that lands on a milestone", async () => {
    await render(7);
    await waitFor(() => expect(events).toEqual([{ kind: "streak", detail: 7 }]));
  });

  it("stays quiet between milestones", async () => {
    await render(8);
    // Give the query time to land before asserting nothing happened.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(events).toEqual([]);
  });

  it("does not celebrate the same milestone twice on this device", async () => {
    window.localStorage.setItem(
      STREAK_KEY,
      JSON.stringify({ [TEST_USER_ID]: { streak: 7, date: localDateKey() } }),
    );
    await render(7);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(events).toEqual([]);
  });

  it("does nothing for a learner with no streak row", async () => {
    await render(null);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(events).toEqual([]);
  });

  it("does nothing for a signed-out visitor", async () => {
    await render(7, "anonymous");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(events).toEqual([]);
  });
});
