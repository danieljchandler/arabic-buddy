import { afterEach, describe, expect, it, vi } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import type { DialectModule } from "@/contexts/DialectContext";
import { ARDAH, DANCES, dancesFor, type DanceDefinition } from "./dances";
import {
  CHEERS,
  GOAL_KEY,
  KIND_TIER,
  ROTATION_KEY,
  STREAK_KEY,
  TIER_DURATION_MS,
  celebrate,
  celebrationCopy,
  celebrationSummary,
  claimDailyGoalCelebration,
  claimStreakCelebration,
  isStreakMilestone,
  largerTier,
  nextDanceIndex,
  parseCelebrateParam,
  pickCheer,
  shouldCelebrateStreak,
  subscribeCelebrations,
  takeNextDance,
  tierFor,
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

describe("how long each moment plays", () => {
  it("gets longer as the milestone gets bigger", () => {
    expect(TIER_DURATION_MS.small).toBeLessThan(TIER_DURATION_MS.medium);
    expect(TIER_DURATION_MS.medium).toBeLessThan(TIER_DURATION_MS.large);
  });

  it("gives the day's goal and a streak the long scene, and the everyday wins the short one", () => {
    expect(KIND_TIER.goal).toBe("large");
    expect(KIND_TIER.streak).toBe("large");
    for (const kind of ["lesson", "letter", "deck", "achievement"] as const) expect(KIND_TIER[kind]).toBe("medium");
  });

  it("lets an event ask for its own tier", () => {
    expect(tierFor({ kind: "lesson" })).toBe("medium");
    expect(tierFor({ kind: "preview", tier: "large" })).toBe("large");
  });

  it("keeps the bigger tier when two moments share a screen", () => {
    expect(largerTier("medium", "large")).toBe("large");
    expect(largerTier("large", "small")).toBe("large");
    expect(largerTier("small", "small")).toBe("small");
  });
});

describe("which dance comes next", () => {
  it("starts a new learner at a random point in the rotation", () => {
    expect(nextDanceIndex(undefined, 6, () => 0)).toBe(0);
    expect(nextDanceIndex(undefined, 6, () => 0.5)).toBe(3);
    expect(nextDanceIndex(null, 6, () => 0.999)).toBe(5);
  });

  it("then walks the list in order, wrapping at the end", () => {
    expect(nextDanceIndex(0, 6)).toBe(1);
    expect(nextDanceIndex(5, 6)).toBe(0);
  });

  it("treats a corrupted cursor as no history", () => {
    expect(nextDanceIndex(-3, 4, () => 0)).toBe(0);
    expect(nextDanceIndex(1.5, 4, () => 0.75)).toBe(3);
  });

  it("shows every dance before any repeats", () => {
    const store = aStore();
    const count = dancesFor("Gulf").length;
    const seen = Array.from({ length: count }, () => takeNextDance("Gulf", store, () => 0)?.id);
    expect(new Set(seen).size).toBe(count);
    expect(takeNextDance("Gulf", store)?.id).toBe(seen[0]);
  });

  it("keeps a separate place in each dialect's rotation", () => {
    const store = aStore({ [ROTATION_KEY]: JSON.stringify({ Gulf: 0, Egyptian: 3 }) });
    const gulf = dancesFor("Gulf");
    const first = takeNextDance("Gulf", store);
    // Every dialect's dances are filed under it, so another dialect's turn
    // never moves this one's cursor.
    expect(first?.id).toBe(gulf[1 % gulf.length].id);
    expect(JSON.parse(store.data[ROTATION_KEY])).toEqual({ Gulf: 1 % gulf.length, Egyptian: 3 });
  });

  it("only ever picks a dance from the learner's own dialect", () => {
    const store = aStore();
    for (const dialect of DIALECTS) {
      for (let i = 0; i < 6; i++) {
        const dance = takeNextDance(dialect, store);
        if (dance) expect(dance.dialect).toBe(dialect);
      }
    }
  });

  it("has no dance, and moves no cursor, for a dialect with none drawn yet", () => {
    const store = aStore();
    const bare = DIALECTS.find((d) => dancesFor(d).length === 0);
    if (!bare) return; // every dialect has a dance
    expect(takeNextDance(bare, store)).toBeNull();
    expect(store.data[ROTATION_KEY]).toBeUndefined();
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
    expect(takeNextDance("Gulf", broken, () => 0)?.dialect).toBe("Gulf");
    expect(takeNextDance("Gulf", null, () => 0)?.dialect).toBe("Gulf");
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

  it("names the letter", () => {
    expect(celebrationCopy({ kind: "letter", detail: "bā' (ب)" })).toEqual({
      title: "Letter mastered!",
      subtitle: "bā' (ب) is yours to read and write.",
    });
    expect(celebrationSummary({ kind: "letter", detail: "bā' (ب)" })).toBe(
      "Letter mastered! bā' (ب) is yours to read and write.",
    );
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

describe("the preview link", () => {
  it("plays a dance by id at the medium tier", () => {
    expect(parseCelebrateParam("?celebrate=ardah")).toEqual({ dance: ARDAH, tier: "medium" });
  });

  it("takes a tier after a dash", () => {
    expect(parseCelebrateParam("?celebrate=ardah-large")?.tier).toBe("large");
    expect(parseCelebrateParam("?celebrate=Ardah-Small")?.tier).toBe("small");
    expect(parseCelebrateParam("?celebrate=ardah-huge")?.tier).toBe("medium");
  });

  it("ignores a dance that doesn't exist, or no parameter at all", () => {
    expect(parseCelebrateParam("?celebrate=dabke")).toBeNull();
    expect(parseCelebrateParam("?brand=ink")).toBeNull();
    expect(parseCelebrateParam("")).toBeNull();
  });

  it("reaches every dance in the catalogue", () => {
    for (const dance of DANCES) {
      expect(parseCelebrateParam(`?celebrate=${dance.id}`)?.dance).toBe<DanceDefinition>(dance);
    }
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
