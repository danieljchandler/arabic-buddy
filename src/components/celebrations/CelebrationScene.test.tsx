import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARDAH } from "@/lib/celebrations";
import { CelebrationScene } from "./CelebrationScene";
import { DANCE_ART } from "./danceArt";

/**
 * The collage stage for a milestone dance. What matters is that the row
 * actually dances — one still on screen at a time, changing on the beat in
 * the order the dance defines, swaying as one — and that it holds still for
 * reduced motion.
 */

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/uiPrefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiPrefs")>()),
  useReducedMotion: () => reduced.value,
}));

beforeEach(() => {
  reduced.value = false;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The data-pose of the one still showing in a figure, and how many show. */
function showing(container: HTMLElement, figure: "row" | "drummer") {
  const imgs = [...container.querySelectorAll<HTMLImageElement>(`.cel-${figure} img`)];
  const visible = imgs.filter((img) => img.style.visibility === "visible");
  return { count: visible.length, pose: visible[0] ? Number(visible[0].dataset.pose) : null, total: imgs.length };
}

describe("CelebrationScene", () => {
  it("names the dance for screen readers and shows its title, praise and milestone", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} tier="medium" headline="Lesson complete" />);
    expect(screen.getByRole("img", { name: "Al-Ardah, a dance from Najd, Saudi Arabia" })).toBeInTheDocument();
    expect(container.querySelector("svg text")?.textContent).toBe("العرضة");
    expect(screen.getByText("كفو!")).toBeInTheDocument();
    expect(screen.getByText("Lesson complete")).toBeInTheDocument();
    expect(screen.getByText(/Al-Ardah · Najd, Saudi Arabia/)).toBeInTheDocument();
  });

  it("has a still for every pose the dance asks for", () => {
    const art = DANCE_ART[ARDAH.id];
    for (const i of ARDAH.sequence) expect(art.row[i]).toBeTruthy();
    for (const i of ARDAH.drummerSequence) expect(art.drummer[i]).toBeTruthy();
  });

  it("shows one still at a time and changes it on the beat, in order", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} tier="medium" headline="Lesson complete" />);
    const seen: (number | null)[] = [];
    for (let step = 0; step < ARDAH.sequence.length; step++) {
      const now = showing(container, "row");
      expect(now.count).toBe(1);
      seen.push(now.pose);
      act(() => {
        vi.advanceTimersByTime(ARDAH.beatMs);
      });
    }
    expect(seen).toEqual([...ARDAH.sequence]);
  });

  it("lands each swap with a jolt, but not the opening frame", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} tier="medium" headline="Lesson complete" />);
    const still = container.querySelector(".cel-row-still")!;
    expect(still.className).not.toMatch(/cel-pop/);
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs);
    });
    expect(still.className).toMatch(/cel-pop-[ab]/);
  });

  it("brings the drummer to the medium and large scenes, not the small one", () => {
    const medium = render(<CelebrationScene dance={ARDAH} tier="medium" headline="x" />);
    expect(showing(medium.container, "drummer").count).toBe(1);
    medium.unmount();
    const small = render(<CelebrationScene dance={ARDAH} tier="small" headline="x" />);
    expect(showing(small.container, "drummer").total).toBe(0);
  });

  it("changes the drummer's still on every stroke", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} tier="medium" headline="x" />);
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(showing(container, "drummer").pose);
      act(() => {
        vi.advanceTimersByTime(ARDAH.drumMs);
      });
    }
    expect(seen).toEqual([0, 1, 0, 1]);
  });

  it("sways the whole row by the dance's sway settings", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} tier="medium" headline="x" />);
    const row = container.querySelector<HTMLElement>(".cel-row")!;
    expect(row.className).toMatch(/cel-sway/);
    expect(row.style.getPropertyValue("--cel-sway-deg")).toBe(`${ARDAH.swayDeg}deg`);
    expect(row.style.getPropertyValue("--cel-sway-ms")).toBe(`${ARDAH.swayPeriodMs}ms`);
  });

  it("holds the first pose under reduced motion", () => {
    reduced.value = true;
    const { container } = render(<CelebrationScene dance={ARDAH} tier="large" headline="x" />);
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs * 5);
    });
    expect(showing(container, "row").pose).toBe(ARDAH.sequence[0]);
    expect(container.querySelector(".cel-row-still")!.className).not.toMatch(/cel-pop/);
    expect(container.querySelector(".cel-row")!.className).not.toMatch(/cel-sway/);
  });
});
