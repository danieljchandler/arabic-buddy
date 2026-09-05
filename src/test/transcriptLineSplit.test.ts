import { describe, expect, it } from "vitest";
import {
  chooseLineBreaks,
  DEFAULT_MAX_WORDS,
  splitOverlongLines,
  type SplittableLine,
  type SplittableWord,
} from "../../supabase/functions/_shared/transcriptLineSplit";

/**
 * The pass that turns a one-chunk transcript back into subtitle lines.
 *
 * The analyser's merge can fail and fall back to splitting raw ASR text on
 * punctuation Arabic ASR does not produce, so a whole clip lands as one line.
 * With real per-word timings the right boundaries are not a guess: the
 * speaker's pauses are where captions should break. What matters most here is
 * that a pause beats every other cue, that a sensible line is never touched,
 * and that a piece carries nothing that described its parent's whole wording.
 */

/** Words spoken back to back, `gapMs` of silence before the ones named in `pauses`. */
function spoken(
  surfaces: string[],
  pauses: Record<number, number> = {},
  wordMs = 300,
): SplittableWord[] {
  let at = 0;
  return surfaces.map((surface, i) => {
    at += pauses[i] ?? 60;
    const startMs = at;
    at += wordMs;
    return { surface, startMs, endMs: at, matched: true };
  });
}

const twentyWords = [
  "شلونك", "اليوم", "الحمد", "لله", "بخير", "وانت", "شخبارك", "والله", "زين",
  "الحين", "وين", "رايح", "بروح", "السوق", "اشتري", "اغراض", "للبيت", "طيب",
  "الله", "يوفقك",
];

describe("chooseLineBreaks", () => {
  it("leaves a line within the cap alone, even across a long pause", () => {
    const words = spoken(twentyWords.slice(0, 8), { 4: 3_000 });
    expect(chooseLineBreaks(words)).toEqual([]);
  });

  it("breaks an over-long line at its biggest pauses", () => {
    // Two clear silences: after بخير (index 5 starts late) and after رايح.
    const words = spoken(twentyWords, { 5: 1_400, 12: 900 });
    const breaks = chooseLineBreaks(words);
    expect(breaks).toContain(5);
    expect(breaks).toContain(12);
  });

  it("splits at any silence a second or longer once the line is being split", () => {
    // 16 words, one long pause early — the tail piece is short, but a caption
    // must not sit on screen through 1.5s of nothing.
    const words = spoken(twentyWords.slice(0, 16), { 2: 1_500 });
    const breaks = chooseLineBreaks(words);
    expect(breaks[0]).toBe(2);
  });

  it("prefers a clause opener when the speaker never paused", () => {
    // No silences at all; يعني at index 9 is where a listener would break.
    const surfaces = [
      "انا", "رحت", "امس", "للسوق", "مع", "اخوي", "الصغير", "بعد", "الظهر",
      "يعني", "كان", "الجو", "حار", "مره", "وما", "لقينا", "شي",
    ];
    const breaks = chooseLineBreaks(spoken(surfaces, {}, 250));
    expect(breaks).toEqual([9]);
  });

  it("prefers a punctuation mark over a bare conjunction", () => {
    const surfaces = [
      "انا", "رحت", "امس", "للسوق", "مع", "اخوي.", "الصغير", "بعد", "الظهر",
      "وكان", "الجو", "حار", "مره", "وما", "لقينا", "شي",
    ];
    const breaks = chooseLineBreaks(spoken(surfaces, {}, 250));
    expect(breaks).toEqual([6]);
  });

  it("never leaves a piece over the cap, whatever the timings", () => {
    const surfaces = Array.from({ length: 61 }, (_, i) => `كلمة${i}`);
    const pauses: Record<number, number> = {};
    for (let i = 1; i < surfaces.length; i++) pauses[i] = (i * 37) % 200; // no real silence
    const breaks = chooseLineBreaks(spoken(surfaces, pauses));
    const bounds = [0, ...breaks, surfaces.length];
    for (let i = 0; i + 1 < bounds.length; i++) {
      expect(bounds[i + 1] - bounds[i]).toBeLessThanOrEqual(DEFAULT_MAX_WORDS);
      expect(bounds[i + 1] - bounds[i]).toBeGreaterThanOrEqual(3);
    }
  });

  it("honours a smaller cap", () => {
    const breaks = chooseLineBreaks(spoken(twentyWords), { maxWords: 6 });
    const bounds = [0, ...breaks, twentyWords.length];
    for (let i = 0; i + 1 < bounds.length; i++) {
      expect(bounds[i + 1] - bounds[i]).toBeLessThanOrEqual(6);
    }
  });

  it("works without timings, on text alone", () => {
    const words = twentyWords.map((surface) => ({ surface, startMs: Number.NaN, endMs: Number.NaN }));
    const breaks = chooseLineBreaks(words);
    expect(breaks.length).toBeGreaterThan(0);
    const bounds = [0, ...breaks, twentyWords.length];
    for (let i = 0; i + 1 < bounds.length; i++) {
      expect(bounds[i + 1] - bounds[i]).toBeLessThanOrEqual(DEFAULT_MAX_WORDS);
    }
  });
});

describe("splitOverlongLines", () => {
  const chunkWords = spoken(twentyWords, { 5: 1_400, 12: 900 });
  const chunkTokens = twentyWords.map((surface, i) => ({ id: `tok-${i}`, surface, gloss: `g${i}` }));
  const chunk: SplittableLine = {
    id: "line-1",
    arabic: twentyWords.join(" "),
    translation: "How are you today, fine thanks, where are you off to…",
    literal: "what-condition-your today…",
    fusha: "كيف حالك اليوم",
    segmentType: "audio",
    startMs: chunkWords[0].startMs,
    endMs: chunkWords[chunkWords.length - 1].endMs,
    words: chunkWords,
    tokens: chunkTokens,
  };
  const short: SplittableLine = {
    id: "line-2",
    arabic: "الله يوفقك",
    translation: "God grant you success",
    startMs: 9_000,
    endMs: 9_800,
  };

  it("returns a sensible line as the very same object", () => {
    const { lines, splits } = splitOverlongLines([short]);
    expect(lines[0]).toBe(short);
    expect(splits).toEqual([]);
  });

  it("splits the chunk at its pauses and reports what it did", () => {
    const { lines, splits } = splitOverlongLines([chunk, short]);
    expect(lines.map((l) => l.arabic)).toEqual([
      twentyWords.slice(0, 5).join(" "),
      twentyWords.slice(5, 12).join(" "),
      twentyWords.slice(12).join(" "),
      short.arabic,
    ]);
    expect(lines.map((l) => l.id)).toEqual(["line-1-1", "line-1-2", "line-1-3", "line-2"]);
    expect(splits).toEqual([{ parentId: "line-1", pieceIds: ["line-1-1", "line-1-2", "line-1-3"] }]);
  });

  it("times each piece from its own words and keeps the silence between them", () => {
    const { lines } = splitOverlongLines([chunk]);
    expect(lines[0].startMs).toBe(chunkWords[0].startMs);
    expect(lines[0].endMs).toBe(chunkWords[4].endMs);
    expect(lines[1].startMs).toBe(chunkWords[5].startMs);
    expect(lines[1].startMs! - lines[0].endMs!).toBe(1_400);
    expect(lines[2].endMs).toBe(chunkWords[19].endMs);
    expect(lines[1].words).toEqual(chunkWords.slice(5, 12));
  });

  it("hands each piece its own share of the parent's tokens, glosses intact", () => {
    const { lines } = splitOverlongLines([chunk]);
    expect(lines[1].tokens).toEqual(chunkTokens.slice(5, 12));
  });

  it("carries nothing that described the parent's whole wording", () => {
    const { lines } = splitOverlongLines([chunk]);
    for (const piece of lines) {
      expect(piece.translation).toBe("");
      expect(piece.needs_review).toBe(true);
      expect(piece.review_reason).toBe("empty");
      expect(piece).not.toHaveProperty("literal");
      expect(piece).not.toHaveProperty("fusha");
      expect(piece.segmentType).toBe("audio");
    }
  });

  it("places the pieces of a line whose word timings went stale, without inventing per-word times", () => {
    // Edited since alignment: 20 words of text, 3 stored timings.
    const stale: SplittableLine = { ...chunk, words: chunkWords.slice(0, 3), startMs: 1_000, endMs: 11_000 };
    const { lines } = splitOverlongLines([stale]);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].startMs).toBe(1_000);
    expect(lines[lines.length - 1].endMs).toBe(11_000);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startMs).toBe(lines[i - 1].endMs);
    }
    for (const piece of lines) expect(piece).not.toHaveProperty("words");
  });

  it("still splits a line that has no timing at all, leaving the pieces untimed", () => {
    const { lines } = splitOverlongLines<SplittableLine>([{ id: "raw", arabic: twentyWords.join(" ") }]);
    expect(lines.length).toBeGreaterThan(1);
    for (const piece of lines) {
      expect(piece).not.toHaveProperty("startMs");
      expect(piece).not.toHaveProperty("words");
      const tokens = piece.tokens as Array<{ surface: string }>;
      expect(tokens.map((t) => t.surface)).toEqual(piece.arabic!.split(" "));
    }
    expect(lines.map((l) => l.arabic).join(" ")).toBe(twentyWords.join(" "));
  });

  it("mints ids the way the caller asks", () => {
    const { lines } = splitOverlongLines([chunk], { pieceId: (p, n) => `${p.id}~${n}` });
    expect(lines[0].id).toBe("line-1~1");
  });

  it("tolerates junk in the array", () => {
    const { lines } = splitOverlongLines([null as unknown as SplittableLine, short]);
    expect(lines).toEqual([null, short]);
  });
});
