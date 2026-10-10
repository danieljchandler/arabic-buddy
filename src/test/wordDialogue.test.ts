import { describe, expect, it } from "vitest";
import { sentenceHasWord } from "@/lib/arabicWord";
import { assetKey, type AssetKey } from "../../supabase/functions/_shared/wordAssets";
import {
  DIALOGUE_TOOL,
  MAX_DIALOGUE_LINE_LENGTH,
  asStoredDialogue,
  authoredExample,
  dialogueArabic,
  dialogueLinesForScan,
  dialoguePrompt,
  dialogueProblem,
  keyWord,
  lineUsesWord,
  withoutProclitics,
  wordUseCount,
} from "../../supabase/functions/_shared/wordDialogue";

/**
 * A word's two-line exchange (`supabase/functions/_shared/wordDialogue.ts`):
 * what counts as one the quiz can ask, what the model is told, and what the
 * leak detector is shown before one is filed for every later learner.
 *
 * The rule that matters most is the one about what reaches the prompt: the
 * key, and on the trusted path an authored example, never anything a learner
 * typed. `word-asset`'s own tests prove the function keeps to it; these hold
 * the pure half to the shape that makes it possible.
 */

const offer = { speaker: "Friend", arabic: "تبي شي تشربه؟", english: "Want something to drink?", transliteration: "tabi shay?" };
const reply = { speaker: "Guest", arabic: "ايه، عطني قهوة", english: "Yes, give me coffee", transliteration: "eeh, 'atni gahwa" };

describe("lineUsesWord", () => {
  it("is sentenceHasWord for a single word", () => {
    // The quiz's reply question tests a line with sentenceHasWord; a stored
    // exchange that passes here must pass there.
    const cases: Array<[string, string]> = [
      ["ايه، عطني قهوة", "قَهْوَة"],
      ["ايه، عطني القهوة", "قهوة"],
      ["قهوتك جاهزة", "قهوة"],
      ["أكل؟ ايه", "اكل"],
      ["", "قهوة"],
      ["قهوة", ""],
    ];
    for (const [line, word] of cases) {
      expect(lineUsesWord(line, word), `${line} / ${word}`).toBe(sentenceHasWord(line, word));
    }
  });

  it("finds a phrase as a run of whole words", () => {
    expect(lineUsesWord("الله يعطيك العافية يا بو محمد", "يعطيك العافية")).toBe(true);
    expect(lineUsesWord("الله يعطيك يا بو محمد العافية", "يعطيك العافية")).toBe(false);
  });
});

describe("withoutProclitics and wordUseCount", () => {
  it("takes an attached و or ف, then ب, ل or ك, then ال, off in turn, never down to one letter", () => {
    expect(withoutProclitics("والقهوه")).toEqual(["والقهوه", "القهوه", "قهوه"]);
    expect(withoutProclitics("بالسوق")).toEqual(["بالسوق", "السوق", "سوق"]);
    expect(withoutProclitics("قهوه")).toEqual(["قهوه"]);
    expect(withoutProclitics("وي")).toEqual(["وي"]);
  });

  it("counts the word wherever it is said, bare or with و, ب or ال attached", () => {
    expect(wordUseCount("طلب قهوة حارة", "قهوة")).toBe(1);
    expect(wordUseCount("طلب قهوة وشرب القهوة", "قهوة")).toBe(2);
    expect(wordUseCount("رحنا بالسوق", "سوق")).toBe(1);
    expect(wordUseCount("طلب شاي", "قهوة")).toBe(0);
  });

  it("counts a phrase as one use, with the prefix on its first word only", () => {
    expect(wordUseCount("نشرب قهوة كل يوم وبكل يوم", "كل يوم")).toBe(2);
    expect(wordUseCount("كل الناس يوم الجمعة", "كل يوم")).toBe(0);
  });

  it("agrees with lineUsesWord on a bare use, and goes further only where a prefix is attached", () => {
    for (const [line, word] of [["طلب قهوة", "قهوة"], ["وين رحت", "زين"], ["الجو زين", "زين"], ["كل يوم نروح", "كل يوم"]] as const) {
      expect(wordUseCount(line, word) > 0, line).toBe(lineUsesWord(line, word));
    }
    // The gap is never cut on القهوة, and it still says the word.
    expect(lineUsesWord("القهوة حارة", "قهوة")).toBe(false);
    expect(wordUseCount("القهوة حارة", "قهوة")).toBe(1);
  });
});

describe("asStoredDialogue", () => {
  it("keeps an exchange whose reply uses the word", () => {
    expect(asStoredDialogue({ lines: [offer, reply] }, "قهوة")).toEqual({ lines: [offer, reply] });
    // The bare pair, as a model may emit it, and anything past two lines dropped.
    expect(asStoredDialogue([offer, reply, offer], "قهوة")).toEqual({ lines: [offer, reply] });
  });

  it("evens out spacing and fills a missing speaker or transliteration with nothing", () => {
    const loose = { arabic: "  ايه،   عطني  قهوة ", english: " Yes " };
    expect(asStoredDialogue({ lines: [offer, loose] }, "قهوة")?.lines[1]).toEqual({
      speaker: "",
      arabic: "ايه، عطني قهوة",
      english: "Yes",
      transliteration: "",
    });
  });

  it("refuses what the quiz cannot ask", () => {
    const refused: unknown[] = [
      null,
      "قهوة",
      { lines: [offer] },
      // The reply does not use the word, or the opening line already says it.
      { lines: [offer, { ...reply, arabic: "ايه، عطني شاي" }] },
      { lines: [{ ...offer, arabic: "تبي قهوة؟" }, reply] },
      // A line with no Arabic, or no English to show the learner.
      { lines: [{ ...offer, arabic: "Want a drink?" }, reply] },
      { lines: [offer, { ...reply, english: "" }] },
      // A line too long to be said as one.
      { lines: [offer, { ...reply, arabic: `قهوة ${"و".repeat(MAX_DIALOGUE_LINE_LENGTH)}` }] },
    ];
    for (const value of refused) {
      expect(asStoredDialogue(value, "قهوة"), JSON.stringify(value)).toBeNull();
    }
  });

  it("gives the critic a reason only when there is something to fix", () => {
    expect(dialogueProblem({ lines: [offer, reply] }, "قهوه")).toBeNull();
    expect(dialogueProblem({ lines: [offer, { ...reply, arabic: "ايه" }] }, "قهوه")).toMatch(/second line must contain the word قهوه/);
  });
});

describe("what the leak detector is shown", () => {
  it("is every line's Arabic, with nothing hidden inside quotation marks", () => {
    // The detector skips quoted text; a line a learner says is never quoted.
    const quoted = { ...reply, arabic: "قال «لماذا» وعطاني قهوة" };
    const lines = dialogueLinesForScan({ lines: [offer, quoted] });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("لماذا");
    expect(lines[1]).not.toMatch(/[«»"“”]/);
  });

  it("is what the Brain scans as well", () => {
    expect(dialogueArabic({ lines: [offer, reply] })).toBe(`${offer.arabic}\n${reply.arabic}`);
    expect(dialogueArabic(null)).toBe("");
  });
});

describe("the prompt", () => {
  const key = assetKey({ kind: "dialogue", word: "قَهْوَة", gloss: "Coffee!", dialect: "Gulf" }) as AssetKey;

  it("names the word as the key folded it, never as it was typed", () => {
    expect(keyWord(key)).toBe("قهوه");
    const prompt = dialoguePrompt({ word: keyWord(key), sense: key.sense, dialect: "Gulf" });
    expect(prompt).toContain("قهوه");
    expect(prompt).toContain('"coffee"');
    expect(prompt).not.toContain("قَهْوَة");
    expect(prompt).not.toContain("Coffee!");
    expect(prompt).toContain("Gulf (Khaliji) Arabic");
    // No example unless the trusted path sent one.
    expect(prompt).not.toMatch(/the course uses the word/);
  });

  it("carries an authored example, quote-free, when there is one", () => {
    const prompt = dialoguePrompt({ word: "قهوه", sense: "coffee", dialect: "Egyptian", example: 'عايز "قهوة" دلوقتي' });
    expect(prompt).toContain("Egyptian Arabic");
    expect(prompt).toContain("the course uses the word like this: 'عايز 'قهوة' دلوقتي'");
  });

  it("asks for the two lines the store keeps", () => {
    expect(DIALOGUE_TOOL.parameters.properties.lines.minItems).toBe(2);
    expect(DIALOGUE_TOOL.parameters.properties.lines.maxItems).toBe(2);
  });
});

describe("authoredExample", () => {
  it("takes a sentence that uses the word", () => {
    expect(authoredExample("  القهوة جاهزة؟  ايه، قهوة عربية ", "قهوة")).toBe("القهوة جاهزة؟ ايه، قهوة عربية");
  });

  it("takes nothing that is not an example of this word", () => {
    for (const text of ["", ".", "قهوة", "قهوة،", "ابي شاي الحين", "coffee please", `قهوة ${"و ".repeat(200)}`]) {
      expect(authoredExample(text, "قهوة"), JSON.stringify(text)).toBe("");
    }
  });
});
