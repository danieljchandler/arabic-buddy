import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARDAH, DANCES } from "@/lib/dances";
import { CelebrationScene } from "./CelebrationScene";
import { DANCE_ART } from "./danceArt";

/**
 * The collage stage for a milestone dance. What matters is that the dancers
 * actually dance — one still on screen at a time, changing on the beat in
 * the order the dance defines, swaying as one — that it holds still for
 * reduced motion, and that a dialect with no dance yet still gets its paper.
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
function showing(container: HTMLElement, figure: "dancers" | "musician") {
  const imgs = [...container.querySelectorAll<HTMLImageElement>(`.cel-${figure} img`)];
  const visible = imgs.filter((img) => img.style.visibility === "visible");
  return { count: visible.length, pose: visible[0] ? Number(visible[0].dataset.pose) : null, total: imgs.length };
}

describe("CelebrationScene", () => {
  it("names the dance for screen readers and shows its title, the cheer and the milestone", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="Lesson complete" />);
    expect(screen.getByRole("img", { name: "Al-Ardah, a dance from Najd, Saudi Arabia" })).toBeInTheDocument();
    expect(container.querySelector("svg text")?.textContent).toBe("العرضة");
    expect(screen.getByText("كفو!")).toBeInTheDocument();
    expect(screen.getByText("Lesson complete")).toBeInTheDocument();
    expect(screen.getByText(/Al-Ardah · Najd, Saudi Arabia/)).toBeInTheDocument();
  });

  it("has a still for every pose every dance asks for, and none it never shows", () => {
    for (const dance of DANCES) {
      const art = DANCE_ART[dance.id];
      expect(art, dance.id).toBeDefined();
      expect(new Set(dance.sequence).size, dance.id).toBe(art.dancers.length);
      for (const i of dance.sequence) expect(art.dancers[i], `${dance.id} pose ${i}`).toBeTruthy();
      expect(new Set(dance.musicianSequence).size, dance.id).toBe(art.musician.length);
      for (const i of dance.musicianSequence) expect(art.musician[i], `${dance.id} musician ${i}`).toBeTruthy();
    }
  });

  it("has a music loop for every dance", () => {
    for (const dance of DANCES) expect(DANCE_ART[dance.id].music, dance.id).toMatch(/music\.mp3$/);
  });

  it("shows one still at a time and changes it on the beat, in order", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="Lesson complete" />);
    const seen: (number | null)[] = [];
    for (let step = 0; step < ARDAH.sequence.length; step++) {
      const now = showing(container, "dancers");
      expect(now.count).toBe(1);
      seen.push(now.pose);
      act(() => {
        vi.advanceTimersByTime(ARDAH.beatMs);
      });
    }
    expect(seen).toEqual([...ARDAH.sequence]);
  });

  it("lands each swap with a jolt, but not the opening frame", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="Lesson complete" />);
    const still = container.querySelector(".cel-dancers-still")!;
    expect(still.className).not.toMatch(/cel-pop/);
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs);
    });
    expect(still.className).toMatch(/cel-pop-[ab]/);
  });

  it("brings the musician to the medium and large scenes, not the small one", () => {
    const medium = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />);
    expect(showing(medium.container, "musician").count).toBe(1);
    medium.unmount();
    const small = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="small" cheer="كفو!" headline="x" />);
    expect(showing(small.container, "musician").total).toBe(0);
  });

  it("changes the musician's still on every stroke", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />);
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(showing(container, "musician").pose);
      act(() => {
        vi.advanceTimersByTime(ARDAH.musicianMs);
      });
    }
    expect(seen).toEqual([0, 1, 0, 1]);
  });

  it("sways the dancers together by the dance's sway settings", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />);
    const row = container.querySelector<HTMLElement>(".cel-dancers")!;
    expect(row.className).toMatch(/cel-sway/);
    expect(row.style.getPropertyValue("--cel-sway-deg")).toBe(`${ARDAH.swayDeg}deg`);
    expect(row.style.getPropertyValue("--cel-sway-ms")).toBe(`${ARDAH.swayPeriodMs}ms`);
  });

  it("holds the first pose under reduced motion", () => {
    reduced.value = true;
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="large" cheer="كفو!" headline="x" />);
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs * 5);
    });
    expect(showing(container, "dancers").pose).toBe(ARDAH.sequence[0]);
    expect(container.querySelector(".cel-dancers-still")!.className).not.toMatch(/cel-pop/);
    expect(container.querySelector(".cel-dancers")!.className).not.toMatch(/cel-sway/);
  });

  it("holds the first pose until its music has started, then dances from the top", () => {
    const { container, rerender } = render(
      <CelebrationScene dance={ARDAH} dialect="Gulf" tier="large" cheer="كفو!" headline="x" running={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs * 3);
    });
    expect(showing(container, "dancers").pose).toBe(ARDAH.sequence[0]);
    rerender(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="large" cheer="كفو!" headline="x" running />);
    act(() => {
      vi.advanceTimersByTime(ARDAH.beatMs);
    });
    expect(showing(container, "dancers").pose).toBe(ARDAH.sequence[1]);
  });

  it("doesn't sway a dance whose sway is zero", () => {
    const { container } = render(
      <CelebrationScene dance={{ ...ARDAH, swayDeg: 0 }} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />,
    );
    expect(container.querySelector(".cel-dancers")!.className).not.toMatch(/cel-sway/);
  });

  it("places a dance's figures where its art says, and the Ardah's where the stylesheet does", () => {
    const { container } = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />);
    expect(container.querySelector<HTMLElement>(".cel-dancers")!.style.getPropertyValue("--cel-dancers-left")).toBe("");
    DANCE_ART.test = { ...DANCE_ART.ardah, dancersBox: { left: 30, width: 40, height: 70 } };
    try {
      const other = render(
        <CelebrationScene dance={{ ...ARDAH, id: "test" }} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />,
      );
      const box = other.container.querySelector<HTMLElement>(".cel-dancers")!.style;
      expect([box.getPropertyValue("--cel-dancers-left"), box.getPropertyValue("--cel-dancers-width")]).toEqual(["30%", "40%"]);
    } finally {
      delete DANCE_ART.test;
    }
  });

  it("still lays the paper, the cheer and the milestone for a dialect with no dance yet", () => {
    const { container } = render(
      <CelebrationScene dance={null} dialect="Yemeni" tier="medium" cheer="يا سلام!" headline="Lesson complete!" />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelectorAll(".cel-figure")).toHaveLength(0);
    expect(container.querySelector("svg text")).toBeNull();
    expect(screen.getByText("يا سلام!")).toBeInTheDocument();
    expect(screen.getByText("Lesson complete!")).toBeInTheDocument();
    // The print is the dialect's own place names, not the Ardah's.
    expect(container.querySelector(".cel-news")?.textContent).toContain("صنعاء");
    expect(container.querySelector(".cel-news")?.textContent).not.toContain("نجد");
  });

  it("bobs the dancers by the dance's bob settings, and not at all when it has none", () => {
    const { container } = render(
      <CelebrationScene dance={{ ...ARDAH, bobPct: 4, bobPeriodMs: 430 }} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />,
    );
    const bobber = container.querySelector<HTMLElement>(".cel-bobber")!;
    expect(bobber.className).toMatch(/cel-bob\b/);
    expect(bobber.style.getPropertyValue("--cel-bob-pct")).toBe("4%");
    expect(bobber.style.getPropertyValue("--cel-bob-ms")).toBe("430ms");

    const still = render(<CelebrationScene dance={ARDAH} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />);
    expect(still.container.querySelector(".cel-bobber")!.className).not.toMatch(/cel-bob\b/);
  });

  it("holds the bob still under reduced motion", () => {
    reduced.value = true;
    const { container } = render(
      <CelebrationScene dance={{ ...ARDAH, bobPct: 4, bobPeriodMs: 430 }} dialect="Gulf" tier="medium" cheer="كفو!" headline="x" />,
    );
    expect(container.querySelector(".cel-bobber")!.className).not.toMatch(/cel-bob\b/);
  });
});
