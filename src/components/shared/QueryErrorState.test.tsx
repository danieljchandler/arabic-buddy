import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { QueryErrorState } from "./QueryErrorState";

/**
 * The one thing this component must never do is look like an empty state:
 * a failed fetch has to read as a failure, with a way to try again.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("QueryErrorState", () => {
  it("names a network failure and retries through the caller", () => {
    const onRetry = vi.fn();
    ({ cleanup } = renderWithProviders(<QueryErrorState error={new TypeError("Failed to fetch")} onRetry={onRetry} />));

    expect(screen.getByRole("alert")).toHaveTextContent(/connection problem/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names a server failure and lets the title be overridden", () => {
    const error = Object.assign(new Error("non-2xx"), { context: { status: 503 } });
    ({ cleanup } = renderWithProviders(<QueryErrorState error={error} title="Couldn't load videos" onRetry={() => {}} />));

    expect(screen.getByRole("heading", { name: "Couldn't load videos" })).toBeInTheDocument();
    expect(screen.getByText(/server had a problem/i)).toBeInTheDocument();
  });

  it("offers sign-in, not retry, when the session is the problem", () => {
    const onRetry = vi.fn();
    const error = Object.assign(new Error("non-2xx"), { context: { status: 401 } });
    ({ cleanup } = renderWithProviders(<QueryErrorState error={error} onRetry={onRetry} />, { route: "/discover" }));

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
