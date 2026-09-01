import { describe, expect, it } from "vitest";
import {
  computeFluencyMetrics,
  estimateSyllables,
  LONG_PAUSE_SEC,
  PAUSE_MIN_SEC,
  type TimedWord,
} from "../../supabase/functions/_shared/fluencyMetricsCore";

/**
 * The measures behind the monologue feature.
 *
 * These numbers are shown to learners as trends and stored for later
 * calibration, so what matters is that they are computed the way the fluency
 * literature defines them: pauses are silences of 250ms or more between words,
 * articulation rate excludes pause time but keeps the sub-threshold gaps
 * inside a run, and repairs are counted but never scored. A metric that
 * silently measured something else would produce plausible-looking trends
 * about nothing.
 */

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });

/**
 * Five words over six seconds with one ordinary pause and one long one:
 *   [مرحبا شباب] .5s [اليوم بروح] 1.1s [السوق]
 * Syllable estimates: 3+2+3+2+3 = 13.
 */
const SAMPLE: TimedWord[] = [
  w("مرحبا", 0.5, 1.0),
  w("شباب", 1.1, 1.5),
  w("اليوم", 2.0, 2.4),
  w("بروح", 2.5, 2.9),
  w("السوق", 4.0, 4.5),
];

describe("syllable estimation", () => {
  it("estimates Arabic words at about a syllable per two letters", () => {
    // مرحبا = mar-ha-ba. The estimate only has to be consistent, but it should
    // land near the truth on ordinary words or the rates drift meaninglessly.
    expect(estimateSyllables("مرحبا")).toBe(3);
    expect(estimateSyllables("لا")).toBe(1);
  });

  it("ignores diacritics rather than counting them as letters", () => {
    expect(estimateSyllables("مَرْحَبًا")).toBe(estimateSyllables("مرحبا"));
  });

  it("counts vowel groups for code-switched English words", () => {
    // Gulf speech is full of English islands; treating "weekend" as one
    // syllable per word would undercount every code-switched take.
    expect(estimateSyllables("weekend")).toBe(2);
    expect(estimateSyllables("ok")).toBe(1);
  });

  it("gives every non-empty word at least one syllable", () => {
    expect(estimateSyllables("hmm")).toBe(1);
    expect(estimateSyllables("  ")).toBe(0);
  });
});

describe("speech and articulation rate", () => {
  it("computes speech rate over the whole recording", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    expect(m.syllableCount).toBe(13);
    expect(m.speechRateSylPerSec).toBeCloseTo(13 / 6, 3);
  });

  it("computes articulation rate over phonation time only", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    // Runs span 1.0 + 0.9 + 0.5 seconds. The 0.1s gaps inside runs are
    // articulation, not hesitation — they stay in the denominator.
    expect(m.phonationTimeSec).toBeCloseTo(2.4, 3);
    expect(m.articulationRateSylPerSec).toBeCloseTo(13 / 2.4, 3);
  });

  it("keeps articulation rate above speech rate whenever there are pauses", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    expect(m.articulationRateSylPerSec!).toBeGreaterThan(m.speechRateSylPerSec!);
  });
});

describe("runs and pauses", () => {
  it("splits runs only at gaps that reach the pause threshold", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    expect(m.runCount).toBe(3);
    expect(m.meanLengthOfRunWords).toBeCloseTo((2 + 2 + 1) / 3, 3);
    expect(m.meanLengthOfRunSyllables).toBeCloseTo((5 + 5 + 3) / 3, 3);
  });

  it("treats a gap just under the threshold as articulation", () => {
    const nearMiss = [w("انا", 0, 0.4), w("رحت", 0.4 + PAUSE_MIN_SEC - 0.01, 1.0)];
    expect(computeFluencyMetrics(nearMiss, 1).pauseCount).toBe(0);
    expect(computeFluencyMetrics(nearMiss, 1).runCount).toBe(1);
  });

  it("inventories every pause with its position, for later location coding", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    // Clause-boundary coding for Arabic doesn't exist yet; the raw gap list is
    // what lets better location measures be re-derived from stored attempts.
    expect(m.gaps).toEqual([
      { afterWord: 1, durationSec: 0.5 },
      { afterWord: 3, durationSec: 1.1 },
    ]);
    expect(m.pauseCount).toBe(2);
    expect(m.pauseTimeSec).toBeCloseTo(1.6, 3);
    expect(m.meanPauseSec).toBeCloseTo(0.8, 3);
    expect(m.pausesPerMinute).toBeCloseTo(20, 3);
  });

  it("flags pauses long enough to read as breakdowns", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    expect(m.longPauseCount).toBe(1);
    expect(m.gaps[1].durationSec).toBeGreaterThanOrEqual(LONG_PAUSE_SEC);
  });

  it("measures lead-in and trailing silence separately from pauses", () => {
    const m = computeFluencyMetrics(SAMPLE, 6);
    // Response latency and stopping early are different behaviours from
    // mid-speech hesitation and must not inflate the pause counts.
    expect(m.initialSilenceSec).toBeCloseTo(0.5, 3);
    expect(m.trailingSilenceSec).toBeCloseTo(1.5, 3);
  });
});

describe("repetitions", () => {
  it("counts an immediately repeated word as one repair", () => {
    const words = [w("انا", 0, 0.3), w("انا", 0.4, 0.7), w("رحت", 0.8, 1.2)];
    expect(computeFluencyMetrics(words, 2).repetitionCount).toBe(1);
  });

  it("matches repetitions across spelling variants ASR invents", () => {
    // ASR may emit أنا then انا for the same stammer; normalisation is what
    // keeps that from hiding the repair.
    const words = [w("أنا", 0, 0.3), w("انا", 0.4, 0.7)];
    expect(computeFluencyMetrics(words, 1).repetitionCount).toBe(1);
  });

  it("does not count a word legitimately reused later", () => {
    const words = [w("زين", 0, 0.3), w("والله", 0.4, 0.8), w("زين", 0.9, 1.2)];
    expect(computeFluencyMetrics(words, 2).repetitionCount).toBe(0);
  });
});

describe("degenerate input", () => {
  it("returns an explicit empty result rather than NaN rates", () => {
    const m = computeFluencyMetrics([], 30);
    expect(m.wordCount).toBe(0);
    expect(m.speechRateSylPerSec).toBeNull();
    expect(m.articulationRateSylPerSec).toBeNull();
    expect(m.meanLengthOfRunWords).toBeNull();
    // A 30s recording with no recognised words is 30s of silence — that is
    // itself the finding, not an error.
    expect(m.initialSilenceSec).toBe(30);
  });

  it("extends the duration to the last word when the reported one is shorter", () => {
    // The client's duration can be missing or wrong; word timings only ever
    // end early, so the longer of the two is the honest denominator.
    const m = computeFluencyMetrics(SAMPLE, 0);
    expect(m.totalDurationSec).toBeCloseTo(4.5, 3);
    expect(m.speechRateSylPerSec).toBeCloseTo(13 / 4.5, 3);
  });

  it("sorts words and clamps negative-length timings before measuring", () => {
    const shuffled = [w("اليوم", 2.0, 2.4), w("مرحبا", 0.5, 1.0), w("بروح", 2.5, 2.49)];
    const m = computeFluencyMetrics(shuffled, 3);
    expect(m.wordCount).toBe(3);
    expect(m.gaps[0]).toEqual({ afterWord: 0, durationSec: 1.0 });
    expect(m.phonationTimeSec).toBeGreaterThan(0);
  });

  it("drops empty tokens some engines emit between words", () => {
    const words = [w("مرحبا", 0, 0.5), w("  ", 0.5, 0.5), w("شباب", 0.6, 1.0)];
    expect(computeFluencyMetrics(words, 1).wordCount).toBe(2);
  });
});
