import { describe, expect, it } from "vitest";
import {
  alignLinesToAsrWords,
  type TimedAsrWord,
} from "../../supabase/functions/_shared/transcriptTimingAlign";

/**
 * The alignment pass that replaced proportional allocation in
 * process-approved-video. The property that matters most is the one the old
 * allocator could not have: a pause in the audio stays a pause in the
 * timeline, instead of being smeared across every line and turning into
 * cumulative drift.
 */

const w = (text: string, start: number, end: number): TimedAsrWord => ({ text, start, end });

describe("alignLinesToAsrWords — the happy path", () => {
  // Two greeting lines with a three-and-a-half-second silence between them —
  // the shape of a real clip where somebody nods, laughs, or the camera cuts.
  const words = [
    w("شلونك", 0.5, 1.0),
    w("اليوم", 1.1, 1.6),
    w("الحمد", 5.0, 5.4),
    w("لله", 5.5, 5.8),
    w("بخير", 5.9, 6.4),
  ];

  it("takes line spans from the matched words", () => {
    const out = alignLinesToAsrWords(["شلونك اليوم", "الحمد لله بخير"], words);
    expect(out).not.toBeNull();
    expect(out![0]).toMatchObject({ startMs: 500, endMs: 1600 });
    expect(out![1]).toMatchObject({ startMs: 5000, endMs: 6400 });
  });

  it("preserves the silence between lines instead of smearing it", () => {
    const out = alignLinesToAsrWords(["شلونك اليوم", "الحمد لله بخير"], words)!;
    // Proportional allocation made every line contiguous with the next; the
    // gap here is the whole point of aligning for real.
    expect(out[1].startMs - out[0].endMs).toBe(3400);
  });

  it("returns per-word timings parallel to the whitespace split", () => {
    const out = alignLinesToAsrWords(["شلونك اليوم", "الحمد لله بخير"], words)!;
    expect(out[0].words.map((x) => x.surface)).toEqual(["شلونك", "اليوم"]);
    expect(out[0].words[0]).toMatchObject({ startMs: 500, endMs: 1000, matched: true });
    expect(out[1].words[2]).toMatchObject({ startMs: 5900, endMs: 6400, matched: true });
  });
});

describe("orthography variance", () => {
  it("matches across hamza seats, ta marbuta and diacritics", () => {
    // The merge writes canonical spellings; ASR writes what it heard.
    const out = alignLinesToAsrWords(
      ["أَهلاً مدرسة"],
      [w("اهلا", 1.0, 1.5), w("مدرسه", 1.6, 2.1)],
    )!;
    expect(out[0].words[0]).toMatchObject({ startMs: 1000, endMs: 1500, matched: true });
    expect(out[0].words[1]).toMatchObject({ startMs: 1600, endMs: 2100, matched: true });
  });

  it("matches a near-miss spelling by edit distance", () => {
    const out = alignLinesToAsrWords(
      ["يتكلمون عربي"],
      [w("يتكلمو", 0.0, 0.6), w("عربي", 0.7, 1.1)],
    )!;
    expect(out[0].words[0]).toMatchObject({ startMs: 0, endMs: 600, matched: true });
  });
});

describe("split and merge between the streams", () => {
  it("spans two ASR words when the merge joined them", () => {
    // Written "ياولد", heard as two words.
    const out = alignLinesToAsrWords(
      ["سمعت ياولد هناك"],
      [w("سمعت", 0.0, 0.4), w("يا", 0.5, 0.7), w("ولد", 0.7, 1.0), w("هناك", 1.1, 1.5)],
    )!;
    expect(out[0].words[1]).toMatchObject({ startMs: 500, endMs: 1000, matched: true });
    expect(out[0].words[2]).toMatchObject({ startMs: 1100, endMs: 1500, matched: true });
  });

  it("shares one ASR word across two merged tokens", () => {
    // Written "يا ولد", heard as one token.
    const out = alignLinesToAsrWords(
      ["سمعت يا ولد هناك"],
      [w("سمعت", 0.0, 0.4), w("ياولد", 0.5, 1.0), w("هناك", 1.1, 1.5)],
    )!;
    const [, ya, walad] = out[0].words;
    expect(ya.matched).toBe(true);
    expect(walad.matched).toBe(true);
    expect(ya.startMs).toBe(500);
    expect(walad.endMs).toBe(1000);
    // The word boundary falls inside the shared span, in order.
    expect(ya.endMs).toBe(walad.startMs);
    expect(ya.endMs).toBeGreaterThan(500);
    expect(ya.endMs).toBeLessThan(1000);
  });
});

describe("interpolation", () => {
  it("places a word the ASR never heard between its matched neighbours", () => {
    const out = alignLinesToAsrWords(
      ["شلونك يالغالي اليوم"],
      [w("شلونك", 0.5, 1.0), w("اليوم", 1.4, 1.9)],
    )!;
    const ghali = out[0].words[1];
    expect(ghali.matched).toBe(false);
    expect(ghali.startMs).toBe(1000);
    expect(ghali.endMs).toBe(1400);
  });

  it("extends a trailing unmatched run without passing the audio end", () => {
    const out = alignLinesToAsrWords(
      ["شلونك اليوم الحمد", "زين"],
      [w("شلونك", 0.5, 1.0), w("اليوم", 1.1, 1.6), w("الحمد", 27.5, 28.0)],
      { audioDurationMs: 28_200 },
    )!;
    const lastLine = out[1];
    expect(lastLine.startMs).toBeGreaterThanOrEqual(28_000);
    expect(lastLine.endMs).toBeLessThanOrEqual(28_200);
    expect(lastLine.endMs).toBeGreaterThanOrEqual(lastLine.startMs);
  });

  it("handles repeated words without unique anchors", () => {
    const out = alignLinesToAsrWords(
      ["لا لا لا"],
      [w("لا", 0.0, 0.2), w("لا", 0.3, 0.5), w("لا", 0.6, 0.8)],
    )!;
    expect(out[0].words.map((x) => [x.startMs, x.endMs])).toEqual([
      [0, 200],
      [300, 500],
      [600, 800],
    ]);
  });
});

describe("the trust gate", () => {
  it("rejects an alignment where almost nothing matches", () => {
    expect(
      alignLinesToAsrWords(
        ["شلونك اليوم يا جماعة"],
        [w("مرحبا", 0.0, 0.4)],
      ),
    ).toBeNull();
  });

  it("rejects empty inputs", () => {
    expect(alignLinesToAsrWords([], [w("مرحبا", 0, 1)])).toBeNull();
    expect(alignLinesToAsrWords(["مرحبا"], [])).toBeNull();
    expect(alignLinesToAsrWords(["   "], [w("مرحبا", 0, 1)])).toBeNull();
  });

  it("ignores ASR entries with broken times rather than aligning to them", () => {
    const out = alignLinesToAsrWords(
      ["شلونك اليوم"],
      [
        w("شلونك", Number.NaN, 1.0),
        w("شلونك", 0.5, 1.0),
        w("اليوم", 1.1, 1.6),
      ],
    )!;
    expect(out[0]).toMatchObject({ startMs: 500, endMs: 1600 });
  });
});

describe("timeline invariants", () => {
  it("never lets a line start before the previous one", () => {
    // ASR words that overlap (a real Soniox artefact) must not produce a
    // timeline that runs backwards.
    const out = alignLinesToAsrWords(
      ["شلونك اليوم", "الحمد لله"],
      [
        w("شلونك", 0.5, 1.2),
        w("اليوم", 1.0, 1.6), // overlaps its predecessor
        w("الحمد", 1.5, 2.0),
        w("لله", 2.1, 2.4),
      ],
    )!;
    expect(out[1].startMs).toBeGreaterThanOrEqual(out[0].startMs);
    for (const line of out) {
      expect(line.endMs).toBeGreaterThanOrEqual(line.startMs);
      let prev = -1;
      for (const word of line.words) {
        expect(word.startMs).toBeGreaterThanOrEqual(prev);
        expect(word.endMs).toBeGreaterThanOrEqual(word.startMs);
        prev = word.startMs;
      }
    }
  });

  it("emits integer milliseconds", () => {
    const out = alignLinesToAsrWords(
      ["شلونك اليوم"],
      [w("شلونك", 0.5004, 1.0007), w("اليوم", 1.1003, 1.6009)],
    )!;
    for (const word of out[0].words) {
      expect(Number.isInteger(word.startMs)).toBe(true);
      expect(Number.isInteger(word.endMs)).toBe(true);
    }
  });
});
