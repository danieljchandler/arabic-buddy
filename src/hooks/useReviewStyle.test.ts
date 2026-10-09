import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useReviewStyle } from "./useReviewStyle";

/**
 * "How you review", kept in step between the device and the profile.
 *
 * Two things have to hold. A learner who never chose anything keeps the
 * flashcards they know, whatever the profile read does — signed out, failed,
 * or a profile with nothing set. And a choice made on one device reaches the
 * next one: the profile is the source of truth when it has an answer, and a
 * change here is written to it, with a failed write (the column not yet
 * applied to the live project) leaving the device's own answer in place.
 */

const KEY = "hakiya:review-style";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(seed: (backend: SupabaseBackend) => void, persona: "free" | "anonymous" = "free") {
  const rendered = renderHookWithProviders(() => useReviewStyle(), { persona, seed });
  cleanup = rendered.cleanup;
  return rendered;
}

describe("the starting point", () => {
  it("is flashcards for a learner who has never chosen, on the very first render", async () => {
    const seen: string[] = [];
    const rendered = renderHookWithProviders(
      () => {
        const { style } = useReviewStyle();
        seen.push(style);
        return style;
      },
      { persona: "free", seed: (b) => b.db.seed("profiles", [aProfile({ review_style: null })]) },
    );
    cleanup = rendered.cleanup;

    expect(seen[0]).toBe("flashcards");
    await waitFor(() => expect(rendered.result.current).toBe("flashcards"));
  });

  it("takes the profile's answer over the device's silence", async () => {
    const { result } = render((b) => b.db.seed("profiles", [aProfile({ review_style: "quiz" })]));

    await waitFor(() => expect(result.current.style).toBe("quiz"));
    // Cached, so the next page in this session knows before the profile loads.
    expect(localStorage.getItem(KEY)).toBe("quiz");
  });

  it("takes the profile's answer over a stale device cache", async () => {
    localStorage.setItem(KEY, "quiz");
    const { result } = render((b) => b.db.seed("profiles", [aProfile({ review_style: "flashcards" })]));

    await waitFor(() => expect(result.current.style).toBe("flashcards"));
  });

  it("keeps the device's answer when the profile has none", async () => {
    localStorage.setItem(KEY, "quiz");
    const { result } = render((b) => b.db.seed("profiles", [aProfile({ review_style: null })]));

    // Let the profile read land; it must not reset the device.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.style).toBe("quiz");
  });

  it("keeps the device's answer when the profile read fails", async () => {
    localStorage.setItem(KEY, "quiz");
    const { result } = render((b) => {
      b.db.seed("profiles", [aProfile({ review_style: "flashcards" })]);
      b.db.failAlways("profiles");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.style).toBe("quiz");
  });

  it("ignores a profile value it does not recognise", async () => {
    const { result } = render((b) => b.db.seed("profiles", [aProfile({ review_style: "games" })]));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.style).toBe("flashcards");
  });

  it("is the device's answer for a signed-out visitor", async () => {
    localStorage.setItem(KEY, "quiz");
    const { result } = render(() => {}, "anonymous");

    expect(result.current.style).toBe("quiz");
  });
});

describe("changing the setting", () => {
  it("applies immediately, caches on the device and writes the profile", async () => {
    const { result, backend } = render((b) => b.db.seed("profiles", [aProfile({ review_style: null })]));
    // Let the session resolve: a write before `useAuth` knows who is signed
    // in has nobody to write for, as on a page that has not finished mounting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    act(() => {
      result.current.setStyle("quiz");
    });

    expect(result.current.style).toBe("quiz");
    expect(localStorage.getItem(KEY)).toBe("quiz");
    await waitFor(() => expect(backend.db.rows("profiles")[0].review_style).toBe("quiz"));
  });

  it("keeps the device's answer when the profile write fails", async () => {
    const { result, backend } = render((b) => b.db.seed("profiles", [aProfile({ review_style: null })]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The column is missing from the live project until the migration is
    // applied there; PostgREST then rejects the write. The device must not
    // flip back to flashcards over it.
    backend.db.failNextWrite("profiles", 400, { code: "PGRST204", message: "column does not exist" });

    act(() => {
      result.current.setStyle("quiz");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.style).toBe("quiz");
    expect(backend.db.rows("profiles")[0].review_style).toBeNull();
  });

  it("reaches a review session already mounted", async () => {
    const settings = render((b) => b.db.seed("profiles", [aProfile({ review_style: null })]));
    const review = renderHookWithProviders(() => useReviewStyle(), { persona: "free" });

    act(() => {
      settings.result.current.setStyle("quiz");
    });

    expect(review.result.current.style).toBe("quiz");
    review.cleanup();
  });

  it("writes nothing while signed out", async () => {
    const { result, backend } = render(() => {}, "anonymous");

    act(() => {
      result.current.setStyle("quiz");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.style).toBe("quiz");
    expect(backend.db.writes.filter((w) => w.table === "profiles")).toHaveLength(0);
  });
});
