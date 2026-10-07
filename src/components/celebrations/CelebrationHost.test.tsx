import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { dancesFor } from "@/lib/dances";
import { CHEERS, ROTATION_KEY, SCENE_KEY, celebrate, type CelebrationEvent } from "@/lib/celebrations";
import { FOOTBALL, MISHKAK } from "@/lib/vignettes";
import { DANCE_MUSIC_KEY } from "@/lib/danceMusic";
import { setSoundEnabled } from "@/lib/uiPrefs";
import { CelebrationHost } from "./CelebrationHost";
import { DANCE_ART } from "./danceArt";

/**
 * The app-wide celebration screen.
 *
 * Pages only say *that* something happened (`celebrate({ kind: "lesson" })`);
 * the host decides what the learner sees: a dance from the region of the
 * dialect they are learning, a cheer in that dialect, and what they did. The
 * rules worth pinning are the ones a learner would feel: the dance and the
 * cheer match their dialect, a burst of moments becomes one screen rather
 * than a queue of them, Continue (or Escape, or the space around the stage)
 * gets them straight back, and the rotation moves on each time.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  window.history.replaceState(null, "", "/");
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
/** The cheer on the stage, in Arabic. */
const cheer = () => dialog().querySelector(".cel-praise")?.textContent;
/** The dance named for screen readers, or null on a bare stage. */
const danceName = () => within(dialog()).queryByRole("img")?.getAttribute("aria-label") ?? null;

describe("CelebrationHost", () => {
  it("shows nothing until something is celebrated", async () => {
    await renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("celebrates with a dance and a cheer from the learner's dialect", async () => {
    await renderHost();
    await fire({ kind: "lesson", detail: "At the souq" });

    expect(screen.getByRole("dialog", { name: "Lesson complete!" })).toHaveAccessibleDescription(
      "You finished “At the souq”.",
    );
    expect(CHEERS.Gulf.map((c) => c.ar)).toContain(cheer());
    const gulf = dancesFor("Gulf").map((d) => `${d.gloss}, a dance from ${d.region}`);
    expect(gulf).toContain(danceName());
  });

  it("follows the dialect the learner has switched to", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Egyptian");
    await renderHost();
    await fire({ kind: "goal" });

    expect(CHEERS.Egyptian.map((c) => c.ar)).toContain(cheer());
    const egyptian = dancesFor("Egyptian").map((d) => `${d.gloss}, a dance from ${d.region}`);
    // Until Egypt's dances are drawn the stage plays without dancers, never
    // with another dialect's.
    if (egyptian.length) expect(egyptian).toContain(danceName());
    else expect(danceName()).toBeNull();
  });

  it("folds a moment that lands mid-celebration into the same screen", async () => {
    await renderHost();
    await fire({ kind: "deck", detail: 12 });
    await fire({ kind: "achievement", detail: "🔥 On Fire · +50 XP" });
    // The same badge reported twice is still one line.
    await fire({ kind: "achievement", detail: "🔥 On Fire · +50 XP" });
    await fire({ kind: "deck", detail: 12 });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "All caught up!" })).toBeInTheDocument();
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

  it("closes on a tap in the space around the stage, but not on the stage", async () => {
    await renderHost();
    await fire({ kind: "goal" });

    fireEvent.click(screen.getByTestId("celebration-scene"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(dialog());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the dialect's rotation on with each celebration", async () => {
    await renderHost();
    await fire({ kind: "goal" });
    const first = JSON.parse(window.localStorage.getItem(ROTATION_KEY) ?? "{}").Gulf;
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));

    await fire({ kind: "lesson" });
    const second = JSON.parse(window.localStorage.getItem(ROTATION_KEY) ?? "{}").Gulf;
    expect(second).toBe((first + 1) % dancesFor("Gulf").length);
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

    await waitFor(() => expect(screen.getByRole("dialog", { name: "7-day streak!" })).toBeInTheDocument());
    // A streak is never the dance rotation's turn: it plays the dialect's
    // ladder, at the rung its length has reached.
    expect(danceName()).toBe("Mishkak, a street grill from Saudi Arabia and the Gulf");
    expect(window.localStorage.getItem(ROTATION_KEY)).toBeNull();
  });

  it("plays the learner's own dialect's ladder for a streak", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Yemeni");
    await renderHost();
    await fire({ kind: "streak", detail: 30 });
    expect(danceName()).toBe("Al-Madhbi, a hot-stone grill from Yemen");
  });
});

describe("CelebrationHost: dances and vignettes take turns", () => {
  it("opens with the dance a learner was promised, then brings in a scene that suits the moment", async () => {
    await renderHost();
    await fire({ kind: "lesson", detail: "At the souq" });
    const gulf = dancesFor("Gulf").map((d) => `${d.gloss}, a dance from ${d.region}`);
    expect(gulf).toContain(danceName());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));

    // The second lesson is the incense: a welcome.
    await fire({ kind: "lesson", detail: "At the souq" });
    expect(danceName()).toBe("Al-Bakhoor, a welcome with incense from the Gulf");
    expect(cheer()).toBe("هلا والله!");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));

    // The third goes back to the rotation, which had only moved once.
    await fire({ kind: "lesson", detail: "At the souq" });
    expect(gulf).toContain(danceName());
  });

  it("keeps each moment's turn apart", async () => {
    await renderHost();
    await fire({ kind: "lesson" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
    // A first badge is still a dance, however many lessons have been finished.
    await fire({ kind: "achievement", detail: "First Steps" });
    const gulf = dancesFor("Gulf").map((d) => `${d.gloss}, a dance from ${d.region}`);
    expect(gulf).toContain(danceName());
    expect(JSON.parse(window.localStorage.getItem(SCENE_KEY) ?? "{}")).toEqual({
      "Gulf:lesson": 1,
      "Gulf:achievement": 1,
    });
  });

  it("shows only dances for a moment no vignette suits", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Yemeni");
    await renderHost();
    for (let i = 0; i < 3; i++) {
      await fire({ kind: "lesson" });
      expect(danceName()).toMatch(/, a dance from /);
      fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
    }
    expect(window.localStorage.getItem(SCENE_KEY)).toBeNull();
  });
});

describe("CelebrationHost: the preview link", () => {
  // A lesson only celebrates the first time it is finished, so `?celebrate=`
  // is how a scene gets reviewed more than once. It must take itself out of
  // the address, or every reload replays it.

  it("plays the named dance and takes the parameter out of the address", async () => {
    window.history.replaceState(null, "", "/today?dialect=gulf&celebrate=ardah-large#top");
    await renderHost();
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeInTheDocument();
    expect(danceName()).toBe("Al-Ardah, a dance from Najd, Saudi Arabia");
    expect(window.location.search).toBe("?dialect=gulf");
    expect(window.location.hash).toBe("#top");
  });

  it("plays the dance with its own dialect's cheer, whatever the learner studies", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Yemeni");
    window.history.replaceState(null, "", "/?celebrate=ardah");
    await renderHost();
    expect(danceName()).toBe("Al-Ardah, a dance from Najd, Saudi Arabia");
    expect(CHEERS.Gulf.map((c) => c.ar)).toContain(cheer());
  });

  it("does not move the rotation", async () => {
    window.history.replaceState(null, "", "/?celebrate=ardah");
    await renderHost();
    expect(window.localStorage.getItem(ROTATION_KEY)).toBeNull();
  });

  it("plays a vignette by id for the learner's dialect, with its own cheer", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Egyptian");
    window.history.replaceState(null, "", "/?celebrate=football-large");
    await renderHost();
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeInTheDocument();
    // One goal, called two ways: Cairo's name and cheer, not the Gulf's.
    expect(danceName()).toBe("Al-Gōn, a goal, as the commentators call it in Egypt");
    expect(cheer()).toBe("جوووون!");
    expect(window.location.search).toBe("");
  });

  it("plays a ladder at the length the link asks for, and takes both parameters out of the address", async () => {
    window.history.replaceState(null, "", "/today?celebrate=mishkak-large&celebratedays=365");
    await renderHost();
    expect(danceName()).toBe(`${MISHKAK.gloss}, ${MISHKAK.about}`);
    expect(window.location.search).toBe("");
  });

  it("plays a vignette made for another dialect in its own, not the learner's", async () => {
    window.localStorage.setItem("hakiya_dialect_module", "Yemeni");
    window.history.replaceState(null, "", "/?celebrate=mishkak");
    await renderHost();
    expect(danceName()).toBe(`${MISHKAK.gloss}, ${MISHKAK.about}`);
    expect(CHEERS.Gulf.map((c) => c.ar).concat(MISHKAK.ladder!.flatMap((r) => (r.cheer ? [r.cheer.ar] : [])))).toContain(
      cheer(),
    );
  });

  it("keeps a vignette's name for the Gulf when the learner is Gulf", async () => {
    window.history.replaceState(null, "", "/?celebrate=football");
    await renderHost();
    expect(danceName()).toBe(`${FOOTBALL.gloss}, ${FOOTBALL.about}`);
  });

  it("does nothing for a dance that doesn't exist", async () => {
    window.history.replaceState(null, "", "/?celebrate=dabke");
    await renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CelebrationHost: the dance music", () => {
  // The loops are test audio whose rights are not cleared, so a learner must
  // never hear one by accident: a preview plays it, a real celebration only
  // once someone has switched the test flag on with `?dancemusic=on`.

  class FakeAudio {
    static instances: FakeAudio[] = [];
    loop = false;
    volume = 1;
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    constructor(public src: string) {
      FakeAudio.instances.push(this);
    }
  }

  const playing = () => FakeAudio.instances.map((a) => a.src);

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudio.instances = [];
  });

  const withAudio = () => vi.stubGlobal("Audio", FakeAudio);

  it("plays the previewed dance's own music", async () => {
    withAudio();
    window.history.replaceState(null, "", "/?celebrate=ardah");
    await renderHost();
    expect(playing()).toEqual([DANCE_ART.ardah.music]);
  });

  it("keeps a real celebration silent until the test flag is on", async () => {
    withAudio();
    window.localStorage.setItem("hakiya_dialect_module", "Egyptian");
    await renderHost();
    await fire({ kind: "lesson", detail: "At the souq" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(playing()).toEqual([]);
  });

  it("switches the flag on from the address, takes the parameter out, and plays the next dance's music", async () => {
    withAudio();
    // Every Egyptian dance has a loop, so whichever comes up plays one.
    window.localStorage.setItem("hakiya_dialect_module", "Egyptian");
    window.history.replaceState(null, "", "/today?dancemusic=on");
    await renderHost();
    expect(window.localStorage.getItem(DANCE_MUSIC_KEY)).toBe("on");
    expect(window.location.search).toBe("");
    await fire({ kind: "lesson", detail: "At the souq" });
    const shown = dancesFor("Egyptian").find((d) => danceName()?.startsWith(d.gloss));
    expect(shown).toBeDefined();
    expect(playing()).toEqual([DANCE_ART[shown!.id].music]);
  });

  it("switches the flag off again", async () => {
    window.localStorage.setItem(DANCE_MUSIC_KEY, "on");
    window.history.replaceState(null, "", "/?dancemusic=off");
    await renderHost();
    expect(window.localStorage.getItem(DANCE_MUSIC_KEY)).toBeNull();
  });

  it("stays silent when the app's sound is off, even in a preview", async () => {
    withAudio();
    setSoundEnabled(false);
    window.history.replaceState(null, "", "/?celebrate=ardah");
    await renderHost();
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeInTheDocument();
    expect(playing()).toEqual([]);
  });

  it("fades the music out when the screen closes", async () => {
    withAudio();
    window.history.replaceState(null, "", "/?celebrate=ardah");
    await renderHost();
    const [audio] = FakeAudio.instances;
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(audio.pause).toHaveBeenCalled());
  });
});
