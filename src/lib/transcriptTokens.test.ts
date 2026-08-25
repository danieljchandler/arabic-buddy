import { describe, expect, it } from "vitest";
import type { TranscriptLine, WordToken } from "@/types/transcript";
import {
  reconcileLineTokens,
  reconcileTranscriptTokens,
  tokensMatchArabic,
} from "./transcriptTokens";

/**
 * The bug these guard against: a line whose `arabic` was corrected but whose
 * `tokens` were not (an edit saved by a build that set only the text). The
 * card and the learner's transcript draw the sentence from tokens, so the
 * correction was visible inside the edit box and "reverted" the moment it
 * closed — and learners were taught words nobody said.
 */

const token = (surface: string, over: Partial<WordToken> = {}): WordToken => ({
  id: `tok-${surface}-${over.gloss ?? ""}`,
  surface,
  ...over,
});

const line = (over: Partial<TranscriptLine>): TranscriptLine => ({
  id: "L1",
  arabic: "",
  translation: "",
  tokens: [],
  ...over,
});

describe("tokensMatchArabic", () => {
  it("accepts tokens that mirror the text word for word", () => {
    expect(
      tokensMatchArabic(line({ arabic: "شلونك اليوم", tokens: [token("شلونك"), token("اليوم")] })),
    ).toBe(true);
  });

  it("rejects tokens holding different words", () => {
    expect(
      tokensMatchArabic(line({ arabic: "شخبارك اليوم", tokens: [token("شلونك"), token("اليوم")] })),
    ).toBe(false);
  });

  it("rejects a count mismatch", () => {
    expect(
      tokensMatchArabic(line({ arabic: "شلونك اليوم صراحة", tokens: [token("شلونك"), token("اليوم")] })),
    ).toBe(false);
  });

  it("does not count tashkeel as a difference", () => {
    // Diacritics are pronunciation markup on the same word — a voweled text
    // over bare tokens (or vice versa) is not staleness, and treating it as
    // such would throw away the glosses of every diacritized line.
    expect(
      tokensMatchArabic(line({ arabic: "شْلُونَك الْيَوْم", tokens: [token("شلونك"), token("اليوم")] })),
    ).toBe(true);
  });

  it("normalizes whitespace rather than trusting it", () => {
    expect(
      tokensMatchArabic(line({ arabic: "  شلونك   اليوم ", tokens: [token("شلونك"), token("اليوم")] })),
    ).toBe(true);
  });
});

describe("reconcileLineTokens", () => {
  it("returns the same object when tokens already mirror the text", () => {
    const healthy = line({ arabic: "شلونك اليوم", tokens: [token("شلونك"), token("اليوم")] });
    expect(reconcileLineTokens(healthy)).toBe(healthy);
  });

  it("rebuilds stale tokens from the corrected Arabic", () => {
    const stale = line({
      arabic: "شخبارك اليوم",
      tokens: [token("شلونك", { gloss: "how are you" }), token("اليوم", { gloss: "today" })],
    });

    const healed = reconcileLineTokens(stale);

    expect(healed.tokens!.map((t) => t.surface)).toEqual(["شخبارك", "اليوم"]);
  });

  it("keeps the gloss and id of a word the edit did not touch", () => {
    const stale = line({
      arabic: "شخبارك اليوم",
      tokens: [token("شلونك", { gloss: "how are you" }), token("اليوم", { gloss: "today" })],
    });

    const healed = reconcileLineTokens(stale);

    // The changed word comes back bare — its old gloss described other words.
    expect(healed.tokens![0].gloss).toBeUndefined();
    // The surviving word keeps its gloss and identity.
    expect(healed.tokens![1].gloss).toBe("today");
    expect(healed.tokens![1].id).toBe(stale.tokens![1].id);
  });

  it("claims each repeated word's token once, in order", () => {
    const stale = line({
      arabic: "في البيت في الصباح دائماً",
      tokens: [
        token("في", { gloss: "in (the house)" }),
        token("البيت", { gloss: "the house" }),
        token("في", { gloss: "in (the morning)" }),
        token("الصباح", { gloss: "the morning" }),
      ],
    });

    const healed = reconcileLineTokens(stale);

    expect(healed.tokens!.map((t) => t.gloss)).toEqual([
      "in (the house)",
      "the house",
      "in (the morning)",
      "the morning",
      undefined,
    ]);
  });

  it("builds tokens for a line that arrived with none", () => {
    const bare = line({ arabic: "شلونك اليوم", tokens: [] });

    expect(reconcileLineTokens(bare).tokens!.map((t) => t.surface)).toEqual([
      "شلونك",
      "اليوم",
    ]);
  });

  it("leaves a line with no Arabic alone", () => {
    const empty = line({ arabic: "", tokens: [token("شلونك")] });
    expect(reconcileLineTokens(empty)).toBe(empty);
  });
});

describe("reconcileTranscriptTokens", () => {
  it("returns the same array when every line is healthy", () => {
    const lines = [line({ arabic: "شلونك", tokens: [token("شلونك")] })];
    expect(reconcileTranscriptTokens(lines)).toBe(lines);
  });

  it("heals only the stale lines", () => {
    const healthy = line({ id: "L1", arabic: "شلونك", tokens: [token("شلونك")] });
    const stale = line({ id: "L2", arabic: "شخبارك", tokens: [token("شلونك")] });

    const healed = reconcileTranscriptTokens([healthy, stale]);

    expect(healed[0]).toBe(healthy);
    expect(healed[1].tokens![0].surface).toBe("شخبارك");
  });
});
