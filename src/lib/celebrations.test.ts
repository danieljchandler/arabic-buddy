import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import type { DialectModule } from "@/contexts/DialectContext";
import {
  CHEERS,
  DANCE_SCENES,
  GOAL_KEY,
  ROTATION_KEY,
  STREAK_KEY,
  celebrate,
  celebrationCopy,
  celebrationSummary,
  claimDailyGoalCelebration,
  claimStreakCelebration,
  isStreakMilestone,
  nextSceneIndex,
  pickCheer,
  sceneAssets,
  scenesFor,
  shouldCelebrateStreak,
  subscribeCelebrations,
  takeNextScene,
  type KeyValueStore,
} from "./celebrations";

/**
 * The celebration screen's logic: which dance comes next, what it shouts, and
 * the two "already celebrated" rules that keep a reward from turning into a
 * nag.
 *
 * Each of these is a promise a learner would notice breaking. A rotation that
 * repeats the same dance three times running stops being a tour of the
 * culture. A cheer in فصحى is the one thing this app exists not to teach. A
 * daily goal that throws the full screen on every visit to the Today page, or
 * a streak that is congratulated again the morning after, turns the moment
 * into an interruption.
 */

const DIALECTS: DialectModule[] = ["Gulf", "Egyptian", "Yemeni"];

/** A Storage stand-in, so each test starts from nothing and can be inspected. */
function aStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("the dances", () => {
  it("gives every dialect a rotation of more than one dance", () => {
    for (const dialect of DIALECTS) {
      expect(scenesFor(dialect).length, dialect).toBeGreaterThanOrEqual(4);
    }
  });

  it("uses each asset name once", () => {
    const ids = DANCE_SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships the clip, its WebM twin and a still for every dance", () => {
    // The overlay degrades to the still when a clip will not play, and to
    // nothing at all when the still is missing — so all three must exist.
    for (const scene of DANCE_SCENES) {
      for (const url of Object.values(sceneAssets(scene.id))) {
        const file = resolve(__dirname, "../../public", url.replace(/^\//, ""));
        expect(existsSync(file), url).toBe(true);
        expect(statSync(file).size, url).toBeGreaterThan(1_000);
      }
    }
  });

  it("names every dance in Arabic and English and says where it is from", () => {
    for (const scene of DANCE_SCENES) {
      expect(scene.nameAr, scene.id).toMatch(/[؀-ۿ]/);
      expect(scene.nameEn, scene.id).not.toBe("");
      expect(scene.region, scene.id).not.toBe("");
      expect(scene.blurb.length, scene.id).toBeGreaterThan(40);
    }
  });

  it("files each dance under the dialect its asset name says", () => {
    const prefix: Record<DialectModule, string> = { Gulf: "gulf-", Egyptian: "egypt-", Yemeni: "yemen-" };
    for (const scene of DANCE_SCENES) {
      expect(scene.id.startsWith(prefix[scene.dialect]), scene.id).toBe(true);
    }
  });
});

describe("which dance comes next", () => {
  it("starts a new learner at a random point in the rotation", () => {
    expect(nextSceneIndex(undefined, 6, () => 0)).toBe(0);
    expect(nextSceneIndex(undefined, 6, () => 0.5)).toBe(3);
    expect(nextSceneIndex(null, 6, () => 0.999)).toBe(5);
  });

  it("then walks the list in order, wrapping at the end", () => {
    expect(nextSceneIndex(0, 6)).toBe(1);
    expect(nextSceneIndex(5, 6)).toBe(0);
  });

  it("treats a corrupted cursor as no history", () => {
    expect(nextSceneIndex(-3, 4, () => 0)).toBe(0);
    expect(nextSceneIndex(1.5, 4, () => 0.75)).toBe(3);
  });

  it("shows every dance before any repeats", () => {
    const store = aStore();
    const count = scenesFor("Gulf").length;
    const seen = Array.from({ length: count }, () => takeNextScene("Gulf", store, () => 0).id);
    expect(new Set(seen).size).toBe(count);
    expect(takeNextScene("Gulf", store).id).toBe(seen[0]);
  });

  it("keeps a separate place in each dialect's rotation", () => {
    const store = aStore();
    const first = takeNextScene("Gulf", store, () => 0);
    takeNextScene("Egyptian", store, () => 0);
    takeNextScene("Egyptian", store, () => 0);
    // Switching dialects for a while does not skip the Gulf rotation ahead.
    expect(takeNextScene("Gulf", store).id).toBe(scenesFor("Gulf")[1].id);
    expect(first.dialect).toBe("Gulf");
    expect(JSON.parse(store.data[ROTATION_KEY])).toEqual({ Gulf: 1, Egyptian: 1 });
  });

  it("only ever picks a dance from the learner's own dialect", () => {
    const store = aStore();
    for (let i = 0; i < 10; i++) expect(takeNextScene("Yemeni", store).dialect).toBe("Yemeni");
  });

  it("still picks a dance when storage is unavailable", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(takeNextScene("Egyptian", broken, () => 0).dialect).toBe("Egyptian");
    expect(takeNextScene("Egyptian", null, () => 0).dialect).toBe("Egyptian");
  });
});

describe("what the screen shouts", () => {
  it("has cheers for every dialect", () => {
    for (const dialect of DIALECTS) expect(CHEERS[dialect].length, dialect).toBeGreaterThan(2);
  });

  it("never cheers in فصحى", () => {
    for (const dialect of DIALECTS) {
      for (const cheer of CHEERS[dialect]) {
        expect(detectMsaLeaks(cheer.ar, dialect).leaks, `${dialect}: ${cheer.ar}`).toEqual([]);
      }
    }
  });

  it("gives every cheer a transliteration and a translation", () => {
    for (const dialect of DIALECTS) {
      for (const cheer of CHEERS[dialect]) {
        expect(cheer.translit, cheer.ar).toMatch(/[A-Za-z]/);
        expect(cheer.en, cheer.ar).toMatch(/[A-Za-z]/);
      }
    }
  });

  it("picks from the learner's dialect", () => {
    expect(CHEERS.Egyptian).toContainEqual(pickCheer("Egyptian", () => 0.99));
    expect(pickCheer("Gulf", () => 0)).toEqual(CHEERS.Gulf[0]);
  });
});

describe("what the screen says", () => {
  it("names the finished lesson", () => {
    expect(celebrationCopy({ kind: "lesson", detail: "At the souq" })).toEqual({
      title: "Lesson complete!",
      subtitle: "You finished “At the souq”.",
    });
    expect(celebrationCopy({ kind: "lesson" }).subtitle).toBe("Another lesson behind you.");
  });

  it("counts the cards behind a cleared deck", () => {
    expect(celebrationCopy({ kind: "deck", detail: 1 }).subtitle).toBe("1 card reviewed. Nothing left due.");
    expect(celebrationCopy({ kind: "deck", detail: 12 }).subtitle).toBe("12 cards reviewed. Nothing left due.");
    expect(celebrationCopy({ kind: "deck" }).subtitle).toBe("Every card due today is done.");
  });

  it("titles a streak by its length", () => {
    expect(celebrationCopy({ kind: "streak", detail: 7 })).toEqual({
      title: "7-day streak!",
      subtitle: "You've practised 7 days in a row.",
    });
    expect(celebrationCopy({ kind: "streak", detail: "30" }).title).toBe("30-day streak!");
    expect(celebrationCopy({ kind: "streak" }).title).toBe("Streak milestone!");
  });

  it("names the badge", () => {
    expect(celebrationCopy({ kind: "achievement", detail: "🔥 On Fire · +50 XP" }).subtitle).toBe(
      "🔥 On Fire · +50 XP",
    );
    expect(celebrationCopy({ kind: "goal" }).title).toBe("Daily goal reached!");
  });

  it("keeps the name in the one-line form of a lesson or badge", () => {
    expect(celebrationSummary({ kind: "achievement", detail: "First Steps" })).toBe("Badge earned! First Steps");
    expect(celebrationSummary({ kind: "lesson", detail: "Greetings" })).toBe(
      "Lesson complete! You finished “Greetings”.",
    );
    expect(celebrationSummary({ kind: "goal" })).toBe("Daily goal reached!");
  });
});

describe("the daily goal is celebrated once a day", () => {
  it("fires the first time and not again that day", () => {
    const store = aStore();
    expect(claimDailyGoalCelebration("2026-10-03", store)).toBe(true);
    expect(claimDailyGoalCelebration("2026-10-03", store)).toBe(false);
    expect(store.data[GOAL_KEY]).toBe(JSON.stringify("2026-10-03"));
  });

  it("fires again the next day", () => {
    const store = aStore({ [GOAL_KEY]: JSON.stringify("2026-10-02") });
    expect(claimDailyGoalCelebration("2026-10-03", store)).toBe(true);
  });
});

describe("streak milestones", () => {
  it("knows the milestones", () => {
    expect(isStreakMilestone(7)).toBe(true);
    expect(isStreakMilestone(30)).toBe(true);
    expect(isStreakMilestone(8)).toBe(false);
    expect(isStreakMilestone(0)).toBe(false);
  });

  it("celebrates a milestone not yet seen", () => {
    expect(shouldCelebrateStreak(7, null, "2026-10-03")).toBe(true);
    expect(shouldCelebrateStreak(14, { streak: 7, date: "2026-09-26" }, "2026-10-03")).toBe(true);
  });

  it("ignores a day that is not a milestone", () => {
    expect(shouldCelebrateStreak(8, null, "2026-10-03")).toBe(false);
  });

  it("does not celebrate the same run twice", () => {
    // Reached 7 yesterday; the row still reads 7 this morning until today's
    // review moves it on.
    expect(shouldCelebrateStreak(7, { streak: 7, date: "2026-10-02" }, "2026-10-03")).toBe(false);
    expect(shouldCelebrateStreak(7, { streak: 7, date: "2026-10-03" }, "2026-10-03")).toBe(false);
  });

  it("celebrates a new run that climbs back to the same milestone", () => {
    // The 3-day run ended; three or more days later it is 3 again.
    expect(shouldCelebrateStreak(3, { streak: 3, date: "2026-09-20" }, "2026-10-03")).toBe(true);
  });

  it("keeps each learner's milestones apart on a shared device", () => {
    const store = aStore();
    expect(claimStreakCelebration("learner-a", 7, "2026-10-03", store)).toBe(true);
    expect(claimStreakCelebration("learner-a", 7, "2026-10-03", store)).toBe(false);
    expect(claimStreakCelebration("learner-b", 7, "2026-10-03", store)).toBe(true);
    expect(JSON.parse(store.data[STREAK_KEY])).toEqual({
      "learner-a": { streak: 7, date: "2026-10-03" },
      "learner-b": { streak: 7, date: "2026-10-03" },
    });
  });
});

describe("firing a celebration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reaches every subscriber, and stops once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCelebrations(listener);
    celebrate({ kind: "goal" });
    expect(listener).toHaveBeenCalledWith({ kind: "goal" });

    unsubscribe();
    celebrate({ kind: "goal" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is a no-op with nobody listening", () => {
    expect(() => celebrate({ kind: "lesson" })).not.toThrow();
  });
});
