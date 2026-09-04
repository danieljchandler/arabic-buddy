import { beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toasts.error(...a) } }));

import { notifyQueryFailure, resetQueryFailureNotice } from "./queryFailureToast";

/**
 * The cache-level notice must be rare enough to be believed: one per window
 * however many queries fail, and never for a 4xx, which is a page's own
 * business to explain.
 */
describe("notifyQueryFailure", () => {
  beforeEach(() => {
    toasts.error.mockClear();
    resetQueryFailureNotice();
  });

  it("shows one toast for a burst of network failures", () => {
    const at = 1_000_000;
    expect(notifyQueryFailure(new TypeError("Failed to fetch"), at)).toBe(true);
    expect(notifyQueryFailure(new TypeError("Failed to fetch"), at + 10)).toBe(false);
    expect(notifyQueryFailure(new TypeError("Failed to fetch"), at + 29_999)).toBe(false);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(String(toasts.error.mock.calls[0][0])).toMatch(/offline|can't be reached/i);
  });

  it("shows again once the window has passed, with the server wording for a 5xx", () => {
    const at = 1_000_000;
    notifyQueryFailure(new TypeError("Failed to fetch"), at);
    const serverError = Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: { status: 503 } });
    expect(notifyQueryFailure(serverError, at + 30_001)).toBe(true);
    expect(toasts.error).toHaveBeenCalledTimes(2);
    expect(String(toasts.error.mock.calls[1][0])).toMatch(/server had a problem/i);
  });

  it("stays silent for auth and client errors", () => {
    const unauthorized = Object.assign(new Error("non-2xx"), { context: { status: 401 } });
    const notFound = Object.assign(new Error("non-2xx"), { context: { status: 404 } });
    expect(notifyQueryFailure(unauthorized)).toBe(false);
    expect(notifyQueryFailure(notFound)).toBe(false);
    expect(notifyQueryFailure({ code: "42501", message: "permission denied" })).toBe(false);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
