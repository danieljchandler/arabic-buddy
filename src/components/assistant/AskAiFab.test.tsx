import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { AskAiFab } from "./AskAiFab";

/**
 * The Ask AI button is mounted once at the app root rather than inside
 * AppShell, because a handful of screens render their own layout instead —
 * the Discovery video player, Transcribe, Learn from X — and used to end up
 * with no way to ask about what the learner was looking at.
 *
 * So the thing worth pinning is route coverage: every learning route shows it,
 * and only the deliberate exclusions (auth, onboarding, admin) don't.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const renderAt = (route: string) => {
  const harness = renderWithProviders(<AskAiFab />, { route });
  cleanup = harness.cleanup;
};

const fab = () => screen.queryByRole("button", { name: "Ask AI" });

describe("AskAiFab", () => {
  it.each([
    ["/", "the home screen"],
    ["/discover/abc-123", "a Discovery video"],
    ["/transcribe", "Transcribe"],
    ["/learn-from-x", "Learn from X"],
    ["/set-phrases/review", "set-phrase review"],
    ["/reading", "reading practice"],
  ])("is on %s (%s)", (route) => {
    renderAt(route);
    expect(fab()).toBeInTheDocument();
  });

  it.each([["/auth"], ["/onboarding"], ["/admin/videos"], ["/reset-password"]])(
    "stays out of the way on %s",
    (route) => {
      renderAt(route);
      expect(fab()).not.toBeInTheDocument();
    },
  );
});
