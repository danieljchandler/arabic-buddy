import { describe, expect, it } from "vitest";
import { attemptPoint, MIN_TOKENS, summarize, WINDOW } from "./productiveVocabulary";

const attempt = (transcript: string, day: number) => ({
  transcript,
  created_at: new Date(Date.UTC(2026, 7, day, 12)).toISOString(),
});

describe("attemptPoint", () => {
  it("counts types and tokens with the app's own tokeniser", () => {
    const p = attemptPoint(attempt("انا رحت السوق و رحت البيت و شفت صديقي و شفت اخوي", 1))!;
    expect(p.tokens).toBeGreaterThanOrEqual(MIN_TOKENS);
    expect(p.types).toBeLessThan(p.tokens);
    expect(p.typeTokenRatio).toBeCloseTo(p.types / p.tokens);
  });

  it("returns null for an attempt too short to say anything", () => {
    expect(attemptPoint(attempt("مرحبا", 1))).toBeNull();
    expect(attemptPoint(attempt("", 1))).toBeNull();
    expect(attemptPoint({ transcript: null, created_at: "2026-08-01T00:00:00Z" })).toBeNull();
  });
});

describe("summarize", () => {
  const words = ["بيت", "سوق", "قهوه", "مدرسه", "شارع", "سياره", "كتاب", "باب", "شباك", "طاوله", "كرسي", "حديقه"];
  const speech = (n: number) => words.slice(0, n).concat(words.slice(0, Math.max(0, MIN_TOKENS - n))).join(" ");

  it("orders points in time and grows the cumulative vocabulary", () => {
    const s = summarize([attempt(speech(6), 5), attempt(speech(10), 1)]);
    expect(s.points.map((p) => p.at < s.points[1].at)).toEqual([true, false]);
    expect(s.cumulativeTypes).toBe(10);
  });

  it("compares the latest window with the one before it, only once both exist", () => {
    const few = summarize(Array.from({ length: WINDOW }, (_, i) => attempt(speech(8), i + 1)));
    expect(few.recentMeanTypes).toBeCloseTo(8);
    expect(few.previousMeanTypes).toBeNull();

    const many = summarize([
      ...Array.from({ length: WINDOW }, (_, i) => attempt(speech(6), i + 1)),
      ...Array.from({ length: WINDOW }, (_, i) => attempt(speech(10), i + 10)),
    ]);
    expect(many.previousMeanTypes).toBeCloseTo(6);
    expect(many.recentMeanTypes).toBeCloseTo(10);
  });

  it("is empty for nothing", () => {
    expect(summarize([])).toEqual({ points: [], cumulativeTypes: 0, recentMeanTypes: null, previousMeanTypes: null });
  });
});
