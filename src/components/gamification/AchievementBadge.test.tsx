import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Achievement } from "@/hooks/useGamification";
import { AchievementBadge } from "./AchievementBadge";

/**
 * One achievement, earned or not.
 *
 * The grid shows every achievement in the app, including the ones a learner has
 * not reached — that is the point, since an invisible goal motivates nobody. So
 * the same badge has to read clearly in both states, and the unearned one is
 * dimmed and desaturated rather than hidden or replaced by a silhouette.
 */

const anAchievement = (over: Partial<Achievement> = {}): Achievement => ({
  id: "a1",
  name: "First steps",
  name_arabic: "الخطوات الأولى",
  description: "Complete your first review session.",
  icon: "🌱",
  xp_reward: 50,
  requirement_type: "reviews",
  requirement_value: 1,
  ...over,
});

describe("AchievementBadge — what it always shows", () => {
  it("shows the icon", () => {
    render(<AchievementBadge achievement={anAchievement({ icon: "🔥" })} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("names the achievement", () => {
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.getByText("First steps")).toBeInTheDocument();
  });

  it("says what earns it", () => {
    // Shown for unearned badges too — a goal nobody can read is not a goal.
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.getByText("Complete your first review session.")).toBeInTheDocument();
  });
});

describe("AchievementBadge — earned and unearned", () => {
  it("dims an achievement not yet reached", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".grayscale")).toBeInTheDocument();
    expect(container.querySelector(".opacity-40")).toBeInTheDocument();
  });

  it("shows an earned one at full strength", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".grayscale")).toBeNull();
  });

  it("gives an earned one a gold rim", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".border-amber-400")).toBeInTheDocument();
  });

  it("leaves an unearned one a plain rim", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".border-amber-400")).toBeNull();
    expect(container.querySelector(".border-muted")).toBeInTheDocument();
  });

  it("shows the XP once it has been earned", () => {
    render(
      <AchievementBadge achievement={anAchievement()} earned earnedAt="2026-03-01T10:00:00Z" />,
    );
    expect(screen.getByText("+50 XP")).toBeInTheDocument();
  });

  it("does not promise XP for one not yet earned", () => {
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.queryByText("+50 XP")).not.toBeInTheDocument();
  });
});

describe("AchievementBadge — sizes", () => {
  it.each([
    ["sm", "w-12 h-12"],
    ["md", "w-16 h-16"],
    ["lg", "w-20 h-20"],
  ] as const)("sizes the medallion for %s", (size, expected) => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} size={size} />);
    expect(container.querySelector(`.${expected.split(" ").join(".")}`)).toBeInTheDocument();
  });

  it("defaults to the medium size", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".w-16")).toBeInTheDocument();
  });

  it("drops the description at the smallest size", () => {
    // The small badge is used in dense rows where the name alone has to carry.
    render(<AchievementBadge achievement={anAchievement()} size="sm" />);
    expect(screen.getByText("First steps")).toBeInTheDocument();
    expect(screen.queryByText("Complete your first review session.")).not.toBeInTheDocument();
  });

  it("drops every label when asked for the icon alone", () => {
    render(<AchievementBadge achievement={anAchievement()} showDetails={false} />);
    expect(screen.getByText("🌱")).toBeInTheDocument();
    expect(screen.queryByText("First steps")).not.toBeInTheDocument();
  });
});

/**
 * FINDING — `earnedAt` is a date that is never shown, used as a flag.
 *
 * The prop is typed and named as a timestamp, and the only thing the component
 * does with it is gate the XP line: `earned && earnedAt`. The date itself never
 * reaches the screen, so "when did I earn this?" is unanswerable from the grid.
 *
 * The gate also has a hole. `user_achievements.earned_at` is nullable, and a
 * row inserted without one — which is what a backfill or a manual grant
 * produces — is `earned` with no `earnedAt`, so the badge shows gold and full
 * colour but silently drops the XP line, making an earned achievement look
 * worth nothing.
 */
describe("AchievementBadge — the earnedAt gap", () => {
  it("never shows the date it was earned", () => {
    render(
      <AchievementBadge achievement={anAchievement()} earned earnedAt="2026-03-01T10:00:00Z" />,
    );
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mar/)).not.toBeInTheDocument();
  });

  it("hides the XP of an achievement earned without a timestamp", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".border-amber-400")).toBeInTheDocument();
    expect(screen.queryByText("+50 XP")).not.toBeInTheDocument();
  });
});
