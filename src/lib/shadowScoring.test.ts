import { describe, expect, it } from "vitest";
import {
  repsComplete,
  shadowOverall,
  TRANSCRIPT_ONLY_CEILING,
  wordsScore,
} from "./shadowScoring";

/**
 * Why a word-perfect shadowing take is not automatically a hundred.
 *
 * Speech recognition writes down real words whatever it actually hears. Say a
 * word badly enough that no person would understand it and the recogniser will
 * still usually produce the word the learner meant, the edit distance against
 * the clip's transcript comes out at zero, and the score reads 100 for a take
 * that was not close. The transcript proves the learner picked the right words;
 * only the acoustic comparison speaks to how they said them.
 */

describe("wordsScore", () => {
  it("never reorders two takes", () => {
    let previous = -1;
    for (let raw = 0; raw <= 100; raw++) {
      const value = wordsScore(raw);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("stops short of the top even on a perfect transcript", () => {
    // The whole point. A perfect transcript is evidence about word choice, and
    // word choice alone is not a perfect take.
    expect(wordsScore(100)).toBeLessThan(100);
    expect(wordsScore(100)).toBeGreaterThan(90);
  });

  it("treats one wrong letter as a real miss rather than a rounding error", () => {
    // On a short phrase 0.9 similarity is a whole letter wrong, which the raw
    // number presented as "nearly perfect".
    expect(wordsScore(90)).toBeLessThan(82);
  });

  it("does not crush a take that got most of the words", () => {
    expect(wordsScore(70)).toBeGreaterThan(45);
  });

  it("clamps nonsense rather than propagating it", () => {
    expect(wordsScore(-10)).toBe(0);
    expect(wordsScore(150)).toBe(96);
    expect(wordsScore(Number.NaN)).toBe(0);
  });
});

describe("shadowOverall", () => {
  it("weights the words the learner chose above how they sounded", () => {
    // Saying the wrong words is a bigger failure than saying the right ones
    // unmusically, and the acoustic comparison is the noisier of the two
    // signals — the learner's voice is not the clip speaker's voice.
    expect(shadowOverall(90, 60)).toBeGreaterThan(shadowOverall(60, 90));
  });

  it("caps a take with no clip audio to compare against", () => {
    // Plenty of clips cannot be downloaded — embeds, region locks — and the
    // exercise still has to work. But with nothing to compare the sound to,
    // the score cannot claim the top of the scale.
    expect(shadowOverall(96, null)).toBe(TRANSCRIPT_ONLY_CEILING);
    expect(shadowOverall(100, null)).toBe(TRANSCRIPT_ONLY_CEILING);
  });

  it("leaves a middling transcript-only take below the cap", () => {
    // The cap is a ceiling, not a floor: it must not quietly promote a take
    // that scored under it.
    expect(shadowOverall(55, null)).toBe(55);
  });

  it("rewards a take that matched the clip on both signals", () => {
    expect(shadowOverall(96, 92)).toBeGreaterThan(90);
  });
});

describe("the repetition policy", () => {
  it("keeps a clip going through the early reps", () => {
    expect(repsComplete([])).toBe(false);
    expect(repsComplete([60])).toBe(false);
    expect(repsComplete([60, 70])).toBe(false);
  });

  it("finishes a clip at the target rep count regardless of trend", () => {
    // Still improving at five — but five is where the literature says gains
    // plateau, and holding a learner longer trades progress for boredom.
    expect(repsComplete([50, 55, 60, 65, 70])).toBe(true);
  });

  it("finishes early once the takes stop improving", () => {
    // The third take failed to beat the best earlier one: more reps of this
    // clip are not helping.
    expect(repsComplete([60, 75, 72])).toBe(true);
    expect(repsComplete([60, 75, 75])).toBe(true);
  });

  it("keeps going while every take beats the best before it", () => {
    expect(repsComplete([60, 68, 74])).toBe(false);
    expect(repsComplete([60, 68, 74, 80])).toBe(false);
  });
});
