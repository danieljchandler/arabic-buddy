import { describe, expect, it } from "vitest";
import {
  buildKnownTokenSet,
  contentComprehension,
  textComprehension,
  comprehensionBand,
  comprehensionBarClass,
  comprehensionLabel,
  MIN_TOKENS,
  tokenizeArabic,
  transcriptComprehension,
} from "./comprehension";

/**
 * The comprehension shelf's arithmetic. The stakes: this number tells a
 * learner whether a video is a comfortable read or a wall, so it must not be
 * inflated (function words already carry it upward by design) and must refuse
 * to guess when the transcript is too small to measure.
 */

const line = (arabic: string) => ({ arabic, translation: "…" });

/** Enough filler lines of knowable text to clear MIN_TOKENS. */
function filler(known: string, count: number) {
  return Array.from({ length: count }, () => line(known));
}

describe("tokenizeArabic", () => {
  it("splits on punctuation and drops Latin, digits and single letters", () => {
    expect(tokenizeArabic("وش تبي، يا 123 friend؟")).toEqual(["وش", "تبي", "يا"]);
  });

  it("normalizes spelling variants so deck and transcript compare equal", () => {
    // alef variants and ta-marbuta fold together (msaLeakDetector rules).
    expect(tokenizeArabic("أكلة")).toEqual(tokenizeArabic("اكله"));
  });

  it("returns nothing for empty or non-Arabic text", () => {
    expect(tokenizeArabic("")).toEqual([]);
    expect(tokenizeArabic("English only")).toEqual([]);
  });
});

describe("buildKnownTokenSet", () => {
  it("contributes every content token of a saved phrase", () => {
    const known = buildKnownTokenSet(["وش تبي تسوي"]);
    expect(known.has(tokenizeArabic("تسوي")[0])).toBe(true);
    expect(known.size).toBe(3);
  });

  it("skips null and empty entries", () => {
    expect(buildKnownTokenSet([null, undefined, ""]).size).toBe(0);
  });
});

describe("transcriptComprehension", () => {
  it("counts saved words and dialect function words as known", () => {
    // كبسه saved; وش/تبي are not Gulf ALWAYS_ALLOWED function words… تبي is
    // not, وش is not — انا/في are. Build a line that isolates the cases.
    const known = buildKnownTokenSet(["كبسه"]);
    const lines = filler("كبسه", MIN_TOKENS).concat([line("مطعم")]); // 20 known + 1 unknown
    const result = transcriptComprehension(lines, known, "Gulf")!;

    expect(result.totalTokens).toBe(MIN_TOKENS + 1);
    expect(result.unknownTokens).toBe(1);
    expect(result.coverage).toBeCloseTo(MIN_TOKENS / (MIN_TOKENS + 1), 5);
  });

  it("treats function words as known so beginners aren't shown 5% everywhere", () => {
    const lines = filler("انا في البيت", 10); // all Gulf function words / allowed
    const result = transcriptComprehension(lines, new Set(), "Gulf")!;
    expect(result.coverage).toBe(1);
  });

  it("sees through the definite article and the waw prefix", () => {
    const known = buildKnownTokenSet(["بيت", "قال"]);
    // البيت → بيت, وقال → قال: the two clitics that most often hide a known word.
    const lines = filler("البيت وقال", MIN_TOKENS / 2);
    const result = transcriptComprehension(lines, known, "Gulf")!;
    expect(result.unknownTokens).toBe(0);
  });

  it("refuses to score a transcript below the token floor", () => {
    expect(transcriptComprehension([line("كلمه وحده")], new Set(), "Gulf")).toBeNull();
  });

  it("returns null for a missing or empty transcript", () => {
    expect(transcriptComprehension(null, new Set(), "Gulf")).toBeNull();
    expect(transcriptComprehension([], new Set(), "Gulf")).toBeNull();
    expect(transcriptComprehension("not lines", new Set(), "Gulf")).toBeNull();
  });

  it("skips malformed lines rather than crashing on them", () => {
    const lines = [null, { arabic: 42 }, ...filler("انا في البيت", 10)];
    expect(transcriptComprehension(lines, new Set(), "Gulf")).not.toBeNull();
  });

  it("falls back to the Gulf function-word list for a regional dialect label", () => {
    const lines = filler("انا في البيت", 10);
    const result = transcriptComprehension(lines, new Set(), "Saudi")!;
    expect(result.coverage).toBe(1);
  });
});

describe("the bands", () => {
  it("splits at the i+1 boundaries", () => {
    expect(comprehensionBand(0.95)).toBe("comfortable");
    expect(comprehensionBand(0.9)).toBe("comfortable");
    expect(comprehensionBand(0.89)).toBe("stretch");
    expect(comprehensionBand(0.7)).toBe("stretch");
    expect(comprehensionBand(0.69)).toBe("challenge");
  });

  it("gives every band a bar class and a label", () => {
    for (const band of ["comfortable", "stretch", "challenge"] as const) {
      expect(comprehensionBarClass(band)).toMatch(/^bg-/);
      expect(comprehensionLabel(band).length).toBeGreaterThan(0);
    }
  });
});

describe("prose bodies", () => {
  // The Reading Library stores one Arabic string per story rather than the
  // line array a transcript uses, and it must land on the same number.
  const known = buildKnownTokenSet(["كبسه", "مطعم", "قهوه"]);

  it("measures a story body the same way a transcript is measured", () => {
    const body = "كبسه مطعم قهوه ".repeat(10);
    const lines = Array.from({ length: 10 }, () => ({ arabic: "كبسه مطعم قهوه" }));

    const fromText = textComprehension(body, known, "Gulf");
    const fromLines = transcriptComprehension(lines, known, "Gulf");

    expect(fromText).not.toBeNull();
    expect(fromText!.coverage).toBe(fromLines!.coverage);
    expect(fromText!.totalTokens).toBe(fromLines!.totalTokens);
  });

  it("counts the unknown words in a body", () => {
    const body = "كبسه مطعم قهوه غامض ".repeat(10);
    const result = textComprehension(body, known, "Gulf");
    expect(result!.unknownTokens).toBe(10);
    expect(result!.coverage).toBeCloseTo(0.75, 5);
  });

  it("declines to score a body with nothing usable in it", () => {
    expect(textComprehension(null, known, "Gulf")).toBeNull();
    expect(textComprehension("", known, "Gulf")).toBeNull();
    expect(textComprehension("   ", known, "Gulf")).toBeNull();
    // Under MIN_TOKENS a percentage is noise, not signal.
    expect(textComprehension("كبسه مطعم", known, "Gulf")).toBeNull();
  });
});

describe("contentComprehension dispatch", () => {
  const known = buildKnownTokenSet(["كبسه", "مطعم", "قهوه"]);

  it("routes a string to the prose path and an array to the line path", () => {
    const body = "كبسه مطعم قهوه ".repeat(10);
    const lines = Array.from({ length: 10 }, () => ({ arabic: "كبسه مطعم قهوه" }));

    expect(contentComprehension(body, known, "Gulf")).toEqual(
      textComprehension(body, known, "Gulf"),
    );
    expect(contentComprehension(lines, known, "Gulf")).toEqual(
      transcriptComprehension(lines, known, "Gulf"),
    );
  });

  it("returns null for anything it cannot read", () => {
    expect(contentComprehension(undefined, known, "Gulf")).toBeNull();
    expect(contentComprehension(42, known, "Gulf")).toBeNull();
  });
});
