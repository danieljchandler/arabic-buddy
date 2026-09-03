import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aPlacementResult, aReviewLog, many } from "@/test/support/factories";
import { cefrOrdinal, REPLACEMENT_AFTER_DAYS, REPLACEMENT_AFTER_REVIEWS, usePlacementHistory } from "./usePlacementHistory";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * A re-check is offered only when both clocks have moved: the placement is
 * old enough AND enough reviews have happened since. Either alone measures
 * the wrong thing.
 */

let cleanup: (() => void) | undefined;
const NOW = new Date("2026-09-02T12:00:00Z");
const daysBefore = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); });

function render(seed: (b: SupabaseBackend) => void) {
  const r = renderHookWithProviders(() => usePlacementHistory(NOW), { persona: "free", seed });
  cleanup = r.cleanup;
  return r;
}

const reviewsAfter = (n: number, iso: string) =>
  many(aReviewLog, n, (i) => ({ id: 5000 + i, reviewed_at: new Date(Date.parse(iso) + (i + 1) * 3_600_000).toISOString() }));

describe("usePlacementHistory", () => {
  it("orders placements oldest first and exposes the latest", async () => {
    const { result } = render((b) => b.db.seed("placement_results", [
      aPlacementResult({ id: "beef0000-0000-4000-8000-000000000002", cefr_level: "B1", taken_at: daysBefore(10) }),
      aPlacementResult({ cefr_level: "A2", taken_at: daysBefore(100) }),
    ]));
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.history.map((p) => p.cefr_level)).toEqual(["A2", "B1"]);
    expect(result.current.latest?.cefr_level).toBe("B1");
  });

  it("ignores another dialect's placements", async () => {
    const { result } = render((b) => b.db.seed("placement_results", [aPlacementResult({ dialect: "Egyptian" })]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.latest).toBeNull();
    expect(result.current.replacementDue).toBe(false);
  });

  it("asks for a re-check only when the placement is old AND practice has happened since", async () => {
    const old = daysBefore(REPLACEMENT_AFTER_DAYS + 5);
    const dueCase = render((b) => {
      b.db.seed("placement_results", [aPlacementResult({ taken_at: old })]);
      b.db.seed("review_log", reviewsAfter(REPLACEMENT_AFTER_REVIEWS, old));
    });
    await waitFor(() => expect(dueCase.result.current.reviewsSinceLatest).toBe(REPLACEMENT_AFTER_REVIEWS));
    expect(dueCase.result.current.replacementDue).toBe(true);
    dueCase.cleanup();

    const oldButIdle = render((b) => {
      b.db.seed("placement_results", [aPlacementResult({ taken_at: old })]);
      b.db.seed("review_log", reviewsAfter(20, old));
    });
    await waitFor(() => expect(oldButIdle.result.current.reviewsSinceLatest).toBe(20));
    expect(oldButIdle.result.current.replacementDue).toBe(false);
    oldButIdle.cleanup();

    const recent = daysBefore(10);
    const busyButRecent = render((b) => {
      b.db.seed("placement_results", [aPlacementResult({ taken_at: recent })]);
      b.db.seed("review_log", reviewsAfter(REPLACEMENT_AFTER_REVIEWS, recent));
    });
    await waitFor(() => expect(busyButRecent.result.current.reviewsSinceLatest).toBe(REPLACEMENT_AFTER_REVIEWS));
    expect(busyButRecent.result.current.replacementDue).toBe(false);
  });

  it("keeps C-test results apart from placements, and never treats one as the latest level", async () => {
    const { result } = render((b) => b.db.seed("placement_results", [
      aPlacementResult({ cefr_level: "A2", taken_at: daysBefore(100) }),
      aPlacementResult({ id: "beef0000-0000-4000-8000-000000000003", instrument: "c_test", cefr_level: null, score: 62, taken_at: daysBefore(5) }),
    ]));
    await waitFor(() => expect(result.current.cTests).toHaveLength(1));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.latest?.cefr_level).toBe("A2");
    expect(result.current.cTests[0].score).toBe(62);
  });

  it("orders CEFR levels for charting", () => {
    expect(cefrOrdinal("A1")).toBe(0);
    expect(cefrOrdinal("B2")).toBe(3);
    expect(cefrOrdinal("nonsense")).toBe(0);
  });
});
