import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeInvokeFailure, GENERIC_INVOKE_FAILURE } from "./invokeError";

/**
 * What a learner reads when an edge call fails.
 *
 * supabase-js reports every non-2xx as "Edge Function returned a non-2xx
 * status code" — dev-speak a dozen pages used to toast verbatim. This module
 * decides, by status, how much of the response body is fit to show; these
 * tests pin that decision, because each wrong branch has a distinct cost: a
 * hidden 4xx message loses real guidance, a shown 5xx body leaks provider
 * internals, and an unhandled 429 misses the one moment worth an upsell.
 */

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

/** A FunctionsHttpError look-alike: message useless, truth in `context`. */
function invokeError(status: number, body: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

beforeEach(() => {
  toastError.mockClear();
});

describe("cap hits", () => {
  it("shows the upgrade toast and tells the caller to stand down", async () => {
    const failure = await describeInvokeFailure(
      invokeError(429, {
        error: "daily_limit_reached",
        message: "You've reached the free daily limit for this feature (10/day).",
        upgrade_url: "/pricing",
      }),
    );

    expect(failure.capped).toBe(true);
    // The toast is async behind a clone().json(); give it a tick.
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/daily free limit/i);
  });
});

describe("what the body may say", () => {
  it("passes a 4xx message through — those are written for humans", async () => {
    const failure = await describeInvokeFailure(
      invokeError(400, { error: "Please record for at least a second." }),
    );
    expect(failure).toEqual({ capped: false, message: "Please record for at least a second." });
  });

  it("prefers message over error when both are present", async () => {
    const failure = await describeInvokeFailure(
      invokeError(403, { error: "subscription_required", message: "This needs a subscription." }),
    );
    expect(failure.message).toBe("This needs a subscription.");
  });

  it("asks a 401 to sign in", async () => {
    const failure = await describeInvokeFailure(invokeError(401, { error: "auth_required" }));
    expect(failure.message).toMatch(/sign in/i);
  });

  it("never shows a 5xx body — that is where provider internals travel", async () => {
    const failure = await describeInvokeFailure(
      invokeError(500, { error: "openrouter anthropic/claude 401: {\"error\":{\"code\":401}}" }),
      undefined,
      "The tutor had a problem. Please try again.",
    );
    expect(failure.message).toBe("The tutor had a problem. Please try again.");
  });

  it("treats a machine key as internals, not a message", async () => {
    // No spaces = an identifier ("scene_index_out_of_range"), not a sentence.
    const failure = await describeInvokeFailure(invokeError(422, { error: "scene_index_out_of_range" }));
    expect(failure.message).toBe(GENERIC_INVOKE_FAILURE);
  });

  it("caps runaway 4xx bodies at the fallback", async () => {
    const failure = await describeInvokeFailure(invokeError(400, { error: "x ".repeat(400) }));
    expect(failure.message).toBe(GENERIC_INVOKE_FAILURE);
  });
});

describe("the throwable form", () => {
  it("carries the learner message and the capped flag", async () => {
    const { toInvokeFailureError, isCappedError } = await import("./invokeError");
    const err = await toInvokeFailureError(
      invokeError(429, { error: "daily_limit_reached", message: "Limit reached." }),
    );
    expect(err.message).toMatch(/limit/i);
    expect(isCappedError(err)).toBe(true);
    // An ordinary Error is not capped — pages toast it as usual.
    expect(isCappedError(new Error("boom"))).toBe(false);
  });
});

describe("no response at all", () => {
  it("says something human when the network itself failed", async () => {
    const failure = await describeInvokeFailure(new TypeError("Failed to fetch"));
    expect(failure).toEqual({ capped: false, message: GENERIC_INVOKE_FAILURE });
  });

  it("uses the caller's fallback when given one", async () => {
    const failure = await describeInvokeFailure(null, null, "Couldn't load the quiz.");
    expect(failure.message).toBe("Couldn't load the quiz.");
  });
});
