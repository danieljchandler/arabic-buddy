import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, aReviewLog, TEST_USER_ID } from "@/test/support/factories";
import { MIN_REVIEWS_TO_FIT } from "@/lib/fsrsFit";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The fitting hook's job is plumbing: count the log, hand it to fitFromLog,
 * and write only an adopted result. The decision itself is fsrsFit's and is
 * tested there — here it is stubbed so the write path can be checked both
 * ways without simulating a thousand reviews.
 */

const decision = vi.hoisted(() => ({
  next: { status: "too-few", reviews: 0 } as import("@/lib/fsrsFit").FitResult,
  calls: 0,
}));

vi.mock("@/lib/fsrsFit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fsrsFit")>();
  return {
    ...actual,
    fitFromLog: (rows: unknown[]) => {
      decision.calls += 1;
      return { ...decision.next, reviews: rows.length };
    },
  };
});

import { useFsrsFit } from "./useFsrsFit";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; decision.calls = 0; });

function render(seed: (backend: SupabaseBackend) => void) {
  let backend: SupabaseBackend | undefined;
  const rendered = renderHookWithProviders(() => useFsrsFit(), {
    persona: "free",
    seed: (b) => { backend = b; seed(b); },
  });
  cleanup = rendered.cleanup;
  return { ...rendered, backend: () => backend! };
}

const logRows = (n: number) =>
  Array.from({ length: n }, (_, i) => aReviewLog({ id: 1000 + i, card_id: `44444444-0000-4000-8000-${String(i % 50).padStart(12, "0")}` }));

describe("useFsrsFit", () => {
  it("reports how much history there is and whether that is enough", async () => {
    const { result } = render((b) => {
      b.db.seed("profiles", [aProfile()]);
      b.db.seed("review_log", logRows(12));
    });
    await waitFor(() => expect(result.current.reviewCount).toBe(12));
    expect(result.current.eligible).toBe(false);
    expect(MIN_REVIEWS_TO_FIT).toBeGreaterThan(12);
  });

  it("writes an adopted fit to the profile with its provenance", async () => {
    decision.next = { status: "fitted", reviews: 0, stockLoss: 0.4, fittedLoss: 0.36, improvement: 0.1, weights: new Array(21).fill(0.5) };
    const { result, backend } = render((b) => {
      b.db.seed("profiles", [aProfile({ fsrs_weights: null })]);
      b.db.seed("review_log", logRows(30));
    });
    await waitFor(() => expect(result.current.reviewCount).toBe(30));

    let outcome: unknown;
    await act(async () => { outcome = await result.current.fit(); });

    expect((outcome as { status: string }).status).toBe("fitted");
    expect(decision.calls).toBe(1);
    const profile = backend().db.rows("profiles").find((p) => (p as { user_id: string }).user_id === TEST_USER_ID) as Record<string, unknown>;
    expect(profile.fsrs_weights).toEqual(new Array(21).fill(0.5));
    expect(profile.fsrs_weights_reviews).toBe(30);
    expect(typeof profile.fsrs_weights_fitted_at).toBe("string");
  });

  it("writes nothing when the fit did not beat the defaults", async () => {
    decision.next = { status: "kept-defaults", reviews: 0, stockLoss: 0.4, fittedLoss: 0.4, improvement: 0 };
    const { result, backend } = render((b) => {
      b.db.seed("profiles", [aProfile({ fsrs_weights: null })]);
      b.db.seed("review_log", logRows(5));
    });
    await waitFor(() => expect(result.current.reviewCount).toBe(5));

    await act(async () => { await result.current.fit(); });

    expect(result.current.result?.status).toBe("kept-defaults");
    const profile = backend().db.rows("profiles").find((p) => (p as { user_id: string }).user_id === TEST_USER_ID) as Record<string, unknown>;
    expect(profile.fsrs_weights).toBeNull();
  });
});
