import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { AskAiFab } from "./AskAiFab";

/**
 * The Ask AI button is mounted once at the app root rather than inside
 * AppShell, because a handful of screens render their own layout instead —
 * the Discovery video player, Transcribe, Learn from X — and used to end up
 * with no way to ask about what the learner was looking at.
 *
 * So the thing worth pinning is route coverage: every learning route shows it,
 * and only the deliberate exclusions (auth, onboarding, admin) don't. Plus the
 * two behaviours its removal taught us to state out loud: clicking it opens
 * the assistant, and the open panel replaces it rather than sharing the
 * corner with it.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Reports the panel's open state without rendering the panel itself. */
function OpenProbe() {
  const { isOpen } = useAiAssistant();
  return <span data-testid="state">{isOpen ? "open" : "closed"}</span>;
}

const renderAt = (route: string) => {
  const harness = renderWithProviders(
    <>
      <AskAiFab />
      <OpenProbe />
    </>,
    { route },
  );
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

  it("opens the assistant, then gets out of the panel's way", () => {
    renderAt("/reading");
    fireEvent.click(fab()!);
    expect(screen.getByTestId("state").textContent).toBe("open");
    // The open panel is the button, opened — a second copy of the verb
    // floating beside the sheet would be the redundancy that got it removed.
    expect(fab()).not.toBeInTheDocument();
  });
});
