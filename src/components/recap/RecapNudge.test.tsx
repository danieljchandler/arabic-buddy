import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useAuth } from "@/hooks/useAuth";
import { isRecapNudgeDismissed, recapClock, type RecapSummary } from "@/lib/recap";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { RecapNudge } from "./RecapNudge";

/**
 * The strip at the bottom of the screen offering the day's recap.
 *
 * Mounted once at the app root, like the Ask AI disc, so the thing worth
 * pinning is where it appears: on the learner's screens once there is
 * something to go over, and not over a video, a review, the sign-in form, the
 * admin console or the recap itself. Plus the two ways it goes away for the
 * day: the learner does the recap, or waves it off.
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
  counts: { videos: 1, words: 4, lookups: 0, slips: 1, lessons: 0, stories: 0, chats: 0 },
  headline: "Yesterday: 1 video, 4 new words, 1 slip",
  firstVideo: "A tired friend",
  status: "ready",
};

/** Reports whether the session has resolved, so an absence can be asserted after sign-in lands. */
function AuthProbe() {
  const { isAuthenticated, loading } = useAuth();
  return <span data-testid="auth">{loading ? "pending" : isAuthenticated ? "in" : "out"}</span>;
}

const renderAt = (route: string, persona: "free" | "anonymous" = "free", summary: RecapSummary = SUMMARY) => {
  const harness = renderWithProviders(
    <>
      <RecapNudge />
      <AuthProbe />
    </>,
    { route, persona, seed: (b: SupabaseBackend) => b.stubFunction("daily-recap", summary) },
  );
  cleanup = harness.cleanup;
  return harness;
};

const strip = () => screen.queryByTestId("recap-nudge");
const settled = (as: "in" | "out") => waitFor(() => expect(screen.getByTestId("auth").textContent).toBe(as));

describe("RecapNudge", () => {
  it.each([
    ["/today", "the daily dashboard"],
    ["/choose", "the skill chooser"],
    ["/my-words", "My Words"],
    ["/settings", "Settings"],
  ])("offers the recap on %s (%s)", async (route) => {
    renderAt(route);
    expect(await screen.findByTestId("recap-nudge")).toBeInTheDocument();
    expect(screen.getByText(SUMMARY.headline)).toBeInTheDocument();
    expect(screen.getByText(/go over "A tired friend"/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /recap/i })).toHaveAttribute("href", "/recap");
  });

  it.each([
    ["/auth", "the sign-in form"],
    ["/admin/videos", "the admin console"],
    ["/discover/abc-123", "a video"],
    ["/review", "a review session"],
    ["/recap", "the recap itself"],
  ])("stays off %s (%s), without even asking", async (route) => {
    const { backend } = renderAt(route);
    await settled("in");
    expect(strip()).not.toBeInTheDocument();
    expect(backend.callsTo("daily-recap")).toHaveLength(0);
  });

  it("is absent for a visitor who is not signed in", async () => {
    const { backend } = renderAt("/today", "anonymous");
    await settled("out");
    expect(strip()).not.toBeInTheDocument();
    expect(backend.callsTo("daily-recap")).toHaveLength(0);
  });

  it("stays off when there is nothing to go over, or the recap is already done", async () => {
    const nothing = renderAt("/today", "free", { ...SUMMARY, hasContent: false });
    await waitFor(() => expect(nothing.backend.callsTo("daily-recap")).toHaveLength(1));
    expect(strip()).not.toBeInTheDocument();
    nothing.cleanup();

    const done = renderAt("/today", "free", { ...SUMMARY, status: "completed" });
    cleanup = done.cleanup;
    await waitFor(() => expect(done.backend.callsTo("daily-recap")).toHaveLength(1));
    expect(strip()).not.toBeInTheDocument();
  });

  it("goes away for the day when waved off", async () => {
    renderAt("/today");
    await screen.findByTestId("recap-nudge");

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(strip()).not.toBeInTheDocument();
    expect(isRecapNudgeDismissed(SUMMARY.date)).toBe(true);
  });

  it("goes away when the Today queue records the recap as done", async () => {
    renderAt("/today");
    await screen.findByTestId("recap-nudge");

    markTaskCompletedToday("recap");

    await waitFor(() => expect(strip()).not.toBeInTheDocument());
  });
});
