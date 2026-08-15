import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import type { LiveStatus } from "@/hooks/useOpenAIRealtime";
import type { PageAiContext } from "@/lib/pageAiContext";
import { VoiceTab } from "./VoiceTab";

/**
 * Voice mode of the Ask AI assistant. Three things are load-bearing: the
 * subscription gate (the server enforces it, but the UI must not dangle a
 * button that will 403), the context handed to `start` (the whole point of
 * this mode is that the tutor knows what's on screen), and teardown — an
 * unmounted tab must never leave a live, billing call running.
 *
 * The realtime plumbing is `useOpenAIRealtime`'s job and has its own tests.
 */

interface Turn {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
}

const live = vi.hoisted(() => ({
  status: "idle" as LiveStatus,
  error: null as string | null,
  turns: [] as Turn[],
  muted: false,
  remainingSeconds: null as number | null,
  setMuted: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  updateContext: vi.fn((_note: string) => true),
}));

vi.mock("@/hooks/useOpenAIRealtime", () => ({
  useOpenAIRealtime: () => ({
    status: live.status,
    error: live.error,
    turns: live.turns,
    muted: live.muted,
    remainingSeconds: live.remainingSeconds,
    setMuted: live.setMuted,
    start: live.start,
    stop: live.stop,
    updateContext: live.updateContext,
  }),
}));

const subscription = vi.hoisted(() => ({ subscribed: false, loading: false }));

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscribed: subscription.subscribed,
    tier: subscription.subscribed ? "standard" : null,
    subscriptionEnd: null,
    loading: subscription.loading,
    checkSubscription: vi.fn(),
  }),
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  live.status = "idle";
  live.error = null;
  live.turns = [];
  live.muted = false;
  live.remainingSeconds = null;
  live.setMuted.mockReset();
  live.start.mockReset();
  live.stop.mockReset();
  live.updateContext.mockReset();
  live.updateContext.mockReturnValue(true);
  subscription.subscribed = false;
  subscription.loading = false;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Stands in for a page that publishes what it's showing. */
function PagePublisher({ ctx }: { ctx: PageAiContext }) {
  usePageAiContext(ctx);
  return null;
}

function render({
  signedIn = true,
  route = "/reading",
  pageContext,
}: { signedIn?: boolean; route?: string; pageContext?: PageAiContext } = {}) {
  localStorage.setItem("hakiya_dialect_module", "Gulf");
  const harness = renderWithProviders(
    <>
      {pageContext && <PagePublisher ctx={pageContext} />}
      <VoiceTab />
    </>,
    {
      persona: signedIn ? "free" : undefined,
      route,
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const videoAt = (lineIndex: number): PageAiContext => ({
  kind: "video",
  title: "Cooking with grandma",
  content: `line ${lineIndex} arabic — line ${lineIndex} english`,
  document: {
    label: "Full transcript of this video",
    lines: Array.from({ length: 20 }, (_, i) => ({
      index: i + 1,
      arabic: `line ${i + 1} arabic`,
      english: `line ${i + 1} english`,
    })),
  },
  position: { index: lineIndex, total: 20, atSeconds: lineIndex * 5 },
});

describe("gating", () => {
  it("asks a signed-out visitor to sign in", async () => {
    render({ signedIn: false });
    expect(await screen.findByText(/Sign in to talk/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start voice call/ })).toBeNull();
  });

  it("shows the upgrade path to a free user instead of a dead button", () => {
    render();
    expect(screen.getByText(/premium feature/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See plans/ })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("button", { name: /Start voice call/ })).toBeNull();
  });
});

describe("the call", () => {
  beforeEach(() => {
    subscription.subscribed = true;
  });

  it("waits for an explicit start and hands over the page context", async () => {
    render({ route: "/reading" });

    // No auto-start: a voice call costs per minute.
    expect(live.start).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start voice call/ }));
    });

    expect(live.start).toHaveBeenCalledTimes(1);
    const args = live.start.mock.calls[0][0];
    expect(args.mode).toBe("assistant");
    expect(args.dialect).toBe("Gulf");
    // Structured, not a pre-rendered string: the server owns the budget, so a
    // page publishing a whole transcript can't inflate the session prompt.
    // The route is unregistered here, so the PAGE_HINTS fallback describes it.
    expect(args.pageContext.title).toContain("Reading Practice");
    expect(args.pageContext.route).toBe("/reading");
  });

  it("hands over the whole transcript, not just the line in focus", async () => {
    render({ route: "/discover/abc", pageContext: videoAt(3) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start voice call/ }));
    });

    const args = live.start.mock.calls[0][0];
    expect(args.pageContext.document.lines).toHaveLength(20);
    expect(args.pageContext.position.index).toBe(3);
  });

  it("tells a call in progress when the learner moves down the transcript", async () => {
    // Without this the tutor is frozen at whatever was on screen when the call
    // connected — two minutes in, it is still answering about line 3.
    //
    // Only the timers are faked: the throttle between updates is four real
    // seconds, and auth/subscription resolution still needs ordinary promises.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      live.status = "live";
      const harness = render({ route: "/discover/abc", pageContext: videoAt(3) });

      // The first update is not throttled — it is scheduled on a zero delay.
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(live.updateContext).toHaveBeenCalled();
      expect(live.updateContext.mock.calls[0][0]).toContain("line 3 of 20");

      live.updateContext.mockClear();
      await act(async () => {
        harness.rerender(
          <>
            <PagePublisher ctx={videoAt(12)} />
            <VoiceTab />
          </>,
        );
      });

      // Throttled, so nothing goes out on the same tick as the change.
      expect(live.updateContext).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });

      expect(live.updateContext).toHaveBeenCalled();
      const note = live.updateContext.mock.calls.at(-1)![0];
      expect(note).toContain("line 12 of 20");
      // The document went out with the session instructions; re-sending it
      // every time a subtitle advances would be thousands of characters per
      // line of video.
      expect(note).not.toContain("line 1 arabic");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends one update for a burst of subtitle changes, not one per line", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      live.status = "live";
      const harness = render({ route: "/discover/abc", pageContext: videoAt(3) });
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      live.updateContext.mockClear();

      // A video advancing a subtitle every couple of seconds.
      for (const i of [4, 5, 6, 7]) {
        await act(async () => {
          harness.rerender(
            <>
              <PagePublisher ctx={videoAt(i)} />
              <VoiceTab />
            </>,
          );
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });

      expect(live.updateContext).toHaveBeenCalledTimes(1);
      // And it's the position the learner actually ended on, not a stale one.
      expect(live.updateContext.mock.calls[0][0]).toContain("line 7 of 20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the call is not live", async () => {
    live.status = "idle";
    render({ route: "/discover/abc", pageContext: videoAt(3) });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(live.updateContext).not.toHaveBeenCalled();
  });

  it("shows the transcript with speaker labels while live", () => {
    live.status = "live";
    live.turns = [
      { role: "user", text: "what does yalla mean?" },
      { role: "assistant", text: "يالله means let's go", partial: false },
    ];
    render();

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
  });

  it("ends the call on demand and on unmount", async () => {
    live.status = "live";
    const harness = render();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /End call/ }));
    });
    expect(live.stop).toHaveBeenCalledTimes(1);

    harness.unmount();
    // Teardown must also fire when the panel closes around us.
    expect(live.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces connection errors instead of a silent dead call", () => {
    live.status = "error";
    live.error = "Voice connection failed";
    render();

    expect(screen.getByText("Voice connection failed")).toBeInTheDocument();
  });

  it("shows the monthly minute balance once the server has reported one", () => {
    live.remainingSeconds = 754; // 12.6 minutes — floor, don't round up
    render();

    // The balance doubles as the upgrade prompt: a learner watching it run
    // down knows why the next tier exists.
    expect(screen.getByText(/12 min left this month/)).toBeInTheDocument();
  });

  it("says nothing about minutes before a call has been attempted", () => {
    live.remainingSeconds = null;
    render();

    expect(screen.queryByText(/min left this month/)).not.toBeInTheDocument();
  });
});
