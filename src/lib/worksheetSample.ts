import {
  assembleWorksheet,
  type WorksheetDraft,
  type WorksheetSpec,
  type WorksheetWord,
} from "../../supabase/functions/_shared/worksheetCore";

/**
 * A fixed Gulf worksheet for /print/worksheet?sample=1.
 *
 * It exists so the print layout can be checked without an account, a deck or
 * a model call: on paper, on Windows and Android Chrome, by a native reader,
 * and by the local Playwright print check in e2e/print-worksheet.spec.ts. So
 * it deliberately carries the things that break Arabic printing — vocalised
 * words (harakat), Western digits inside right-to-left sentences, and blanks
 * at the start, middle and end of a line.
 *
 * It goes through `assembleWorksheet` like a generated one, so the sample can
 * never show a layout or an answer key the real path would not produce.
 *
 * DRAFT Arabic for a native reader. The "spot the Fusha" lines and most cloze
 * lines are golden rows (supabase/functions/_test/eval/golden/gulf.jsonl); the
 * souq dialogue, the title and the writing prompt are not.
 */

export const SAMPLE_WORDS: WorksheetWord[] = [
  { arabic: "الْحِين", english: "now" },
  { arabic: "بُكْرَه", english: "tomorrow" },
  { arabic: "قَهْوَه", english: "coffee" },
  { arabic: "شَبْعَان", english: "full (after eating)" },
  { arabic: "اللَّيْلَه", english: "tonight" },
  { arabic: "أَبِي", english: "I want" },
  { arabic: "بِكَم", english: "how much?" },
];

export const SAMPLE_DRAFT: WorksheetDraft = {
  title_arabic: "كَلِمَاتِي فِي السُّوق",
  title_english: "My words: at the souq",
  cloze: [
    { sentence: "وين رايح ___؟", answer: "الحين", english: "Where are you going now?" },
    { sentence: "بتصل فيك ___ ان شاء الله", answer: "بكره", english: "I'll call you tomorrow, God willing." },
    { sentence: "السوق يسكر الساعة 11 ___", answer: "الليله", english: "The souq closes at 11 tonight." },
    { sentence: "ما ابي شي، انا ___", answer: "شبعان", english: "I don't want anything, I'm full." },
  ],
  dialogue: {
    setting_english: "Buying dates at the souq",
    lines: [
      { speaker: "A", text: "شلونك؟ شخبارك اليوم؟", answer: null, english: "How are you? How's your day?" },
      { speaker: "B", text: "الحمد لله زين", answer: null, english: "Fine, thank God." },
      { speaker: "A", text: "___ الكيلو؟", answer: "بكم", english: "How much is a kilo?" },
      { speaker: "B", text: "الكيلو ب 12 ريال", answer: null, english: "12 riyals a kilo." },
      { speaker: "A", text: "زين، ___ كيلوين", answer: "ابي", english: "OK, I want two kilos." },
      { speaker: "B", text: "تبي ___ بعد؟", answer: "قهوه", english: "Do you want coffee as well?" },
    ],
  },
  writing: {
    prompt_english: "Text a friend: you'll meet at the souq tomorrow at 11. Ask what they want to buy.",
    prompt_arabic: "بنتلاقى في السوق بكره الساعة 11. وش تبي تشتري؟",
  },
  spot_the_fusha: [
    { arabic: "بتصل فيك بكره ان شاء الله", english: "I'll call you tomorrow, God willing.", fusha_word: null },
    { arabic: "سوف أتصل بك غدا", english: "I will call you tomorrow.", fusha_word: "سوف" },
    { arabic: "وبعد ابي قهوه", english: "And I want a coffee too.", fusha_word: null },
    { arabic: "الرجل الذي رأيته بالأمس في السوق", english: "The man I saw yesterday at the souq.", fusha_word: "الذي" },
  ],
};

export const SAMPLE_WORKSHEET: WorksheetSpec = assembleWorksheet(SAMPLE_DRAFT, SAMPLE_WORDS, "Gulf", 7);
