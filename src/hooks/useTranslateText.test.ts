import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useTranslateText } from "./useTranslateText";
import { isCappedError } from "@/lib/invokeError";

/**
 * The passage translator's hook.
 *
 * The part worth testing is the failure contract: this hook reports failure by
 * throwing, and the Translate page toasts whatever message comes out — so the
 * message must be the learner-facing one from the response body, never
 * supabase-js's "Edge Function returned a non-2xx status code", and a
 * daily-cap 429 must arrive marked `capped` so the page doesn't stack its own
 * toast on the upgrade toast the helper already showed.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const RESULT = {
  detected_dialect: "Gulf",
  sentences: [{ arabic: "مرحبا", literal: "hello", natural: "Hello" }],
};

describe("translating", () => {
  it("returns the translation and keeps error empty", async () => {
    const harness = renderHookWithProviders(() => useTranslateText(), {
      persona: "free",
      seed: (backend) => backend.stubFunction("translate-text", RESULT),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.translate("مرحبا");
    });

    await waitFor(() => expect(harness.result.current.result).toMatchObject(RESULT));
    expect(harness.result.current.error).toBeNull();
  });

  it("throws the body's message on a 4xx, not supabase-js dev-speak", async () => {
    const harness = renderHookWithProviders(() => useTranslateText(), {
      persona: "free",
      seed: (backend) =>
        backend.stubFunction("translate-text", () => ({
          status: 400,
          body: { error: "Text is too long for the model." },
        })),
    });
    cleanup = harness.cleanup;

    let thrown: unknown;
    await act(async () => {
      await harness.result.current.translate("م".repeat(10)).catch((e) => {
        thrown = e;
      });
    });

    expect((thrown as Error).message).toBe("Text is too long for the model.");
    expect((thrown as Error).message).not.toMatch(/non-2xx/);
    await waitFor(() =>
      expect(harness.result.current.error).toBe("Text is too long for the model."),
    );
  });

  it("marks a daily-cap hit as capped and leaves the error banner empty", async () => {
    const harness = renderHookWithProviders(() => useTranslateText(), {
      persona: "free",
      seed: (backend) => backend.stubFunctionCapped("translate-text"),
    });
    cleanup = harness.cleanup;

    let thrown: unknown;
    await act(async () => {
      await harness.result.current.translate("مرحبا").catch((e) => {
        thrown = e;
      });
    });

    // The upgrade toast is the message; a page that also rendered `error`
    // would tell the learner twice.
    expect(isCappedError(thrown)).toBe(true);
    await waitFor(() => expect(harness.result.current.error).toBeNull());
  });
});
