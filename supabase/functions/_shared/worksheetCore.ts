/**
 * Printable worksheets: the spec, and the rules that turn a model's draft into
 * one. Pure, so the Vitest suite can hold it (src/test/worksheetCore.test.ts)
 * and the print page can import the types and the answer-key helper verbatim.
 *
 * The component set is fixed — title, instructions, Arabic-English matching,
 * cloze with a word bank, dialogue gap-fill, "spot the Fusha", RTL writing
 * lines — so the model writes content, never layout. A component the model
 * got wrong is dropped rather than printed: a worksheet with four good parts
 * is better than one with five where the answer key disagrees with the page.
 *
 * Three things are decided here rather than trusted to the model:
 *
 *   - Matching is built from the learner's own words, not generated at all.
 *   - Every blank's answer must be one of the learner's words, so the word
 *     bank and the key can only ever contain what the worksheet is about.
 *   - "Spot the Fusha" answers come from `detectMsaLeaks`, not from the model.
 *     The model writes the sentences and says which word it made MSA; an item
 *     is kept only when the detector agrees, and the key prints the detector's
 *     tokens. A key that marks a sentence clean while it carries MSA the
 *     model forgot to mention would teach the opposite of the lesson.
 */
import { detectMsaLeaks, normalizeArabic } from "./msaLeakDetector.ts";
import type { Dialect } from "./dialectTypes.ts";

export interface WorksheetWord {
  arabic: string;
  english: string;
}

/** What the model returns (the generate-worksheet function validates it with zod first). */
export interface WorksheetDraft {
  title_arabic: string;
  title_english: string;
  cloze: Array<{ sentence: string; answer: string; english: string }>;
  dialogue: {
    setting_english: string;
    lines: Array<{ speaker: "A" | "B"; text: string; answer: string | null; english: string }>;
  };
  writing: { prompt_english: string; prompt_arabic: string };
  spot_the_fusha: Array<{ arabic: string; english: string; fusha_word: string | null }>;
}

export type WorksheetSection =
  | {
    kind: "matching";
    instructions: string;
    pairs: WorksheetWord[];
    /** The English column's order: pairs[english_order[k]] is printed as letter k. */
    english_order: number[];
  }
  | {
    kind: "cloze";
    instructions: string;
    word_bank: string[];
    items: Array<{ before: string; after: string; answer: string; english: string }>;
  }
  | {
    kind: "dialogue";
    instructions: string;
    setting_english: string;
    word_bank: string[];
    lines: Array<{ speaker: "A" | "B"; before: string; after: string; answer: string | null; english: string }>;
  }
  | {
    kind: "spot_the_fusha";
    instructions: string;
    /** `fusha_words` is the detector's verdict: empty means the sentence is all dialect. */
    items: Array<{ arabic: string; english: string; fusha_words: string[] }>;
  }
  | {
    kind: "writing";
    instructions: string;
    prompt_english: string;
    /** Empty when the model's Arabic prompt leaked MSA; the English one still stands. */
    prompt_arabic: string;
    lines: number;
  };

export type WorksheetSectionKind = WorksheetSection["kind"];

export interface WorksheetSpec {
  version: 1;
  dialect: Dialect;
  title: { arabic: string; english: string };
  instructions: string;
  sections: WorksheetSection[];
  /** What the assembler left out and why. Diagnostic; never printed. */
  dropped: string[];
}

export const BLANK = "___";

export const WORKSHEET_INSTRUCTIONS =
  "Work through each part in pencil. The answers are on the last page; fold it back before you start.";

export const SECTION_INSTRUCTIONS: Record<WorksheetSectionKind, string> = {
  matching: "Write the letter of the English meaning next to each Arabic word.",
  cloze: "Fill each gap with a word from the box. Each word is used once.",
  dialogue: "Complete the conversation with the words in the box.",
  spot_the_fusha:
    "Some of these sentences slip into Fusha (formal Arabic). Tick the ones that do and circle the Fusha word.",
  writing: "Answer in Arabic. Write from right to left.",
};

/** Words in a worksheet. Enough for every component to have something to use, few enough to fit a page. */
export const MIN_WORDS = 4;
export const MAX_WORDS = 8;
export const WRITING_LINES = 6;

const key = (arabic: string) => normalizeArabic(arabic);

/**
 * The words a worksheet is built around: weak ones first (leeches, lapses,
 * recent production errors), then due ones, de-duplicated across both decks.
 */
export function pickWorksheetWords(
  weak: WorksheetWord[],
  due: WorksheetWord[],
  max: number = MAX_WORDS,
): WorksheetWord[] {
  const out: WorksheetWord[] = [];
  const seen = new Set<string>();
  for (const w of [...weak, ...due]) {
    const arabic = w.arabic?.trim();
    const english = w.english?.trim();
    if (!arabic || !english) continue;
    const k = key(arabic);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ arabic, english });
    if (out.length >= max) break;
  }
  return out;
}

/** Split a sentence on its one blank. Any run of three or more underscores counts. */
export function splitBlank(text: string): { before: string; after: string } | null {
  const parts = text.split(/_{3,}/);
  if (parts.length !== 2) return null;
  return { before: parts[0].trimEnd(), after: parts[1].trimStart() };
}

/** Deterministic shuffle (mulberry32), so a spec and its answer key always agree. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled index order that never leaves every item where it was. */
function derangedOrder(n: number, seed: number): number[] {
  const order = seededShuffle(Array.from({ length: n }, (_, i) => i), seed);
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}

/**
 * The dialect Arabic in a draft, for askBrain's leak scan and repair pass.
 *
 * "Spot the Fusha" is left out on purpose: its MSA is the exercise, and
 * handing it to the repair pass would have it "fixed" away.
 */
export function worksheetArabicText(draft: unknown): string {
  const d = draft as Partial<WorksheetDraft> | null;
  if (!d) return "";
  const parts: string[] = [];
  if (typeof d.title_arabic === "string") parts.push(d.title_arabic);
  for (const c of d.cloze ?? []) if (typeof c?.sentence === "string") parts.push(c.sentence.replace(/_{3,}/, c.answer ?? ""));
  for (const l of d.dialogue?.lines ?? []) {
    if (typeof l?.text === "string") parts.push(l.text.replace(/_{3,}/, l.answer ?? ""));
  }
  if (typeof d.writing?.prompt_arabic === "string") parts.push(d.writing.prompt_arabic);
  return parts.join("\n");
}

/**
 * Turn a validated draft into a printable spec, dropping whatever cannot be
 * printed honestly. `seed` fixes every shuffle, so the same draft always
 * prints the same page and the same key.
 */
export function assembleWorksheet(
  draft: WorksheetDraft,
  words: WorksheetWord[],
  dialect: Dialect,
  seed: number,
): WorksheetSpec {
  const dropped: string[] = [];
  const sections: WorksheetSection[] = [];
  const wordKeys = new Map(words.map((w) => [key(w.arabic), w.arabic]));
  const leaks = (text: string) => detectMsaLeaks(text, dialect).leaks;

  // Matching: the learner's own words, nothing generated.
  const pairs = words.slice(0, MAX_WORDS);
  if (pairs.length >= MIN_WORDS) {
    sections.push({
      kind: "matching",
      instructions: SECTION_INSTRUCTIONS.matching,
      pairs,
      english_order: derangedOrder(pairs.length, seed),
    });
  } else {
    dropped.push(`matching: only ${pairs.length} word(s)`);
  }

  // Cloze: one blank per sentence, answer from the learner's words, no MSA.
  const clozeItems: Extract<WorksheetSection, { kind: "cloze" }>["items"] = [];
  const usedAnswers = new Set<string>();
  draft.cloze.forEach((item, i) => {
    const split = splitBlank(item.sentence);
    const answer = wordKeys.get(key(item.answer));
    if (!split) return dropped.push(`cloze ${i + 1}: not exactly one blank`);
    if (!answer) return dropped.push(`cloze ${i + 1}: answer "${item.answer}" is not one of the learner's words`);
    if (usedAnswers.has(key(answer))) return dropped.push(`cloze ${i + 1}: answer "${answer}" already used`);
    const filled = `${split.before} ${answer} ${split.after}`;
    const found = leaks(filled);
    if (found.length) return dropped.push(`cloze ${i + 1}: MSA (${found.join(", ")})`);
    usedAnswers.add(key(answer));
    clozeItems.push({ ...split, answer, english: item.english.trim() });
  });
  if (clozeItems.length >= 2) {
    sections.push({
      kind: "cloze",
      instructions: SECTION_INSTRUCTIONS.cloze,
      word_bank: seededShuffle(clozeItems.map((c) => c.answer), seed + 1),
      items: clozeItems,
    });
  } else {
    dropped.push(`cloze: ${clozeItems.length} usable item(s)`);
  }

  // Dialogue: all or nothing. A conversation with a line missing does not read.
  const dialogueLines: Extract<WorksheetSection, { kind: "dialogue" }>["lines"] = [];
  let dialogueOk = draft.dialogue.lines.length >= 3;
  for (const [i, line] of draft.dialogue.lines.entries()) {
    const split = splitBlank(line.text);
    if (split && line.answer) {
      const answer = wordKeys.get(key(line.answer));
      if (!answer) {
        dropped.push(`dialogue line ${i + 1}: answer "${line.answer}" is not one of the learner's words`);
        dialogueOk = false;
        break;
      }
      dialogueLines.push({ speaker: line.speaker, ...split, answer, english: line.english.trim() });
    } else if (!split && !line.answer) {
      dialogueLines.push({ speaker: line.speaker, before: line.text.trim(), after: "", answer: null, english: line.english.trim() });
    } else {
      dropped.push(`dialogue line ${i + 1}: blank and answer do not agree`);
      dialogueOk = false;
      break;
    }
  }
  const gaps = dialogueLines.filter((l) => l.answer !== null);
  if (dialogueOk && gaps.length === 0) {
    dropped.push("dialogue: no gaps");
    dialogueOk = false;
  }
  if (dialogueOk) {
    const found = leaks(dialogueLines.map((l) => `${l.before} ${l.answer ?? ""} ${l.after}`).join("\n"));
    if (found.length) {
      dropped.push(`dialogue: MSA (${found.join(", ")})`);
      dialogueOk = false;
    }
  }
  if (dialogueOk) {
    sections.push({
      kind: "dialogue",
      instructions: SECTION_INSTRUCTIONS.dialogue,
      setting_english: draft.dialogue.setting_english.trim(),
      word_bank: seededShuffle(gaps.map((l) => l.answer!), seed + 2),
      lines: dialogueLines,
    });
  } else if (draft.dialogue.lines.length < 3) {
    dropped.push("dialogue: fewer than 3 lines");
  }

  // Spot the Fusha: the detector is the answer key; keep only where it agrees with the model.
  const fushaItems: Extract<WorksheetSection, { kind: "spot_the_fusha" }>["items"] = [];
  draft.spot_the_fusha.forEach((item, i) => {
    const found = leaks(item.arabic);
    const modelSaysFusha = !!item.fusha_word?.trim();
    if (modelSaysFusha !== found.length > 0) {
      return dropped.push(
        `spot the Fusha ${i + 1}: model says ${modelSaysFusha ? "Fusha" : "dialect"}, detector says ${found.length ? found.join(", ") : "dialect"}`,
      );
    }
    fushaItems.push({ arabic: item.arabic.trim(), english: item.english.trim(), fusha_words: found });
  });
  const withFusha = fushaItems.filter((f) => f.fusha_words.length > 0).length;
  if (fushaItems.length >= 3 && withFusha >= 1 && withFusha < fushaItems.length) {
    sections.push({ kind: "spot_the_fusha", instructions: SECTION_INSTRUCTIONS.spot_the_fusha, items: fushaItems });
  } else {
    dropped.push(`spot the Fusha: ${fushaItems.length} agreed item(s), ${withFusha} with Fusha`);
  }

  // Writing: the English prompt always stands; the Arabic one only if it is clean.
  const promptArabic = draft.writing.prompt_arabic.trim();
  const promptLeaks = promptArabic ? leaks(promptArabic) : [];
  if (promptLeaks.length) dropped.push(`writing prompt: MSA (${promptLeaks.join(", ")})`);
  if (draft.writing.prompt_english.trim()) {
    sections.push({
      kind: "writing",
      instructions: SECTION_INSTRUCTIONS.writing,
      prompt_english: draft.writing.prompt_english.trim(),
      prompt_arabic: promptLeaks.length ? "" : promptArabic,
      lines: WRITING_LINES,
    });
  }

  const titleLeaks = leaks(draft.title_arabic);
  if (titleLeaks.length) dropped.push(`title: MSA (${titleLeaks.join(", ")})`);

  return {
    version: 1,
    dialect,
    title: { arabic: titleLeaks.length ? "" : draft.title_arabic.trim(), english: draft.title_english.trim() },
    instructions: WORKSHEET_INSTRUCTIONS,
    sections,
    dropped,
  };
}

/** The letter printed beside the k-th English option: a, b, c... */
export const optionLetter = (k: number): string => String.fromCharCode(97 + k);

/**
 * One section's answers, as the key prints them: the item's label (its number
 * on the page) and the answer, kept apart so the page can box the number
 * rather than write "1." into a right-to-left line.
 */
export function answerKeyFor(section: WorksheetSection): Array<{ label: string; answer: string }> {
  switch (section.kind) {
    case "matching":
      return section.pairs.map((_, i) => ({ label: String(i + 1), answer: optionLetter(section.english_order.indexOf(i)) }));
    case "cloze":
      return section.items.map((item, i) => ({ label: String(i + 1), answer: item.answer }));
    case "dialogue":
      return section.lines
        .filter((l) => l.answer !== null)
        .map((l, i) => ({ label: String(i + 1), answer: l.answer! }));
    case "spot_the_fusha":
      return section.items.map((item, i) => ({
        label: String(i + 1),
        answer: item.fusha_words.length ? item.fusha_words.join("، ") : "✓ all dialect",
      }));
    case "writing":
      return [];
  }
}

/** True when a spec has enough in it to be worth printing. */
export const isPrintable = (spec: WorksheetSpec): boolean =>
  spec.sections.filter((s) => s.kind !== "writing").length >= 2;
