import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { CHEERS, celebrate, scenesFor, type CelebrationEvent } from "@/lib/celebrations";
import { CelebrationHost } from "./CelebrationHost";

/**
 * The app-wide celebration screen.
 *
 * Pages only say *that* something happened (`celebrate({ kind: "lesson" })`);
 * the host decides what the learner sees: a dance from the region of the
 * dialect they are learning, a cheer in that dialect, what they did, and a
 * line about the dance. The rules worth pinning are the ones a learner would
 * feel: the dance matches their dialect, a burst of moments becomes one
 * screen rather than a queue of them, Continue (or Escape, or the space
 * around the card) gets them straight back, and the next celebration brings
 * a different dance.
 */

const originalPlay = HTMLMediaElement.prototype.play;
let cleanup: (() => void) | undefined;

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as HTMLMediaElement["play"];
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  HTMLMediaElement.prototype.play = originalPlay;
});

async function renderHost(options: Parameters<typeof renderWithProviders>[1] = { persona: "anonymous" }) {
  const harness = renderWithProviders(<CelebrationHost />, options);
  // Unmount before the harness clears the query cache and storage, or the
  // cleared cache notifies a host that is still mounted.
  cleanup = () => {
    harness.unmount();
    harness.cleanup();
  };
  // Let the auth session and the streak query settle inside act.
  await act(async () => {});
  return harness;
}

const fire = (event: CelebrationEvent) => act(async () => celebrate(event));
const dialog = () => screen.getByRole("dialog");
const danceName = () => within(dialog()).getByText((_, el) => el?.tagName === "P" && /·/.test(el.textContent ?? "") && !!el.querySelector("[lang=ar]"));

describe("CelebrationHost", () => {
  it("shows nothing until something is celebrated", async () => {
    await renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("celebrates with a dance and a cheer from the learner's dialect", async () => {
    await renderHost();
    await fire({ kind: "lesson", detail: "At the souq" });

    expect(within(dialog()).getByRole("heading", { name: "Lesson complete!" })).toBeInTheDocument();
    expect(within(dialog()).getByText("You finished “At the souq”.")).toBeInTheDocument();

    const gulfCheers = CHEERS.Gulf.map((c) => c.ar);
    const cheer = dialog().querySelector("p[lang=ar]")?.textContent;
    expect(gulfCheers).toContain(cheer);

    const gulfDances = scenesFor("Gulf").map((s) => s.nameEn);
    expect(gulfDances.some((name) => danceName().textContent?.includes(name))).toBe(true);
  });

  it("follows the dialect the learner has switched to", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Egyptian");
    await renderHost();
    await fire({ kind: "goal" });

    const egyptianDances = scenesFor("Egyptian").map((s) => s.nameEn);
    expect(egyptianDances.some((name) => danceName().textContent?.includes(name))).toBe(true);
    expect(CHEERS.Egyptian.map((c) => c.ar)).toContain(dialog().querySelector("p[lang=ar]")?.textContent);
  });

  it("folds a moment that lands mid-celebration into the same screen", async () => {
    await renderHost();
    await fire({ kind: "deck", detail: 12 });
    await fire({ kind: "achievement", detail: "🔥 On Fire · +50 XP" });
    // The same badge reported twice is still one line.
    await fire({ kind: "achievement", detail: "🔥 On Fire · +50 XP" });
    await fire({ kind: "deck", detail: 12 });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog()).getByRole("heading", { name: "All caught up!" })).toBeInTheDocument();
    expect(within(dialog()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Badge earned! 🔥 On Fire · +50 XP",
    ]);
  });

  it("puts the learner on Continue, and Continue closes it", async () => {
    await renderHost();
    await fire({ kind: "goal" });

    const button = within(dialog()).getByRole("button", { name: "Continue" });
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", async () => {
    await renderHost();
    await fire({ kind: "goal" });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a tap in the space around the card, but not on the card", async () => {
    await renderHost();
    await fire({ kind: "goal" });

    fireEvent.click(within(dialog()).getByRole("heading", { name: "Daily goal reached!" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const backdrop = dialog().firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("brings a different dance next time", async () => {
    await renderHost();
    await fire({ kind: "goal" });
    const first = danceName().textContent;
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));

    await fire({ kind: "lesson" });
    expect(danceName().textContent).not.toBe(first);
  });

  it("celebrates a streak that has just reached a milestone", async () => {
    await renderHost({
      persona: "free",
      seed: (backend) =>
        backend.db.seed("review_streaks", [
          {
            id: "11111111-0000-4000-8000-000000000001",
            user_id: TEST_USER_ID,
            current_streak: 7,
            longest_streak: 7,
            last_review_date: "2026-10-03",
            created_at: "2026-09-27T00:00:00Z",
            updated_at: "2026-10-03T00:00:00Z",
          },
        ]),
    });

    await waitFor(() =>
      expect(within(dialog()).getByRole("heading", { name: "7-day streak!" })).toBeInTheDocument(),
    );
  });
});
