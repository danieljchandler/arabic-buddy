import { describe, expect, it } from "vitest";
import {
  answerKeyFor,
  assembleWorksheet,
  isPrintable,
  optionLetter,
  pickWorksheetWords,
  seededShuffle,
  splitBlank,
  type WorksheetDraft,
  worksheetArabicText,
  type WorksheetSection,
  type WorksheetWord,
} from "../../supabase/functions/_shared/worksheetCore";

/**
 * The worksheet assembler (supabase/functions/_shared/worksheetCore.ts).
 *
 * The model writes the content; this decides what is printable. The promise
 * the tests hold it to: every printed blank's answer is one of the learner's
 * words, the answer key always agrees with the page, MSA never reaches a
 * dialect section, and "spot the Fusha" answers come from the leak detector
 * rather than from the model.
 */

const WORDS: WorksheetWord[] = [
  { arabic: "الحين", english: "now" },
  { arabic: "بكره", english: "tomorrow" },
  { arabic: "قهوه", english: "coffee" },
  { arabic: "شبعان", english: "full" },
  { arabic: "ابي", english: "I want" },
];

const DRAFT: WorksheetDraft = {
  title_arabic: "كَلِمَاتِي",
  title_english: "My words",
  cloze: [
    { sentence: "وين رايح ___؟", answer: "الحين", english: "Where are you going now?" },
    { sentence: "بتصل فيك ___ ان شاء الله", answer: "بكره", english: "I'll call you tomorrow, God willing." },
    { sentence: "ما ابي شي، انا ___", answer: "شبعان", english: "I don't want anything, I'm full." },
  ],
  dialogue: {
    setting_english: "At a coffee shop",
    lines: [
      { speaker: "A", text: "شلونك؟", answer: null, english: "How are you?" },
      { speaker: "B", text: "زين، ___ قهوه", answer: "ابي", english: "Fine, I want a coffee." },
      { speaker: "A", text: "وانا بعد", answer: null, english: "Me too." },
    ],
  },
  writing: { prompt_english: "Text a friend about tonight.", prompt_arabic: "وين رايح الليله؟" },
  spot_the_fusha: [
    { arabic: "سوف أتصل بك غدا", english: "I'll call you tomorrow.", fusha_word: "سوف" },
    { arabic: "وبعد ابي قهوه", english: "And I want a coffee too.", fusha_word: null },
    { arabic: "الرجل الذي شفته امس", english: "The man I saw yesterday.", fusha_word: "الذي" },
    { arabic: "وين رايح الحين؟", english: "Where are you going now?", fusha_word: null },
  ],
};

const section = <K extends WorksheetSection["kind"]>(sections: WorksheetSection[], kind: K) =>
  sections.find((s) => s.kind === kind) as Extract<WorksheetSection, { kind: K }> | undefined;

describe("pickWorksheetWords", () => {
  it("takes weak words first, then due ones, once each across spelling variants, up to the cap", () => {
    const weak = [{ arabic: "بكرة", english: "tomorrow" }, { arabic: "الحين", english: "now" }];
    const due = [
      { arabic: "بكره", english: "tomorrow (deck 2)" },
      { arabic: "  ", english: "blank" },
      { arabic: "قهوه", english: "coffee" },
      { arabic: "شبعان", english: "" },
    ];
    expect(pickWorksheetWords(weak, due).map((w) => w.arabic)).toEqual(["بكرة", "الحين", "قهوه"]);
    expect(pickWorksheetWords(WORDS, [], 2)).toHaveLength(2);
  });
});

describe("splitBlank", () => {
  it("splits on exactly one run of three or more underscores", () => {
    expect(splitBlank("وين رايح ___؟")).toEqual({ before: "وين رايح", after: "؟" });
    expect(splitBlank("______ بتصل فيك")).toEqual({ before: "", after: "بتصل فيك" });
    expect(splitBlank("no blank")).toBeNull();
    expect(splitBlank("___ two ___")).toBeNull();
  });
});

describe("seededShuffle", () => {
  it("is deterministic per seed and keeps every item", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect([...seededShuffle(items, 7)].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("assembleWorksheet", () => {
  it("prints every component from a good draft, in the fixed order, with nothing dropped", () => {
    const spec = assembleWorksheet(DRAFT, WORDS, "Gulf", 1);
    expect(spec.sections.map((s) => s.kind)).toEqual(["matching", "cloze", "dialogue", "spot_the_fusha", "writing"]);
    expect(spec.dropped).toEqual([]);
    expect(spec.title.arabic).toBe("كَلِمَاتِي");
    expect(isPrintable(spec)).toBe(true);
  });

  it("builds matching from the learner's words, with the English column never in the same order", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const matching = section(assembleWorksheet(DRAFT, WORDS, "Gulf", seed).sections, "matching")!;
      expect(matching.pairs).toEqual(WORDS);
      expect([...matching.english_order].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(matching.english_order).not.toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("drops cloze items whose answer is not a learner word, is reused, has no single blank, or leaks MSA", () => {
    const draft: WorksheetDraft = {
      ...DRAFT,
      cloze: [
        ...DRAFT.cloze,
        { sentence: "تبي ___؟", answer: "شاهي", english: "Do you want tea?" },
        { sentence: "وين رايح ___ ؟", answer: "الحين", english: "dup" },
        { sentence: "بكره ___ ___", answer: "قهوه", english: "two blanks" },
        { sentence: "سوف أشرب ___", answer: "قهوه", english: "I will drink coffee." },
      ],
    };
    const spec = assembleWorksheet(draft, WORDS, "Gulf", 1);
    const cloze = section(spec.sections, "cloze")!;
    expect(cloze.items.map((i) => i.answer)).toEqual(["الحين", "بكره", "شبعان"]);
    expect([...cloze.word_bank].sort()).toEqual(["الحين", "بكره", "شبعان"].sort());
    expect(spec.dropped).toHaveLength(4);
    expect(spec.dropped.join(" | ")).toMatch(/not one of the learner's words.*already used.*not exactly one blank.*MSA/);
  });

  it("accepts an answer in a different spelling and prints the learner's own", () => {
    const draft = { ...DRAFT, cloze: [...DRAFT.cloze.slice(0, 1), { sentence: "اشوفك ___", answer: "بكرة", english: "See you tomorrow." }] };
    const cloze = section(assembleWorksheet(draft, WORDS, "Gulf", 1).sections, "cloze")!;
    expect(cloze.items[1].answer).toBe("بكره");
  });

  it("drops the whole dialogue when a line's blank and answer disagree, or it leaks MSA", () => {
    const broken = { ...DRAFT, dialogue: { ...DRAFT.dialogue, lines: [...DRAFT.dialogue.lines, { speaker: "B" as const, text: "زين ___", answer: null, english: "x" }] } };
    const a = assembleWorksheet(broken, WORDS, "Gulf", 1);
    expect(section(a.sections, "dialogue")).toBeUndefined();
    expect(a.dropped.join(" ")).toMatch(/blank and answer do not agree/);

    const leaky = { ...DRAFT, dialogue: { ...DRAFT.dialogue, lines: [...DRAFT.dialogue.lines, { speaker: "B" as const, text: "ماذا تريد الآن؟", answer: null, english: "x" }] } };
    const b = assembleWorksheet(leaky, WORDS, "Gulf", 1);
    expect(section(b.sections, "dialogue")).toBeUndefined();
    expect(b.dropped.join(" ")).toMatch(/dialogue: MSA/);
  });

  it("keeps a 'spot the Fusha' item only when the detector agrees with the model, and keys it on the detector", () => {
    const draft: WorksheetDraft = {
      ...DRAFT,
      spot_the_fusha: [
        ...DRAFT.spot_the_fusha,
        // The model claims MSA the detector does not see: dropped, not printed with a wrong key.
        { arabic: "وين رايح؟", english: "Where to?", fusha_word: "رايح" },
        // The model calls it dialect but it carries MSA: dropped.
        { arabic: "ليس عندي شي", english: "I have nothing.", fusha_word: null },
      ],
    };
    const spec = assembleWorksheet(draft, WORDS, "Gulf", 1);
    const spot = section(spec.sections, "spot_the_fusha")!;
    expect(spot.items).toHaveLength(4);
    expect(spot.items[0].fusha_words).toContain("سوف");
    expect(spot.items[1].fusha_words).toEqual([]);
    expect(spec.dropped.filter((d) => d.startsWith("spot the Fusha"))).toHaveLength(2);
  });

  it("leaves 'spot the Fusha' out when it would be all one answer", () => {
    const allClean = { ...DRAFT, spot_the_fusha: DRAFT.spot_the_fusha.filter((s) => !s.fusha_word).concat([{ arabic: "تبي قهوه؟", english: "Coffee?", fusha_word: null }]) };
    expect(section(assembleWorksheet(allClean, WORDS, "Gulf", 1).sections, "spot_the_fusha")).toBeUndefined();
  });

  it("blanks an Arabic title or writing prompt that leaks MSA, keeping the English", () => {
    const draft = { ...DRAFT, title_arabic: "كلمات سوف نتعلمها", writing: { prompt_english: "Write about tomorrow.", prompt_arabic: "اكتب عن الغد الآن" } };
    const spec = assembleWorksheet(draft, WORDS, "Gulf", 1);
    expect(spec.title).toEqual({ arabic: "", english: "My words" });
    const writing = section(spec.sections, "writing")!;
    expect(writing.prompt_arabic).toBe("");
    expect(writing.prompt_english).toBe("Write about tomorrow.");
    expect(writing.lines).toBe(6);
  });

  it("is not printable with fewer than two exercises", () => {
    const thin = assembleWorksheet({ ...DRAFT, cloze: [], dialogue: { ...DRAFT.dialogue, lines: [] }, spot_the_fusha: [] }, WORDS.slice(0, 3), "Gulf", 1);
    expect(isPrintable(thin)).toBe(false);
  });
});

describe("answer key", () => {
  const spec = assembleWorksheet(DRAFT, WORDS, "Gulf", 3);

  it("matches each Arabic word to the letter its English got on the page", () => {
    const matching = section(spec.sections, "matching")!;
    const key = answerKeyFor(matching);
    matching.pairs.forEach((pair, i) => {
      expect(key[i].label).toBe(String(i + 1));
      const printedAt = key[i].answer.charCodeAt(0) - 97;
      expect(matching.pairs[matching.english_order[printedAt]].english).toBe(pair.english);
    });
    expect(optionLetter(0)).toBe("a");
  });

  it("lists cloze and dialogue answers, the detector's Fusha words, and nothing for writing", () => {
    expect(answerKeyFor(section(spec.sections, "cloze")!).map((k) => k.answer)).toEqual(["الحين", "بكره", "شبعان"]);
    expect(answerKeyFor(section(spec.sections, "dialogue")!)).toEqual([{ label: "1", answer: "ابي" }]);
    const spot = answerKeyFor(section(spec.sections, "spot_the_fusha")!);
    expect(spot[0].answer).toContain("سوف");
    expect(spot[1]).toEqual({ label: "2", answer: "✓ all dialect" });
    expect(answerKeyFor(section(spec.sections, "writing")!)).toEqual([]);
  });
});

describe("worksheetArabicText", () => {
  it("hands the repair pass the dialect parts with blanks filled, and never the deliberate MSA", () => {
    const text = worksheetArabicText(DRAFT);
    expect(text).toContain("وين رايح الحين؟");
    expect(text).toContain("زين، ابي قهوه");
    expect(text).not.toContain("سوف");
    expect(text).not.toContain("الذي");
    expect(worksheetArabicText(null)).toBe("");
  });
});
