import { describe, expect, it } from "vitest";
import {
  CAPTION_WEIGHT,
  countTokens,
  DEFAULT_MIN_DIALECT_SCORE,
  matchKeys,
  rankEntries,
  REVIEWED_WEIGHT,
  toFrequencyRows,
  tokenize,
  zipf,
} from "../../supabase/functions/_shared/wordFrequencyCore";

/**
 * The pure half of derive-word-frequency. The counts are what "teach common
 * words first" rests on, so what must hold: provenance weights count, a
 * document is counted once however many lines it has, a vocabulary entry
 * matches through the clitics that hide it, a phrase is ranked by its rarest
 * word, and absence from the corpus is a null rather than a guess.
 */

describe("tokenize", () => {
  it("normalises spelling variants and drops Latin, digits and single letters", () => {
    // normalizeArabic folds ى to ي and drops tashkeel, so أَبْغَى and ابغي count as one word.
    expect(tokenize("أَبْغَى ماي ٢ ok و")).toEqual(["ابغي", "ماي"]);
  });
  it("is empty for nothing", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("countTokens", () => {
  it("weights reviewed transcripts above raw captions", () => {
    const stats = countTokens([
      { text: "شلونك", weight: CAPTION_WEIGHT, doc: "v1" },
      { text: "شلونك", weight: REVIEWED_WEIGHT, doc: "v2" },
    ]);
    expect(stats).toEqual([{ token: "شلونك", count: CAPTION_WEIGHT + REVIEWED_WEIGHT, docCount: 2 }]);
  });

  it("counts a document once no matter how many of its lines carry the word", () => {
    const stats = countTokens([
      { text: "زين زين", weight: 1, doc: "v1" },
      { text: "زين", weight: 1, doc: "v1" },
    ]);
    expect(stats[0]).toMatchObject({ token: "زين", count: 3, docCount: 1 });
  });

  it("orders by weighted count, then by how many documents say it, then token", () => {
    const stats = countTokens([
      { text: "بيت بيت", weight: 1, doc: "a" },
      { text: "ماي", weight: 1, doc: "a" },
      { text: "ماي", weight: 1, doc: "b" },
      { text: "قهوه", weight: 1, doc: "a" },
    ]);
    // بيت and ماي tie on count; ماي is said by two videos, بيت by one.
    expect(stats.map((s) => s.token)).toEqual(["ماي", "بيت", "قهوه"]);
  });

  it("ignores lines with no positive weight", () => {
    expect(countTokens([{ text: "بيت", weight: 0, doc: "a" }])).toEqual([]);
  });
});

describe("zipf", () => {
  it("puts a word that is one in a thousand near 6 and a one-in-a-million near 3", () => {
    expect(zipf(1, 1000)).toBeCloseTo(6, 1);
    expect(zipf(1, 1_000_000)).toBeCloseTo(3, 1);
    expect(zipf(0, 100)).toBe(0);
  });

  it("rows carry dialect and zipf", () => {
    const rows = toFrequencyRows("Gulf", countTokens([{ text: "زين ماي", weight: 1, doc: "a" }]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ dialect: "Gulf" });
    expect(rows[0].zipf).toBeGreaterThan(8);
  });
});

describe("matchKeys", () => {
  it("offers the bare form under the article and the waw", () => {
    expect(matchKeys("البيت")).toEqual(["البيت", "بيت"]);
    expect(matchKeys("وقال")).toEqual(["وقال", "قال"]);
    expect(matchKeys("والبيت")).toEqual(["والبيت", "البيت", "بيت"]);
    expect(matchKeys("بيت")).toEqual(["بيت"]);
  });
});

describe("rankEntries", () => {
  const stats = countTokens([
    { text: "زين زين زين ماي ماي بيت", weight: 1, doc: "a" },
  ]);

  it("ranks 1 for the most frequent word and matches through clitics", () => {
    const ranked = rankEntries(
      [{ id: "z", arabic: "زَين" }, { id: "b", arabic: "البيت" }, { id: "m", arabic: "وماي" }],
      stats,
    );
    expect(ranked).toEqual([
      { id: "z", frequencyRank: 1, matchedToken: "زين" },
      { id: "b", frequencyRank: 3, matchedToken: "بيت" },
      { id: "m", frequencyRank: 2, matchedToken: "ماي" },
    ]);
  });

  it("ranks a phrase by its rarest word", () => {
    const [ranked] = rankEntries([{ id: "p", arabic: "زين بيت" }], stats);
    expect(ranked.frequencyRank).toBe(3);
    expect(ranked.matchedToken).toBe("بيت");
  });

  it("gives null to an entry the corpus never says — no guessing", () => {
    expect(rankEntries([{ id: "x", arabic: "نافذة" }], stats)[0]).toEqual({ id: "x", frequencyRank: null, matchedToken: null });
    expect(rankEntries([{ id: "y", arabic: "زين نافذة" }], stats)[0].frequencyRank).toBeNull();
    expect(rankEntries([{ id: "e", arabic: "" }], stats)[0].frequencyRank).toBeNull();
  });

  it("filters by measured dialectness, with a stated default", () => {
    expect(DEFAULT_MIN_DIALECT_SCORE).toBeGreaterThan(0);
    expect(DEFAULT_MIN_DIALECT_SCORE).toBeLessThan(1);
  });
});
