import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aWordReview } from "@/test/support/factories";
import { subscribeCelebrations, type CelebrationEvent } from "@/lib/celebrations";
import { useCheckAchievements } from "./useGamification";

/**
 * Earning a badge is the one place the app learns *which* badge was earned, so
 * it is where a badge celebration gets everything it needs: the stage shows the
 * badge's emblem, and the song is asked about it by id. What the celebration is
 * handed has to be the badge itself, and nothing for a badge that was already
 * held or not yet earned.
 */

const BADGE = "5b1e7a52-0d0c-4a55-9a43-9a0c3b2f6e11";
const aBadge = (over: Record<string, unknown> = {}) => ({
  id: BADGE,
  name: "First Review",
  name_arabic: "أول مراجعة",
  description: "Review your first word",
  icon: "🔥",
  xp_reward: 25,
  requirement_type: "reviews_completed",
  requirement_value: 1,
  display_order: 1,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

let cleanup: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  cleanup?.();
  cleanup = undefined;
});

async function check(seed: (backend: { db: { seed: (table: string, rows: unknown[]) => void } }) => void) {
  const events: CelebrationEvent[] = [];
  unsubscribe = subscribeCelebrations((event) => events.push(event));
  const harness = renderHookWithProviders(() => useCheckAchievements(), {
    persona: "free",
    seed: seed as never,
  });
  cleanup = harness.cleanup;
  // The signed-in session resolves a tick after the first render; the hook
  // does nothing without it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  await act(async () => {
    await harness.result.current.mutateAsync();
  });
  return { events, harness };
}

describe("useCheckAchievements", () => {
  it("celebrates a newly earned badge with the badge itself", async () => {
    const { events } = await check((backend) => {
      backend.db.seed("achievements", [aBadge()]);
      backend.db.seed("user_achievements", []);
      backend.db.seed("word_reviews", [aWordReview()]);
    });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("achievement");
    expect(events[0].detail).toBe("🔥 First Review · +25 XP");
    expect(events[0].badge).toEqual({
      id: BADGE,
      name: "First Review",
      nameArabic: "أول مراجعة",
      icon: "🔥",
      xp: 25,
    });
  });

  it("celebrates each of several badges earned together, and a badge each time", async () => {
    const second = "5b1e7a52-0d0c-4a55-9a43-9a0c3b2f6e22";
    const { events } = await check((backend) => {
      backend.db.seed("achievements", [aBadge(), aBadge({ id: second, name: "Word Collector", icon: "📚" })]);
      backend.db.seed("user_achievements", []);
      backend.db.seed("word_reviews", [aWordReview()]);
    });

    expect(events.map((e) => e.badge?.id).sort()).toEqual([BADGE, second].sort());
  });

  it("says nothing for a badge the learner already holds", async () => {
    const { events } = await check((backend) => {
      backend.db.seed("achievements", [aBadge()]);
      backend.db.seed("user_achievements", [
        { user_id: TEST_USER_ID, achievement_id: BADGE, earned_at: "2026-09-01T00:00:00Z" },
      ]);
      backend.db.seed("word_reviews", [aWordReview()]);
    });
    expect(events).toEqual([]);
  });

  it("says nothing for a badge that has not been earned yet", async () => {
    const { events } = await check((backend) => {
      backend.db.seed("achievements", [aBadge({ requirement_value: 100 })]);
      backend.db.seed("user_achievements", []);
      backend.db.seed("word_reviews", [aWordReview()]);
    });
    expect(events).toEqual([]);
  });
});

