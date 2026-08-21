import { describe, expect, it } from "vitest";
import {
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
