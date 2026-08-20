import { describe, expect, it } from "vitest";
import { findWordSpan, normalizeArabicWord, sentenceHasWord } from "./arabicWord";

/**
 * Word-level Arabic matching — the folding every in-text lookup goes
 * through. The cases are the real spelling splits: AI enrichment saves
 * vocalized forms (بَيْت) while transcripts are bare, hamza carriers and
 * ى/ة vary by writer, and tokens carry sentence punctuation.
 */

describe("normalizeArabicWord", () => {
  it("folds harakat, hamza carriers, ى and ة, and strips punctuation", () => {
    expect(normalizeArabicWord("بَيْت")).toBe(normalizeArabicWord("بيت"));
    expect(normalizeArabicWord("أكل")).toBe(normalizeArabicWord("اكل"));
    expect(normalizeArabicWord("مستشفى")).toBe(normalizeArabicWord("مستشفي"));
    expect(normalizeArabicWord("مدرسة،")).toBe(normalizeArabicWord("مدرسه"));
  });
});

describe("sentenceHasWord", () => {
  it("finds a vocalized saved word in a bare sentence", () => {
    expect(sentenceHasWord("رحت البيت أمس", "بَيْت")).toBe(false); // البيت ≠ بيت: whole tokens only
    expect(sentenceHasWord("عندي بيت كبير", "بَيْت")).toBe(true);
  });

  it("matches through attached punctuation", () => {
    expect(sentenceHasWord("وين رايح؟ البيت،", "البيت")).toBe(true);
  });

  it("rejects empty inputs", () => {
    expect(sentenceHasWord("", "بيت")).toBe(false);
    expect(sentenceHasWord("عندي بيت", "")).toBe(false);
  });
});

describe("findWordSpan", () => {
  it("spans the word itself, leaving attached punctuation in place", () => {
    const sentence = "وش رايك نروح البر، بكرة؟";
    const span = findWordSpan(sentence, "البر")!;
    expect(sentence.slice(span.start, span.end)).toBe("البر");
    // Blanking the span keeps the sentence's own comma.
    expect(sentence.slice(0, span.start) + "…" + sentence.slice(span.end)).toBe(
      "وش رايك نروح …، بكرة؟",
    );
  });

  it("finds a bare occurrence of a vocalized word", () => {
    const sentence = "عندي بيت كبير";
    const span = findWordSpan(sentence, "بَيْت")!;
    expect(sentence.slice(span.start, span.end)).toBe("بيت");
  });

  it("returns null when the word is genuinely absent", () => {
    expect(findWordSpan("عندي بيت كبير", "مدرسة")).toBeNull();
  });
});
