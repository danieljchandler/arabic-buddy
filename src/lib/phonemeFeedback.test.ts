import { describe, expect, it } from "vitest";
import { describeWorstSound, FEEDBACK_THRESHOLD, IPA_TO_LETTER, nameSound, worstSound, type AssessedWord } from "./phonemeFeedback";
import { LETTERS_BY_CODE } from "@/data/arabicAlphabet";

/**
 * Feedback must name the sound — the explicit form the evidence favours over
 * a score — and must not name what it cannot: omissions, unscored zeros, and
 * vowels are left alone rather than guessed at.
 */

const word = (over: Partial<AssessedWord> = {}): AssessedWord => ({
  word: "حبيبي",
  accuracy: 62,
  errorType: "Mispronunciation",
  phonemes: [
    { phoneme: "ħ", accuracy: 40, nbest: [{ phoneme: "ħ", accuracy: 40 }, { phoneme: "h", accuracy: 55 }] },
    { phoneme: "a", accuracy: 90 },
    { phoneme: "b", accuracy: 95 },
  ],
  ...over,
});

describe("nameSound", () => {
  it("maps every consonant in the table to a real letter with a hint", () => {
    for (const [ipa, code] of Object.entries(IPA_TO_LETTER)) {
      const named = nameSound(ipa);
      expect(named, ipa).not.toBeNull();
      expect(named!.code).toBe(code);
      expect(named!.hint.length).toBeGreaterThan(0);
      if (code !== "hamza") expect(LETTERS_BY_CODE[code]).toBeDefined();
    }
  });

  it("strips stress marks and length, and leaves vowels unnamed", () => {
    expect(nameSound("ˈħ")?.code).toBe("ha");
    expect(nameSound("aː")).toBeNull();
    expect(nameSound("")).toBeNull();
  });
});

describe("worstSound", () => {
  it("finds the weakest nameable sound and what was heard instead", () => {
    const w = worstSound([word()])!;
    expect(w.word).toBe("حبيبي");
    expect(w.target?.glyph).toBe("ح");
    expect(w.heard?.glyph).toBe("ه");
    expect(w.contrast?.id).toBe("ha-ha_soft");
  });

  it("ignores omitted words and unscored zeros in well-scored words", () => {
    expect(worstSound([word({ errorType: "Omission" })])).toBeNull();
    const zero = word({ accuracy: 85, phonemes: [{ phoneme: "ħ", accuracy: 0 }, { phoneme: "b", accuracy: 90 }] });
    expect(worstSound([zero])).toBeNull();
  });

  it("says nothing when every sound clears the threshold", () => {
    const fine = word({ phonemes: [{ phoneme: "ħ", accuracy: FEEDBACK_THRESHOLD }, { phoneme: "b", accuracy: 99 }] });
    expect(worstSound([fine])).toBeNull();
  });

  it("skips a weak vowel rather than inventing a letter for it", () => {
    const vowel = word({ phonemes: [{ phoneme: "a", accuracy: 20 }, { phoneme: "ħ", accuracy: 65 }] });
    expect(worstSound([vowel])?.target?.glyph).toBe("ح");
  });

  it("links a confusion to the Sound Pairs contrast only when it is one of ours", () => {
    const qk = word({ word: "قلب", phonemes: [{ phoneme: "q", accuracy: 30, nbest: [{ phoneme: "k", accuracy: 60 }] }] });
    expect(worstSound([qk])?.contrast?.id).toBe("qaf-kaf");
    const unrelated = word({ word: "باب", phonemes: [{ phoneme: "b", accuracy: 30, nbest: [{ phoneme: "m", accuracy: 60 }] }] });
    expect(worstSound([unrelated])?.contrast).toBeNull();
  });
});

describe("describeWorstSound", () => {
  it("names the word, the target letter, what was heard, and how it should sound", () => {
    const text = describeWorstSound(worstSound([word()])!);
    expect(text).toContain("حبيبي");
    expect(text).toContain("ح (ḥa)");
    expect(text).toContain("ه (ha)");
    expect(text).toMatch(/throat/);
  });

  it("falls back to 'weakest sound' when nothing else was heard", () => {
    const only = word({ phonemes: [{ phoneme: "ʕ", accuracy: 30 }] });
    expect(describeWorstSound(worstSound([only])!)).toMatch(/was the weakest sound/);
  });
});
