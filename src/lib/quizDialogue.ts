import { ARABIC_PUNCT_RE, findWordSpan, normalizeArabicWord, type WordSpan } from "@/lib/arabicWord";
import { seededShuffle } from "@/lib/quizDistractors";
import {
  asStoredDialogue,
  lineUsesWord,
  wordUseCount,
  type StoredDialogue,
} from "../../supabase/functions/_shared/wordDialogue";

/** One line of an authored lesson dialogue (`lessons.dialogue`). */
export interface DialogueLine {
  speaker?: string | null;
  arabic: string;
  transliteration?: string | null;
  english?: string | null;
}

export interface ReplyQuestion {
  /** The line said to the learner. */
  prompt: DialogueLine;
  /** The reply that uses the word. */
  answer: DialogueLine;
  /** The answer among the wrong replies, in a seeded order. */
  options: DialogueLine[];
}

/** Options on the reply question, the answer included. */
const REPLY_CHOICES = 4;

/** Whether a value is a usable dialogue: an array of lines with Arabic. */
export function asDialogue(value: unknown): DialogueLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (line): line is DialogueLine =>
      !!line && typeof line === "object" && typeof (line as DialogueLine).arabic === "string" && (line as DialogueLine).arabic.trim() !== "",
  );
}

/** A line said, and the reply to it that uses the word. */
export interface ReplyLine {
  prompt: DialogueLine;
  answer: DialogueLine;
}

/*
 * "Uses the word" is `lineUsesWord`, the store's own rule (a whole word, or a
 * run of whole words for a phrase, compared after folding), so an exchange
 * the store filed for a two-word item is one the quiz can ask from. For a
 * single word it is exactly `sentenceHasWord`.
 *
 * "Says the word" is wider, `wordUseCount`: the word with a prefix or an
 * ending attached too (للسوق, قهوتي). A line said to the learner, or offered
 * as a wrong reply, must not say it at all: "رحنا للسوق؟" before a reply with
 * السوق hands over the answer, and a "wrong" reply with للسوق in it is not
 * wrong.
 */

/**
 * The first line of a dialogue that uses the word and has a line before it
 * that does not say it, with that line before: what "say the reply" asks, and
 * what "answer the line" builds its question around. Null when the word
 * opens the dialogue, is not in it, or is said in every line before a use.
 */
export function findReplyLine(dialogue: DialogueLine[], wordArabic: string): ReplyLine | null {
  const index = dialogue.findIndex(
    (line, i) => i > 0 && lineUsesWord(line.arabic, wordArabic) && wordUseCount(dialogue[i - 1].arabic, wordArabic) === 0,
  );
  if (index < 1) return null;
  return { prompt: dialogue[index - 1], answer: dialogue[index] };
}

/** Where a word's exchange came from. */
export type DialogueSource = "lesson" | "store";

/**
 * The dialogue the reply steps are built from: the lesson's own when a line
 * of it uses the word, else the word's exchange from the shared store
 * (`kind: "dialogue"`, two lines, the second using the word), else nothing.
 *
 * The lesson's comes first because a person wrote it, in the lesson the word
 * was taught in. The stored one is checked here as well as where it was
 * filed (`asStoredDialogue`): a stored exchange whose reply does not use this
 * spelling of the word is no question about it.
 */
export function dialogueForWord(
  lessonDialogue: unknown,
  stored: StoredDialogue | unknown,
  wordArabic: string,
): { lines: DialogueLine[]; source: DialogueSource } | null {
  const lesson = asDialogue(lessonDialogue);
  if (findReplyLine(lesson, wordArabic)) return { lines: lesson, source: "lesson" };
  const exchange = asStoredDialogue(stored, wordArabic);
  if (exchange && findReplyLine(exchange.lines, wordArabic)) return { lines: [...exchange.lines], source: "store" };
  return null;
}

/**
 * "Someone says something; which reply fits?" — built from the lesson's own
 * dialogue, or from the word's stored exchange when the lesson has none.
 *
 * The reply and the prompt are `findReplyLine`'s. The wrong replies are the
 * dialogue's other lines, none of which say the word in any form (a second
 * line with the word would be a second right answer), topped up from
 * `extraLines` — other lessons' dialogue, and other words' stored replies —
 * when the dialogue is short (a stored exchange is two lines, so all its
 * wrong replies come from there).
 * Null when the word opens the dialogue, is not in it, or there are fewer
 * than three wrong replies.
 */
export function buildReplyQuestion(
  dialogue: DialogueLine[],
  wordArabic: string,
  seed: string,
  extraLines: DialogueLine[] = [],
): ReplyQuestion | null {
  const reply = findReplyLine(dialogue, wordArabic);
  if (!reply) return null;
  const { answer, prompt } = reply;

  const seen = new Set<string>([answer.arabic.trim(), prompt.arabic.trim()]);
  const wrong: DialogueLine[] = [];
  for (const line of [...dialogue, ...extraLines]) {
    const key = line.arabic.trim();
    if (seen.has(key) || wordUseCount(line.arabic, wordArabic) > 0) continue;
    seen.add(key);
    wrong.push(line);
  }
  if (wrong.length < REPLY_CHOICES - 1) return null;

  const picks = seededShuffle(wrong, `${seed}:replies`).slice(0, REPLY_CHOICES - 1);
  return {
    prompt,
    answer,
    options: seededShuffle([answer, ...picks], `${seed}:reply-order`),
  };
}

/**
 * How many distinct wrong replies `lines` hold for a word: lines that do not
 * say it in any form and are not `except` (the prompt and the answer), as
 * `buildReplyQuestion` picks them. Enough to know whether a reply question
 * could be asked before its exchange is in hand.
 */
export function countWrongReplies(lines: DialogueLine[], wordArabic: string, except: DialogueLine[] = []): number {
  const seen = new Set(except.map((line) => line.arabic.trim()));
  let count = 0;
  for (const line of lines) {
    const key = line.arabic.trim();
    if (!key || seen.has(key) || wordUseCount(line.arabic, wordArabic) > 0) continue;
    seen.add(key);
    count++;
  }
  return count;
}

/**
 * Where the word is in a line, for cutting a gap: `findWordSpan` for a single
 * word, and for a phrase the run of words from the first one's first letter
 * to the last one's last, punctuation at either end left outside.
 */
export function findPhraseSpan(line: string, wordArabic: string): WordSpan | null {
  const parts = wordArabic.trim().split(/\s+/).map(normalizeArabicWord).filter(Boolean);
  if (parts.length <= 1) return findWordSpan(line, wordArabic);
  const tokens: Array<{ folded: string; start: number; end: number }> = [];
  const tokenRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line))) {
    const folded = normalizeArabicWord(m[0]);
    if (folded) tokens.push({ folded, start: m.index, end: m.index + m[0].length });
  }
  const isPunct = (ch: string) => {
    ARABIC_PUNCT_RE.lastIndex = 0;
    return ARABIC_PUNCT_RE.test(ch);
  };
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    if (!parts.every((part, j) => tokens[i + j].folded === part)) continue;
    let start = tokens[i].start;
    let end = tokens[i + parts.length - 1].end;
    while (start < end && isPunct(line[start])) start++;
    while (end > start && isPunct(line[end - 1])) end--;
    return { start, end };
  }
  return null;
}
