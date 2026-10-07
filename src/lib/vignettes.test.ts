import { describe, expect, it } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import type { DialectModule } from "@/contexts/DialectContext";
import { STREAK_MILESTONES, type CelebrationKind } from "./celebrations";
import { DANCES, poseAt } from "./dances";
import {
  FAN_STROKE_MS,
  FOOTBALL,
  KABABGI,
  LADDER_BEAT_MS,
  MADHBI,
  MISHKAK,
  QALAM,
  VIGNETTES,
  VIGNETTE_BEAT_MS,
  forDialect,
  ladderFor,
  resolveVignette,
  rungFor,
  vignetteById,
  vignettesFor,
} from "./vignettes";

/**
 * The vignettes beside the dances: what is in the catalogue, how a streak
 * climbs its ladder, and which scene a moment can have. Nothing here is timed
 * from footage (there is none), so these tests hold the *rules* a learner
 * would notice: a streak always has a picture, a longer streak never gets a
 * smaller fire, a dialect never sees another's scene, and no cheer is فصحى.
 */

const DIALECTS: DialectModule[] = ["Gulf", "Egyptian", "Yemeni"];
const LADDERS = [MISHKAK, KABABGI, MADHBI];

describe("the catalogue", () => {
  it("uses each id once, none with a dash (which `?celebrate=` reads as the tier) and none a dance's", () => {
    const ids = VIGNETTES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z]+$/);
      expect(DANCES.map((d) => d.id)).not.toContain(id);
    }
  });

  it("finds a vignette by id", () => {
    expect(vignetteById("mishkak")).toBe(MISHKAK);
    expect(vignetteById("ardah")).toBeNull();
  });

  it("names every vignette in Arabic and English and says where it is from", () => {
    for (const v of VIGNETTES) {
      expect(v.title, v.id).toMatch(/[؀-ۿ]/);
      expect(v.gloss, v.id).not.toBe("");
      expect(v.region, v.id).not.toBe("");
      expect(v.about, v.id).toMatch(/^an? |^the /);
    }
  });

  it("opens in a dialect it is made for, and is made for at least one", () => {
    for (const v of VIGNETTES) {
      expect(v.dialects.length, v.id).toBeGreaterThan(0);
      expect(v.dialects, v.id).toContain(v.dialect);
    }
  });

  it("gives every vignette effects, a strength and somewhere to rise from that fit the stage", () => {
    for (const v of VIGNETTES) {
      expect(v.effects?.length, v.id).toBeGreaterThan(0);
      for (const heat of [v.heat ?? 2, ...(v.ladder ?? []).map((r) => r.heat)]) {
        expect(heat, v.id).toBeGreaterThanOrEqual(1);
        expect(heat, v.id).toBeLessThanOrEqual(5);
      }
      if (v.fxAnchor) {
        expect(v.fxAnchor.x, v.id).toBeGreaterThanOrEqual(0);
        expect(v.fxAnchor.x, v.id).toBeLessThanOrEqual(100);
        expect(v.fxAnchor.y, v.id).toBeGreaterThanOrEqual(0);
        expect(v.fxAnchor.y, v.id).toBeLessThanOrEqual(100);
      }
    }
  });

  it("opens every scene on the first still, untilted, so a still render is clean", () => {
    for (const v of VIGNETTES) {
      const first = poseAt(v, 0);
      expect(first.pose, v.id).toBe(v.sequence[0]);
      expect(first.rotateDeg, v.id).toBe(0);
    }
  });

  it("changes pose on the beat and never off the end of its stills", () => {
    for (const v of VIGNETTES) {
      const stills = Math.max(...v.sequence) + 1;
      for (let step = 0; step < v.sequence.length * 2; step++) {
        const pose = poseAt(v, step * v.beatMs).pose;
        expect(pose, `${v.id} step ${step}`).toBeLessThan(stills);
        expect(pose, `${v.id} step ${step}`).toBe(v.sequence[step % v.sequence.length]);
      }
    }
  });
});

describe("the streak ladders", () => {
  it("has one per dialect, so a streak always has a picture", () => {
    for (const dialect of DIALECTS) expect(ladderFor(dialect)?.dialects, dialect).toEqual([dialect]);
    expect(LADDERS.map((l) => l.dialect).sort()).toEqual([...DIALECTS].sort());
  });

  it("is where a streak milestone goes, and nothing else goes there", () => {
    for (const v of VIGNETTES) {
      if (v.ladder) expect(v.moments, v.id).toEqual(["streak"]);
      else expect(v.moments, v.id).not.toContain("streak");
    }
    for (const dialect of DIALECTS) expect(vignettesFor(dialect, "streak"), dialect).toEqual([]);
  });

  it("starts at the first milestone and climbs", () => {
    for (const ladder of LADDERS) {
      const rungs = ladder.ladder!;
      expect(rungs[0].fromDays, ladder.id).toBe(STREAK_MILESTONES[0]);
      for (let i = 1; i < rungs.length; i++) {
        expect(rungs[i].fromDays, ladder.id).toBeGreaterThan(rungs[i - 1].fromDays);
        expect(rungs[i].heat, ladder.id).toBeGreaterThanOrEqual(rungs[i - 1].heat);
      }
      expect(rungs[rungs.length - 1].fromDays, ladder.id).toBeLessThanOrEqual(STREAK_MILESTONES.at(-1)!);
    }
  });

  it("shows only stills the figure has: six, from the coals to the whole lamb", () => {
    for (const ladder of LADDERS) {
      for (const rung of ladder.ladder!) {
        for (const pose of rung.sequence) {
          expect(pose, `${ladder.id} ${rung.fromDays}`).toBeGreaterThanOrEqual(0);
          expect(pose, `${ladder.id} ${rung.fromDays}`).toBeLessThan(6);
        }
      }
    }
  });

  it("tells the same story in every dialect, rung for rung", () => {
    const story = (l: typeof MISHKAK) => l.ladder!.map((r) => [r.fromDays, r.sequence, r.heat, r.says]);
    expect(story(KABABGI)).toEqual(story(MISHKAK));
    expect(story(MADHBI)).toEqual(story(MISHKAK));
  });

  it("opens on the coals and ends at the feast", () => {
    const rungs = MISHKAK.ladder!;
    expect(rungs[0].sequence).toEqual([0]);
    expect(rungs[rungs.length - 1].sequence).toContain(5);
  });

  it("picks the highest rung a streak has reached", () => {
    const rungs = MISHKAK.ladder!;
    expect(rungFor(rungs, 3).rung.fromDays).toBe(3);
    expect(rungFor(rungs, 7).rung.fromDays).toBe(7);
    expect(rungFor(rungs, 14).rung.fromDays).toBe(14);
    expect(rungFor(rungs, 365).rung.fromDays).toBe(365);
    expect(rungFor(rungs, 1000).rung.fromDays).toBe(1000);
    // Before the first rung, the first: the stage is never empty.
    expect(rungFor(rungs, 0).rung.fromDays).toBe(3);
    expect(rungFor(rungs, 1).rung.fromDays).toBe(3);
  });

  it("gives the milestones between rungs a bigger fire than the rung below", () => {
    const rungs = MISHKAK.ladder!;
    const heat = (days: number) => rungFor(rungs, days).heat;
    expect(heat(30)).toBe(3);
    expect(heat(50)).toBe(4);
    expect(heat(100)).toBe(4);
    expect(heat(150)).toBe(5);
    expect(heat(200)).toBe(5);
    expect(heat(365)).toBe(5);
    expect(heat(500)).toBe(5);
  });

  it("never gives a longer streak a smaller fire", () => {
    for (const ladder of LADDERS) {
      let last = 0;
      for (const days of STREAK_MILESTONES) {
        const { heat } = rungFor(ladder.ladder!, days);
        expect(heat, `${ladder.id} ${days}`).toBeGreaterThanOrEqual(last);
        last = heat;
      }
    }
  });

  it("gives every milestone a rung, and the cook's fan two strokes", () => {
    for (const ladder of LADDERS) {
      for (const days of STREAK_MILESTONES) expect(rungFor(ladder.ladder!, days).rung.sequence.length).toBeGreaterThan(0);
      expect(ladder.musicianSequence).toEqual([0, 1]);
      expect(ladder.musicianMs).toBe(FAN_STROKE_MS);
      expect(ladder.beatMs).toBe(LADDER_BEAT_MS);
    }
  });

  it("resolves a streak to the rung's stills, strength and cheer", () => {
    const seven = resolveVignette(MISHKAK, "Gulf", 7);
    expect(seven.sequence).toEqual([1]);
    expect(seven.heat).toBe(2);
    expect(seven.cheers).toBeUndefined();

    const three = resolveVignette(MISHKAK, "Gulf", 3);
    expect(three.sequence).toEqual([0]);
    expect(three.cheers?.map((c) => c.ar)).toEqual(["شبّت النار!"]);

    // The catalogue's own entry is never rewritten.
    expect(MISHKAK.sequence).toEqual([0]);
    expect(MISHKAK.heat).toBeUndefined();
  });

  it("lights the fire only while there is a grill, and steams the dishes once they are on the table", () => {
    for (const days of [3, 7, 14, 30]) {
      expect(resolveVignette(MISHKAK, "Gulf", days).effects, `${days}`).toEqual(["fire", "smoke"]);
    }
    for (const days of [100, 365, 1000]) {
      const scene = resolveVignette(MISHKAK, "Gulf", days);
      expect(scene.effects, `${days}`).toEqual(["steam", "sparkle"]);
      // The steam rises from the dishes, lower in the box than the coals were.
      expect(scene.fxAnchor!.y, `${days}`).toBeGreaterThan(MISHKAK.fxAnchor!.y);
    }
    // And no still without a grill is ever shown with the fire: the table stills are 3, 4 and 5.
    for (const rung of MISHKAK.ladder!.filter((r) => !r.effects)) {
      for (const pose of rung.sequence) expect(pose, `${rung.fromDays}`).toBeLessThan(3);
    }
  });

  it("plays the first rung for a streak whose length is not known", () => {
    expect(resolveVignette(MISHKAK, "Gulf").sequence).toEqual(MISHKAK.ladder![0].sequence);
  });
});

describe("a vignette for the learner's dialect", () => {
  it("takes the learner's dialect when it is made for it, so the frame follows them", () => {
    expect(forDialect(QALAM, "Yemeni").dialect).toBe("Yemeni");
    expect(forDialect(QALAM, "Egyptian").dialect).toBe("Egyptian");
    expect(forDialect(FOOTBALL, "Gulf").dialect).toBe("Gulf");
  });

  it("keeps its own dialect when the learner's is not one it is made for", () => {
    expect(forDialect(MISHKAK, "Yemeni").dialect).toBe("Gulf");
  });

  it("calls a goal what the commentators call it where the learner is", () => {
    expect(forDialect(FOOTBALL, "Gulf").gloss).toBe("Al-Gōl");
    expect(forDialect(FOOTBALL, "Egyptian").gloss).toBe("Al-Gōn");
    expect(forDialect(FOOTBALL, "Egyptian").title).toBe("الجون");
    expect(forDialect(FOOTBALL, "Egyptian").cheers?.[0].ar).toBe("جوووون!");
    expect(forDialect(FOOTBALL, "Gulf").cheers?.[0].ar).toBe("قوووول!");
  });

  it("does not change the catalogue's entry", () => {
    forDialect(FOOTBALL, "Egyptian");
    expect(FOOTBALL.dialect).toBe("Gulf");
    expect(FOOTBALL.title).toBe("القول");
  });
});

describe("which vignettes suit a moment", () => {
  const moments: CelebrationKind[] = ["lesson", "letter", "deck", "goal", "achievement"];

  it("only offers a dialect what is made for it", () => {
    for (const dialect of DIALECTS) {
      for (const moment of moments) {
        for (const v of vignettesFor(dialect, moment)) expect(v.dialects, `${dialect} ${moment} ${v.id}`).toContain(dialect);
      }
    }
  });

  it("gives every dialect a reed pen for a mastered letter", () => {
    for (const dialect of DIALECTS) expect(vignettesFor(dialect, "letter")).toEqual([QALAM]);
  });

  it("gives the daily goal in the Gulf and Egypt a football goal", () => {
    expect(vignettesFor("Gulf", "goal")).toContain(FOOTBALL);
    expect(vignettesFor("Egyptian", "goal")).toContain(FOOTBALL);
    expect(vignettesFor("Yemeni", "goal")).not.toContain(FOOTBALL);
  });

  it("offers nothing for a moment with no scene made for it, so that moment is only ever a dance", () => {
    expect(vignettesFor("Yemeni", "lesson")).toEqual([]);
    expect(vignettesFor("Egyptian", "deck")).toEqual([]);
    expect(vignettesFor("Gulf", "preview")).toEqual([]);
  });
});

describe("what the stage shouts", () => {
  it("never cheers in فصحى, in the dialect it is shouted in", () => {
    for (const v of VIGNETTES) {
      for (const dialect of v.dialects) {
        const scene = resolveVignette(v, dialect, 100);
        for (const cheer of scene.cheers ?? []) {
          expect(detectMsaLeaks(cheer.ar, dialect).leaks, `${v.id} ${dialect}: ${cheer.ar}`).toEqual([]);
        }
        for (const rung of v.ladder ?? []) {
          if (rung.cheer) expect(detectMsaLeaks(rung.cheer.ar, dialect).leaks, `${v.id} ${rung.fromDays}`).toEqual([]);
        }
      }
    }
  });

  it("gives every cheer a transliteration and a translation", () => {
    for (const v of VIGNETTES) {
      const cheers = [...(v.cheers ?? []), ...Object.values(v.localized ?? {}).flatMap((l) => l.cheers ?? []), ...(v.ladder ?? []).flatMap((r) => (r.cheer ? [r.cheer] : []))];
      for (const cheer of cheers) {
        expect(cheer.ar, v.id).toMatch(/[؀-ۿ]/);
        expect(cheer.translit, cheer.ar).toMatch(/[A-Za-z]/);
        expect(cheer.en, cheer.ar).toMatch(/[A-Za-z]/);
      }
    }
  });

  it("is an exclamation, not an address, so it need not guess whether the learner is a man or a woman", () => {
    // The forms that split on gender in these dialects: «-ك/-كي/-چ» as a suffix on a verb or noun.
    const addresses = /(?:عليك|عليكي|عساك|عساچ|مبروكلك|تسلم إيدك)/;
    for (const v of VIGNETTES) {
      for (const cheer of [...(v.cheers ?? []), ...Object.values(v.localized ?? {}).flatMap((l) => l.cheers ?? [])]) {
        expect(cheer.ar, v.id).not.toMatch(addresses);
      }
    }
  });
});

describe("timing", () => {
  it("is a chosen number, named, and not faster than the scene can be read", () => {
    expect(VIGNETTE_BEAT_MS).toBeGreaterThanOrEqual(400);
    for (const v of VIGNETTES) expect(v.beatMs, v.id).toBeGreaterThanOrEqual(400 - 1);
  });
});
