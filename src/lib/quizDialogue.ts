import { sentenceHasWord } from "@/lib/arabicWord";
import { seededShuffle } from "@/lib/quizDistractors";

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

/**
 * "Someone says something; which reply fits?" — built from the lesson's own
 * dialogue, no generation.
 *
 * The reply is the first line that uses the word and has a line before it;
 * the prompt is that line before. The wrong replies are the dialogue's other
 * lines, none of which use the word (a second line with the word would be a
 * second right answer), topped up from `extraLines` — other lessons'
 * dialogue — when the dialogue is short. Null when the word opens the
 * dialogue, is not in it, or there are fewer than three wrong replies.
 */
export function buildReplyQuestion(
  dialogue: DialogueLine[],
  wordArabic: string,
  seed: string,
  extraLines: DialogueLine[] = [],
): ReplyQuestion | null {
  const index = dialogue.findIndex((line, i) => i > 0 && sentenceHasWord(line.arabic, wordArabic));
  if (index < 1) return null;
  const answer = dialogue[index];
  const prompt = dialogue[index - 1];

  const seen = new Set<string>([answer.arabic.trim(), prompt.arabic.trim()]);
  const wrong: DialogueLine[] = [];
  for (const line of [...dialogue, ...extraLines]) {
    const key = line.arabic.trim();
    if (seen.has(key) || sentenceHasWord(line.arabic, wordArabic)) continue;
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
