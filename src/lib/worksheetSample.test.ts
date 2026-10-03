import { describe, expect, it } from "vitest";
import { isPrintable } from "../../supabase/functions/_shared/worksheetCore";
import { SAMPLE_WORKSHEET, SAMPLE_WORDS } from "./worksheetSample";

/**
 * The sample worksheet behind /print/worksheet?sample=1 is the fixture the
 * print check runs on, so it has to stay a complete worksheet that exercises
 * what breaks Arabic printing. If the assembler starts dropping part of it,
 * the print check silently stops covering that part; these fail first.
 */

const HARAKAT = /[\u064B-\u0652]/;
const ARABIC_THEN_DIGIT = /[\u0600-\u06FF][^\n]*\d|\d[^\n]*[\u0600-\u06FF]/;

describe("SAMPLE_WORKSHEET", () => {
  it("assembles every component with nothing dropped", () => {
    expect(SAMPLE_WORKSHEET.dropped).toEqual([]);
    expect(SAMPLE_WORKSHEET.sections.map((s) => s.kind)).toEqual([
      "matching",
      "cloze",
      "dialogue",
      "spot_the_fusha",
      "writing",
    ]);
    expect(isPrintable(SAMPLE_WORKSHEET)).toBe(true);
  });

  it("carries harakat, and Western digits inside Arabic lines, for the print check to look at", () => {
    expect(SAMPLE_WORKSHEET.title.arabic).toMatch(HARAKAT);
    expect(SAMPLE_WORDS.filter((w) => HARAKAT.test(w.arabic)).length).toBeGreaterThan(3);

    const cloze = SAMPLE_WORKSHEET.sections.find((s) => s.kind === "cloze");
    const dialogue = SAMPLE_WORKSHEET.sections.find((s) => s.kind === "dialogue");
    if (cloze?.kind !== "cloze" || dialogue?.kind !== "dialogue") throw new Error("sample lost a section");
    expect(cloze.items.some((i) => ARABIC_THEN_DIGIT.test(`${i.before} ${i.after}`))).toBe(true);
    expect(dialogue.lines.some((l) => ARABIC_THEN_DIGIT.test(l.before))).toBe(true);
    // A blank at the start of a line, not only mid-sentence.
    expect(dialogue.lines.some((l) => l.answer !== null && l.before === "")).toBe(true);
  });

  it("prints the learner's vocalised spelling in the word bank, not the model's bare one", () => {
    const cloze = SAMPLE_WORKSHEET.sections.find((s) => s.kind === "cloze");
    if (cloze?.kind !== "cloze") throw new Error("sample lost the cloze");
    expect(cloze.word_bank).toContain("الْحِين");
    expect(cloze.word_bank).not.toContain("الحين");
  });
});
