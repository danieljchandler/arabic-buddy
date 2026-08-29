import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useAuth } from "@/hooks/useAuth";
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
 *
 * Every case here signs in first, because being signed in is now part of the
 * condition — see the signed-out case at the bottom, which is the one this
 * file exists to keep honest. `useAuth` resolves the session on a macrotask,
 * so the disc arrives asynchronously and the assertions await it.
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

/**
 * Reports whether the session has resolved yet.
 *
 * The absence assertions need this. `useAuth` answers on a macrotask, so
 * "the disc is not there" is true for a tick on *every* route, signed in or
 * not — without waiting for sign-in to actually land first, those tests pass
 * whatever the route rule does.
 */
function AuthProbe() {
  const { isAuthenticated, loading } = useAuth();
  return (
    <span data-testid="auth">
      {loading ? "pending" : isAuthenticated ? "in" : "out"}
    </span>
  );
}

const renderAt = (route: string, persona: "free" | "anonymous" = "free") => {
  const harness = renderWithProviders(
    <>
      <AskAiFab />
      <OpenProbe />
      <AuthProbe />
    </>,
    { route, persona },
  );
  cleanup = harness.cleanup;
};

const fab = () => screen.queryByRole("button", { name: "Ask AI" });
const findFab = () => screen.findByRole("button", { name: "Ask AI" });
/** Blocks until the session has settled either way. */
const settled = (as: "in" | "out") =>
  waitFor(() => expect(screen.getByTestId("auth").textContent).toBe(as));

describe("AskAiFab", () => {
  it.each([
    ["/", "the home screen"],
    ["/discover/abc-123", "a Discovery video"],
    ["/transcribe", "Transcribe"],
    ["/learn-from-x", "Learn from X"],
    ["/set-phrases/review", "set-phrase review"],
    ["/reading", "reading practice"],
  ])("is on %s (%s)", async (route) => {
    renderAt(route);
    expect(await findFab()).toBeInTheDocument();
  });

  it.each([["/auth"], ["/onboarding"], ["/admin/videos"], ["/reset-password"]])(
    "stays out of the way on %s",
    async (route) => {
      renderAt(route);
      await settled("in");
      expect(fab()).not.toBeInTheDocument();
    },
  );

  it("opens the assistant, then gets out of the panel's way", async () => {
    renderAt("/reading");
    fireEvent.click(await findFab());
    expect(screen.getByTestId("state").textContent).toBe("open");
    // The open panel is the button, opened — a second copy of the verb
    // floating beside the sheet would be the redundancy that got it removed.
    expect(fab()).not.toBeInTheDocument();
  });

  it("is absent for a visitor who is not signed in", async () => {
    renderAt("/", "anonymous");
    await settled("out");
    // A signed-out visitor sees the landing page. The disc used to float over
    // it offering a tutor that only opens behind a sign-in, next to a dock of
    // tabs they equally could not use.
    expect(fab()).not.toBeInTheDocument();
  });
});
