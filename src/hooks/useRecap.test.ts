import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { recapClock, type RecapSummary } from "@/lib/recap";
import { RecapPlanError, useCompleteRecap, useRecapPlan, useRecapSummary } from "./useRecap";

/**
 * The recap's data hooks. What matters: every request tells the server what
 * the learner's clock reads, the summary is asked for once a day and only for
 * a signed-in learner, a refusal keeps the function's own error key for the
 * page to pick its message, and finishing a session marks the cached summary
 * done so the strip and the Today queue agree with the page at once.
 */

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const SUMMARY: RecapSummary = {
  date: recapClock().localDate,
  windowDays: 1,
  hasContent: true,
  counts: { videos: 1, words: 2, lookups: 0, slips: 0, lessons: 0, stories: 0, chats: 0 },
  headline: "Yesterday: 1 video, 2 new words",
  firstVideo: "A tired friend",
  status: "ready",
};

function render<T>(hook: () => T, persona: "free" | "standard" | "anonymous", seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona, seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("useRecapSummary", () => {
  it("asks for the day's summary with the learner's clock and dialect", async () => {
    const { result, backend } = render(() => useRecapSummary(), "free", (b) => b.stubFunction("daily-recap", SUMMARY));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.headline).toBe(SUMMARY.headline);
    const clock = recapClock();
    expect(backend.lastCallTo("daily-recap")?.body).toEqual({ action: "summary", dialect: "Gulf", ...clock });
  });

  it("asks nothing for a visitor, or when told to stay off", async () => {
    const visitor = render(() => useRecapSummary(), "anonymous");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(visitor.backend.callsTo("daily-recap")).toHaveLength(0);
    visitor.cleanup();

    const off = render(() => useRecapSummary({ enabled: false }), "free");
    cleanup = off.cleanup;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(off.backend.callsTo("daily-recap")).toHaveLength(0);
  });
});

describe("useRecapPlan", () => {
  it("asks for the session and keeps the function's own error key on refusal", async () => {
    const { result } = render(
      () => useRecapPlan(),
      "standard",
      (b) => b.stubFunctionFailure("daily-recap", 422, { error: "nothing_to_recap", message: "Nothing to go over yet." }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as RecapPlanError;
    expect(error).toBeInstanceOf(RecapPlanError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("nothing_to_recap");
    expect(error.message).toBe("Nothing to go over yet.");
  });

  it("waits until it is enabled", () => {
    const { result, backend } = render(() => useRecapPlan(false), "standard");
    expect(result.current.isLoading).toBe(false);
    expect(backend.callsTo("daily-recap")).toHaveLength(0);
  });
});

describe("useCompleteRecap", () => {
  it("records the outcome and marks the cached summary done straight away", async () => {
    const { result, backend } = render(
      () => ({ summary: useRecapSummary(), complete: useCompleteRecap() }),
      "standard",
      (b) =>
        b.stubFunction("daily-recap", ({ body }) => {
          const action = (body as { action: string }).action;
          return action === "summary" ? { status: 200, body: SUMMARY } : { status: 200, body: { stored: true } };
        }),
    );
    await waitFor(() => expect(result.current.summary.data?.status).toBe("ready"));

    await act(async () => {
      await result.current.complete.mutateAsync({ quiz: [], shadow: [], stepsDone: ["yesterday", "recap"] });
    });

    // The cache was written in onMutate; the observer hears about it on the
    // notify manager's next tick, which is what the strip and the queue read.
    await waitFor(() => expect(result.current.summary.data?.status).toBe("completed"));
    const sent = backend.lastCallTo("daily-recap")?.body as Record<string, unknown>;
    expect(sent.action).toBe("complete");
    expect(sent.outcome).toEqual({ quiz: [], shadow: [], stepsDone: ["yesterday", "recap"] });
    expect(sent.localDate).toBe(recapClock().localDate);
  });
});
