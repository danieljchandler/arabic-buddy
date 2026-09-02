import { describe, expect, it } from "vitest";
import {
  buildItems,
  CONTRASTS,
  CONTRASTS_BY_ID,
  contrastStatus,
  feedbackFor,
  findContrastWords,
  findMinimalPairs,
  MINUTES_PER_CONTRAST,
  normalizeForPairs,
  PROGRAMME_MINUTES,
  programmeStatus,
  RESURFACE_AFTER_DAYS,
  seededRandom,
  type InventoryWord,
} from "./perceptionPairs";

/**
 * Perception training's pure half. The things that must hold are the ones the
 * evidence dictates: every item is identification with an Arabic-script label,
 * pairs are found by the contrast letter alone, the programme has an end, and
 * the feedback names the contrast rather than just ticking.
 */

const w = (id: string, arabic: string, audio = true): InventoryWord => ({
  id,
  arabic,
  english: id,
  audioUrl: audio ? `https://audio/${id}.mp3` : null,
});

const INVENTORY: InventoryWord[] = [
  w("sayf", "سيف"), // sword
  w("sayf2", "صيف"), // summer   — ص/س pair
  w("tin", "تين"), // figs
  w("tin2", "طين"), // clay      — ط/ت pair
  w("qalb", "قلب"), // heart
  w("kalb", "كلب"), // dog       — ق/ك pair
  w("amal", "أمل"), // hope (hamza carrier)
  w("amal2", "عمل"), // work     — ع/ء pair, via the carrier
  w("bayt", "بيت"), // no contrast letter
  w("sabah", "صباح", false), // ص only, no audio
  w("darb", "درب"), // د only
  w("two", "بيت كبير"), // multi-word, never a pair
];

describe("normalizeForPairs", () => {
  it("strips diacritics but keeps the letters that carry a contrast", () => {
    expect(normalizeForPairs("صَيْف")).toBe("صيف");
    expect(normalizeForPairs("طِين")).toBe("طين");
  });

  it("folds every hamza carrier to ء so ع/ء pairs line up", () => {
    expect(normalizeForPairs("أمل")).toBe("ءمل");
    expect(normalizeForPairs("إمل")).toBe("ءمل");
  });
});

describe("findMinimalPairs", () => {
  it("finds a pair by swapping the contrast letter, once, whichever way round", () => {
    const pairs = findMinimalPairs(INVENTORY, CONTRASTS_BY_ID["sad-sin"]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual(["sayf", "sayf2"]);
    expect(pairs[0].position).toBe(0);
  });

  it("finds the ع/ء pair through a hamza carrier", () => {
    const pairs = findMinimalPairs(INVENTORY, CONTRASTS_BY_ID["ayn-hamza"]);
    expect(pairs.map((p) => [p.a.id, p.b.id].sort())).toEqual([["amal", "amal2"]]);
  });

  it("ignores multi-word entries and words with no partner", () => {
    const pairs = findMinimalPairs(INVENTORY, CONTRASTS_BY_ID["dad-dal"]);
    expect(pairs).toEqual([]);
  });

  it("puts fully playable pairs first", () => {
    const words = [...INVENTORY, w("sabr", "سبر"), w("sabr2", "صبر", false)];
    const pairs = findMinimalPairs(words, CONTRASTS_BY_ID["sad-sin"]);
    expect(pairs[0].a.audioUrl && pairs[0].b.audioUrl).toBeTruthy();
    expect(pairs[pairs.length - 1].b.audioUrl ?? pairs[pairs.length - 1].a.audioUrl).toBeTruthy();
  });
});

describe("findContrastWords", () => {
  it("returns words carrying exactly one of the two letters", () => {
    const singles = findContrastWords(INVENTORY, CONTRASTS_BY_ID["dad-dal"]);
    expect(singles.map((s) => s.word.id)).toEqual(["darb"]);
    expect(singles[0].letter).toBe("د");
  });
});

describe("buildItems", () => {
  const contrast = CONTRASTS_BY_ID["sad-sin"];

  it("every item is identification with Arabic-script labels — never same/different, never pictures", () => {
    const items = buildItems(INVENTORY, contrast, { count: 10, seed: 7 });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(["pair", "letter"]).toContain(item.kind);
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      expect(item.options.filter((o) => o.correct)).toHaveLength(1);
      for (const o of item.options) expect(o.label).toMatch(/[ء-ي]/);
    }
  });

  it("prefers minimal-pair items and fills with letter items", () => {
    const items = buildItems(INVENTORY, contrast, { count: 10, seed: 3 });
    expect(items[0].kind).toBe("pair");
    expect(items.some((i) => i.kind === "letter")).toBe(true);
    // The letter item for the ص-only word offers the two contrast letters.
    const letterItem = items.find((i) => i.kind === "letter")!;
    expect(letterItem.options.map((o) => o.label).sort()).toEqual(["س", "ص"]);
  });

  it("is reproducible for a seed and varies across seeds", () => {
    const a = buildItems(INVENTORY, contrast, { seed: 11 });
    const b = buildItems(INVENTORY, contrast, { seed: 11 });
    expect(a).toEqual(b);
    const seeds = [1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(buildItems(INVENTORY, contrast, { seed })));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("returns nothing when the inventory has nothing for the contrast", () => {
    expect(buildItems([w("x", "بيت")], contrast)).toEqual([]);
  });

  it("caps at the requested count", () => {
    expect(buildItems(INVENTORY, contrast, { count: 1 })).toHaveLength(1);
  });
});

describe("feedbackFor", () => {
  it("names both letters and the sound, so the learner knows what to listen for", () => {
    const text = feedbackFor(CONTRASTS_BY_ID["ha-ha_soft"], "ح");
    expect(text).toContain("ح");
    expect(text).toContain("ه");
    expect(text).toMatch(/not/);
    expect(text).toContain(CONTRASTS_BY_ID["ha-ha_soft"].cue);
  });

  it("has a hint for hamza even though it is not one of the 28 letters", () => {
    expect(feedbackFor(CONTRASTS_BY_ID["ayn-hamza"], "ء")).toMatch(/uh-oh/);
  });
});

describe("the programme", () => {
  const NOW = new Date("2026-09-02T12:00:00Z");
  const row = (over: Partial<import("./perceptionPairs").ContrastProgressRow> = {}) => ({
    contrast_id: "sad-sin",
    attempts: 40,
    correct: 30,
    seconds: 0,
    completed_at: null,
    resurfaced_at: null,
    resurface_attempts: 0,
    resurface_correct: 0,
    ...over,
  });

  it("has an end: 400 minutes shared across the contrasts", () => {
    expect(PROGRAMME_MINUTES).toBe(400);
    expect(MINUTES_PER_CONTRAST * CONTRASTS.length).toBeGreaterThanOrEqual(PROGRAMME_MINUTES - CONTRASTS.length);
  });

  it("completes a contrast on minutes, or on an explicit completion", () => {
    expect(contrastStatus("sad-sin", row({ seconds: MINUTES_PER_CONTRAST * 60 }), NOW).complete).toBe(true);
    expect(contrastStatus("sad-sin", row({ completed_at: "2026-08-01T00:00:00Z" }), NOW).complete).toBe(true);
    expect(contrastStatus("sad-sin", row({ seconds: 60 }), NOW).complete).toBe(false);
    expect(contrastStatus("sad-sin", undefined, NOW).accuracy).toBeNull();
  });

  it("asks for a durability check once a completed contrast is old enough, once", () => {
    const old = new Date(NOW.getTime() - (RESURFACE_AFTER_DAYS + 1) * 86_400_000).toISOString();
    expect(contrastStatus("sad-sin", row({ completed_at: old }), NOW).resurfaceDue).toBe(true);
    expect(contrastStatus("sad-sin", row({ completed_at: old, resurfaced_at: NOW.toISOString() }), NOW).resurfaceDue).toBe(false);
    const recent = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
    expect(contrastStatus("sad-sin", row({ completed_at: recent }), NOW).resurfaceDue).toBe(false);
  });

  it("sums the programme without letting one contrast overshoot its share", () => {
    const status = programmeStatus(
      [row({ seconds: MINUTES_PER_CONTRAST * 60 * 3 }), row({ contrast_id: "qaf-kaf", seconds: 600 })],
      NOW,
    );
    expect(status.minutes).toBe(MINUTES_PER_CONTRAST + 10);
    expect(status.contrastsComplete).toBe(1);
    expect(status.contrastsTotal).toBe(CONTRASTS.length);
    expect(status.complete).toBe(false);
  });

  it("seeds a PRNG that is deterministic", () => {
    const a = seededRandom(42); const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
