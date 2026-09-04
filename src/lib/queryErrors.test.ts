import { describe, expect, it } from "vitest";
import { classifyQueryError, describeQueryError, httpStatusOf, shouldRetryQuery } from "./queryErrors";

/**
 * The retry policy is the part that changes traffic: a 401 must never be
 * re-asked (the crawl saw phrase-of-the-day retried four times per visit),
 * and a network failure must get exactly one more try, not the default two.
 */

class FunctionsHttpErrorLike extends Error {
  context: { status: number };
  constructor(status: number) {
    super("Edge Function returned a non-2xx status code");
    this.context = { status };
  }
}

describe("classifyQueryError", () => {
  it("reads the status off a functions error", () => {
    expect(classifyQueryError(new FunctionsHttpErrorLike(401))).toBe("auth");
    expect(classifyQueryError(new FunctionsHttpErrorLike(403))).toBe("auth");
    expect(classifyQueryError(new FunctionsHttpErrorLike(429))).toBe("client");
    expect(classifyQueryError(new FunctionsHttpErrorLike(500))).toBe("server");
    expect(httpStatusOf(new FunctionsHttpErrorLike(502))).toBe(502);
  });

  it("reads PostgREST codes, which carry no status", () => {
    expect(classifyQueryError({ code: "42501", message: "permission denied for table x" })).toBe("auth");
    expect(classifyQueryError({ code: "PGRST301", message: "JWT expired" })).toBe("auth");
    expect(classifyQueryError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe("server");
    expect(httpStatusOf({ code: "42501" })).toBeNull();
  });

  it("treats a fetch that never got an answer as a network problem", () => {
    expect(classifyQueryError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyQueryError(new Error("NetworkError when attempting to fetch resource."))).toBe("network");
    expect(classifyQueryError(new Error("net::ERR_CONNECTION_RESET"))).toBe("network");
  });

  it("falls back to server for anything it cannot place", () => {
    expect(classifyQueryError(new Error("boom"))).toBe("server");
    expect(classifyQueryError(undefined)).toBe("server");
    expect(classifyQueryError("string")).toBe("server");
  });

  it("does not mistake an HTML-for-JSON parse error for an auth problem", () => {
    // The ErrorBoundary learned this the hard way; keep the same rule here.
    expect(classifyQueryError(new SyntaxError("Unexpected token < in JSON at position 0"))).toBe("server");
  });
});

describe("shouldRetryQuery", () => {
  it("retries a network or server failure exactly once", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldRetryQuery(0, new FunctionsHttpErrorLike(503))).toBe(true);
    expect(shouldRetryQuery(1, new FunctionsHttpErrorLike(503))).toBe(false);
  });

  it("never retries a 4xx", () => {
    expect(shouldRetryQuery(0, new FunctionsHttpErrorLike(401))).toBe(false);
    expect(shouldRetryQuery(0, new FunctionsHttpErrorLike(404))).toBe(false);
    expect(shouldRetryQuery(0, new FunctionsHttpErrorLike(429))).toBe(false);
    expect(shouldRetryQuery(0, { code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("describeQueryError", () => {
  it("pairs each kind with copy and an action label", () => {
    expect(describeQueryError(new TypeError("Failed to fetch"))).toMatchObject({
      kind: "network",
      title: "Connection problem",
      action: "Try again",
    });
    expect(describeQueryError(new FunctionsHttpErrorLike(401))).toMatchObject({ kind: "auth", action: "Sign in" });
    expect(describeQueryError(new FunctionsHttpErrorLike(500)).title).toBe("Something went wrong");
  });
});
