import { describe, expect, it } from "vitest";
import { gradeDictation } from "./dictation";

/**
 * Dictation grading — the check that used to be a strict `===`.
 *
 * The cases here are the legitimate spelling variants that made correct
 * answers read as wrong: harakat the learner didn't type, hamza-carrier and
 * ى/ة variants, and punctuation the recording never spoke. Plus the
 * word-level marking that lets the result panel say *which* word missed.
 */

describe("gradeDictation", () => {
  it("accepts the exact sentence", () => {
    const grade = gradeDictation("شفت الأسعار اليوم", "شفت الأسعار اليوم");
    expect(grade.correct).toBe(true);
    expect(grade.words.every((w) => w.ok)).toBe(true);
  });

  it("accepts an answer typed without harakat", () => {
    expect(gradeDictation("بيت", "بَيْت").correct).toBe(true);
  });

  it("accepts hamza-carrier, ى and ة spelling variants", () => {
    expect(gradeDictation("اكل", "أكل").correct).toBe(true);
    expect(gradeDictation("مستشفي", "مستشفى").correct).toBe(true);
    expect(gradeDictation("مدرسه", "مدرسة").correct).toBe(true);
  });

  it("ignores punctuation on either side", () => {
    expect(gradeDictation("شفت الاسعار اليوم", "شفت الأسعار اليوم؟").correct).toBe(true);
    expect(gradeDictation("«شفت» الاسعار، اليوم!", "شفت الأسعار اليوم").correct).toBe(true);
  });

  it("still rejects a genuinely different word", () => {
    const grade = gradeDictation("شفت البيت اليوم", "شفت الأسعار اليوم");
    expect(grade.correct).toBe(false);
  });

  it("marks only the missed word, not everything after it", () => {
    const grade = gradeDictation("شفت اليوم", "شفت الأسعار اليوم");
    expect(grade.correct).toBe(false);
    expect(grade.words.map((w) => w.ok)).toEqual([true, false, true]);
  });

  it("keeps the target's own spelling for display", () => {
    const grade = gradeDictation("بيت", "بَيْت");
    expect(grade.words[0].word).toBe("بَيْت");
  });

  it("rejects extra words even when every target word matches", () => {
    const grade = gradeDictation("شفت الأسعار اليوم مرة", "شفت الأسعار اليوم");
    expect(grade.correct).toBe(false);
    expect(grade.words.every((w) => w.ok)).toBe(true);
  });

  it("rejects an empty answer without marking anything right", () => {
    const grade = gradeDictation("", "شفت الأسعار");
    expect(grade.correct).toBe(false);
    expect(grade.words.every((w) => !w.ok)).toBe(true);
  });
});
