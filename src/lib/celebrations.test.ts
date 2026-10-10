import { afterEach, describe, expect, it, vi } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import type { DialectModule } from "@/contexts/DialectContext";
import { ARDAH, DANCES, dancesFor, type DanceDefinition } from "./dances";
import { MISHKAK, VIGNETTES, vignetteById } from "./vignettes";
import {
  CHEERS,
  GOAL_KEY,
  KIND_TIER,
  CELEBRATE_BADGE_PARAM,
  CELEBRATE_DAYS_PARAM,
  ROTATION_KEY,
  SCENE_KEY,
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
  pickSceneCheer,
  previewBadge,
  previewScene,
  shouldCelebrateStreak,
  subscribeCelebrations,
  takeNextDance,
  takeScene,
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

  it("gives a boss beaten the shortest, since the session goes on after it", () => {
    expect(KIND_TIER.boss).toBe("small");
    expect(tierFor({ kind: "boss", detail: "السوق" })).toBe("small");
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

describe("which scene a moment gets", () => {
  it("gives a streak milestone the dialect's ladder, at the rung its length has reached", () => {
    const store = aStore();
    expect(takeScene({ kind: "streak", detail: 3 }, "Gulf", store)).toMatchObject({ id: "mishkak", sequence: [0] });
    expect(takeScene({ kind: "streak", detail: 365 }, "Gulf", store)).toMatchObject({ id: "mishkak", heat: 5 });
    expect(takeScene({ kind: "streak", detail: 30 }, "Egyptian", store)?.id).toBe("kababgi");
    expect(takeScene({ kind: "streak", detail: 14 }, "Yemeni", store)?.id).toBe("madhbi");
    // It never moves the dances' rotation or the vignettes' turn.
    expect(store.data).toEqual({});
  });

  it("plays the first rung for a streak whose length it cannot read", () => {
    expect(takeScene({ kind: "streak" }, "Gulf", aStore())?.sequence).toEqual(MISHKAK.ladder![0].sequence);
    expect(takeScene({ kind: "streak", detail: "7" }, "Gulf", aStore())?.sequence).toEqual([1]);
  });

  it("opens with the dance, so a first lesson, goal or badge is the dance a learner was promised", () => {
    for (const kind of ["lesson", "goal", "achievement", "deck", "letter"] as const) {
      const scene = takeScene({ kind }, "Gulf", aStore(), () => 0);
      expect(dancesFor("Gulf").map((d) => d.id), kind).toContain(scene?.id);
    }
  });

  it("then takes turns: a dance, a scene that suits the moment, a dance", () => {
    const store = aStore();
    const picks = Array.from({ length: 6 }, () => takeScene({ kind: "lesson" }, "Gulf", store, () => 0)?.id);
    expect(picks[1]).toBe("bakhoor");
    expect(picks[3]).toBe("bakhoor");
    for (const i of [0, 2, 4]) expect(dancesFor("Gulf").map((d) => d.id)).toContain(picks[i]);
    // The dances still come round in order between them.
    expect(new Set([picks[0], picks[2], picks[4]]).size).toBe(3);
  });

  it("walks a moment's vignettes in turn when it has several", () => {
    const store = aStore();
    const picks = Array.from({ length: 8 }, () => takeScene({ kind: "goal" }, "Gulf", store, () => 0)?.id);
    expect([picks[1], picks[3], picks[5], picks[7]]).toEqual(["dallah", "football", "dallah", "football"]);
  });

  it("keeps each dialect's and each moment's turn apart", () => {
    const store = aStore();
    takeScene({ kind: "lesson" }, "Gulf", store);
    takeScene({ kind: "goal" }, "Gulf", store);
    takeScene({ kind: "goal" }, "Egyptian", store);
    expect(JSON.parse(store.data[SCENE_KEY])).toEqual({ "Gulf:lesson": 1, "Gulf:goal": 1, "Egyptian:goal": 1 });
  });

  it("plays only a dance for a moment with no scene made for it, and counts nothing", () => {
    const store = aStore();
    for (let i = 0; i < 4; i++) {
      const scene = takeScene({ kind: "lesson" }, "Yemeni", store, () => 0);
      expect(dancesFor("Yemeni").map((d) => d.id)).toContain(scene?.id);
    }
    expect(store.data[SCENE_KEY]).toBeUndefined();
    expect(takeScene({ kind: "preview" }, "Gulf", aStore())?.dialect).toBe("Gulf");
  });

  it("only ever picks from the learner's own dialect", () => {
    const store = aStore();
    for (const dialect of DIALECTS) {
      for (const kind of ["lesson", "letter", "deck", "goal", "achievement", "streak"] as const) {
        for (let i = 0; i < 6; i++) {
          const scene = takeScene({ kind, detail: 30 }, dialect, store);
          expect(scene?.dialect, `${dialect} ${kind}`).toBe(dialect);
        }
      }
    }
  });

  it("treats a corrupted count as the start, and still plays when storage is unavailable", () => {
    const store = aStore({ [SCENE_KEY]: JSON.stringify({ "Gulf:lesson": -4 }) });
    expect(dancesFor("Gulf").map((d) => d.id)).toContain(takeScene({ kind: "lesson" }, "Gulf", store)?.id);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(takeScene({ kind: "lesson" }, "Gulf", broken)?.dialect).toBe("Gulf");
    expect(takeScene({ kind: "lesson" }, "Gulf", null)?.dialect).toBe("Gulf");
  });

  it("gives every dialect a scene for every moment", () => {
    for (const dialect of DIALECTS) {
      for (const kind of ["lesson", "letter", "deck", "goal", "achievement", "streak"] as const) {
        expect(takeScene({ kind, detail: 7 }, dialect, aStore()), `${dialect} ${kind}`).not.toBeNull();
      }
    }
  });
});

describe("naming a scene for a preview", () => {
  it("finds a dance by id, for its own dialect, whoever is asking", () => {
    expect(previewScene("ardah", "Yemeni")).toEqual({ scene: ARDAH, dialect: "Gulf" });
  });

  it("plays a vignette for the learner's dialect when it is made for it, else its own", () => {
    expect(previewScene("qalam", "Yemeni")?.dialect).toBe("Yemeni");
    expect(previewScene("football", "Egyptian")?.scene.gloss).toBe("Al-Gōn");
    expect(previewScene("football", "Yemeni")?.dialect).toBe("Gulf");
    expect(previewScene("mishkak", "Egyptian")?.dialect).toBe("Gulf");
  });

  it("plays a ladder at the length it is asked for, or a hundred days", () => {
    expect(previewScene("mishkak", "Gulf", 3)?.scene.sequence).toEqual([0]);
    expect(previewScene("mishkak", "Gulf")?.scene.sequence).toEqual(MISHKAK.ladder!.find((r) => r.fromDays === 100)!.sequence);
  });

  it("finds nothing for an id that matches nothing", () => {
    expect(previewScene("dabke", "Gulf")).toBeNull();
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

  it("shouts what a scene has to shout, and the dialect's own cheer otherwise", () => {
    const goal = vignetteById("football")!;
    expect(pickSceneCheer({ ...goal, cheers: goal.cheers }, "Gulf", () => 0).ar).toBe("قوووول!");
    expect(pickSceneCheer(ARDAH, "Gulf", () => 0)).toEqual(CHEERS.Gulf[0]);
    expect(pickSceneCheer(null, "Yemeni", () => 0)).toEqual(CHEERS.Yemeni[0]);
    expect(pickSceneCheer({ ...ARDAH, cheers: [] }, "Gulf", () => 0)).toEqual(CHEERS.Gulf[0]);
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

  it("names the boss beaten", () => {
    expect(celebrationCopy({ kind: "boss", detail: "السوق" })).toEqual({
      title: "Boss beaten!",
      subtitle: "السوق, the one you kept missing, is yours.",
    });
    expect(celebrationCopy({ kind: "boss" }).subtitle).toBe("The one you kept missing is yours.");
    expect(celebrationSummary({ kind: "boss", detail: "السوق" })).toBe("Boss beaten!");
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

  it("reaches every vignette, and takes a tier after a dash like a dance does", () => {
    for (const v of VIGNETTES) expect(parseCelebrateParam(`?celebrate=${v.id}`)?.dance).toBe<DanceDefinition>(v);
    expect(parseCelebrateParam("?celebrate=football-large")?.tier).toBe("large");
  });

  it("takes the length of a streak to preview, ignoring one that is not a number of days", () => {
    expect(parseCelebrateParam(`?celebrate=mishkak&${CELEBRATE_DAYS_PARAM}=30`)).toEqual({
      dance: MISHKAK,
      tier: "medium",
      days: 30,
    });
    expect(parseCelebrateParam(`?celebrate=mishkak&${CELEBRATE_DAYS_PARAM}=soon`)).toEqual({ dance: MISHKAK, tier: "medium" });
    expect(parseCelebrateParam(`?celebrate=mishkak&${CELEBRATE_DAYS_PARAM}=-5`)).toEqual({ dance: MISHKAK, tier: "medium" });
  });
});

describe("previewing a badge", () => {
  it("takes the badge's emoji from the address", () => {
    expect(parseCelebrateParam(`?celebrate=lulu&${CELEBRATE_BADGE_PARAM}=🔥`)).toEqual({
      dance: vignetteById("lulu"),
      tier: "medium",
      badge: "🔥",
    });
  });

  it("takes it alongside a tier and a streak length", () => {
    expect(parseCelebrateParam(`?celebrate=mishkak-large&celebratedays=30&${CELEBRATE_BADGE_PARAM}=🏆`)).toMatchObject({
      tier: "large",
      days: 30,
      badge: "🏆",
    });
  });

  it("ignores an empty one", () => {
    expect(parseCelebrateParam(`?celebrate=ardah&${CELEBRATE_BADGE_PARAM}=%20`)).toEqual({ dance: ARDAH, tier: "medium" });
  });

  it("makes a sample badge that is never a real one, so nothing can be sung about it", () => {
    const badge = previewBadge("🔥");
    expect(badge).toMatchObject({ icon: "🔥", id: "preview", xp: 50 });
    expect(badge.name).not.toBe("");
    expect(badge.nameArabic).toMatch(/[\u0600-\u06FF]/);
    // Not a uuid: the song function would refuse it even if it were asked.
    expect(badge.id).not.toMatch(/^[0-9a-f]{8}-/);
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
