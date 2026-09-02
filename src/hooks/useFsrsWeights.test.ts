import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile } from "@/test/support/factories";
import { FSRS6_DEFAULT_WEIGHTS } from "@/lib/spacedRepetition";
import { useFsrsWeights } from "./useFsrsWeights";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * A learner's fitted weights reach the scheduler through this hook, so the
 * one thing that must never happen is a bad stored vector scheduling anyone.
 * Unusable rows read as "no fit", not as a patched-up fit.
 */

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

function render(seed: (backend: SupabaseBackend) => void, persona: "free" | "anonymous" = "free") {
  const rendered = renderHookWithProviders(() => useFsrsWeights(), { persona, seed });
  cleanup = rendered.cleanup;
  return rendered;
}

const fitted = [...FSRS6_DEFAULT_WEIGHTS].map((w, i) => (i === 8 ? w + 0.3 : w));

describe("useFsrsWeights", () => {
  it("returns null when the learner has no fit yet", async () => {
    const { result } = render((b) => b.db.seed("profiles", [aProfile({ fsrs_weights: null })]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.weights).toBeNull();
    expect(result.current.reviews).toBeNull();
  });

  it("returns a stored 21-weight vector as given, with its provenance", async () => {
    const { result } = render((b) =>
      b.db.seed("profiles", [aProfile({ fsrs_weights: fitted, fsrs_weights_fitted_at: "2026-09-01T00:00:00Z", fsrs_weights_reviews: 1500 })]),
    );
    await waitFor(() => expect(result.current.weights).not.toBeNull());
    expect(result.current.weights).toEqual(fitted);
    expect(result.current.fittedAt).toBe("2026-09-01T00:00:00Z");
    expect(result.current.reviews).toBe(1500);
  });

  it("treats a wrong-length or corrupt vector as no fit at all", async () => {
    const { result } = render((b) =>
      b.db.seed("profiles", [aProfile({ fsrs_weights: [1, 2, 3], fsrs_weights_reviews: 999 })]),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.weights).toBeNull();
    expect(result.current.reviews).toBeNull();

    const corrupt = [...fitted]; (corrupt as unknown[])[4] = "seven";
    const second = render((b) => b.db.seed("profiles", [aProfile({ fsrs_weights: corrupt })]));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.weights).toBeNull();
    second.cleanup();
  });

  it("is null and not loading for a signed-out learner", async () => {
    const { result } = render(() => {}, "anonymous");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.weights).toBeNull();
  });
});
