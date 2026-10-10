import type { QuizFormat } from "@/lib/quizLadder";

/**
 * "Why not this one?" (quiz Phase 7): on a wrong pick, one tap asks the tutor
 * why the option picked does not fit where the right one does.
 *
 * The question is the pair and what it was picked for — the gap, the word
 * seen or heard, the picture, the line someone said — so the answer is about
 * this mix-up and not about the two words in general. It is sent once, as the
 * learner's message (`AskAISentence`'s `ask`; `openChat` holds it as a
 * one-shot `pendingAsk`), and is never part of the seed. Phase 6 built it for
 * the story's four-option gap; every choice step asks it now.
 *
 * Every choice format on the ladder has a question here, and no spoken one
 * does: a take has no "this one" to ask about.
 */
export type WhyNotInput =
  /**
   * A gap, the Arabic word put in it: the sentence's (steps 1 and 2) or the
   * story's passage (step 10 on a device that cannot record).
   */
  | {
      format: "cloze-hint" | "cloze" | "story-choice";
      picked: string;
      answer: string;
      /** The answer's meaning. */
      meaning: string;
    }
  /**
   * A meaning picked for the word, seen (`meaning`) or heard alone
   * (`listen`), or the picture of one (`picture-choice`).
   */
  | {
      format: "meaning" | "listen" | "picture-choice";
      /** The word asked about. */
      word: string;
      /** The meaning picked: an option's English, or the English behind its picture. */
      picked: string;
      /**
       * The Arabic word that meaning belongs to, where the deck says which:
       * what the learner took the word for, which is the confusion to explain.
       */
      pickedWord?: string | null;
      /** The word's own meaning. */
      meaning: string;
    }
  /** An Arabic word picked for a picture or a meaning (step 5). */
  | {
      format: "word-choice";
      picked: string;
      /** The picked word's own meaning, where it has one. */
      pickedMeaning?: string | null;
      answer: string;
      meaning: string;
    }
  /** A reply picked for a line of dialogue (step 6). */
  | {
      format: "reply-choice";
      /** The line said. */
      line: string;
      picked: string;
      answer: string;
    };

/** The ladder's choice formats: every one a wrong pick can ask about. */
export type WhyNotFormat = Extract<QuizFormat, WhyNotInput["format"]>;

/** What a wrong pick asks the tutor, by itself. */
export function whyNotQuestion(input: WhyNotInput): string {
  switch (input.format) {
    case "cloze-hint":
    case "cloze":
    case "story-choice": {
      const where = input.format === "story-choice" ? "passage" : "sentence";
      return (
        `In this ${where} I put «${input.picked}» in the gap, but the word is «${input.answer}» ("${input.meaning}"). ` +
        `Why doesn't «${input.picked}» fit here?`
      );
    }
    case "meaning":
    case "listen":
    case "picture-choice": {
      const theirs = input.pickedWord ? ` (that's «${input.pickedWord}»)` : "";
      if (input.format === "listen") {
        return (
          `I heard «${input.word}» and picked "${input.picked}"${theirs}, but it means "${input.meaning}". ` +
          `How do I hear the difference?`
        );
      }
      const what = input.format === "picture-choice" ? `the picture of "${input.picked}"` : `"${input.picked}"`;
      return (
        `I picked ${what}${theirs} for «${input.word}», but «${input.word}» means "${input.meaning}". ` +
        `How do I tell them apart?`
      );
    }
    case "word-choice": {
      const theirs = input.pickedMeaning ? ` ("${input.pickedMeaning}")` : "";
      return (
        `I picked «${input.picked}»${theirs} for "${input.meaning}", but the word is «${input.answer}». ` +
        `Why isn't it «${input.picked}»?`
      );
    }
    case "reply-choice":
      return (
        `Someone said «${input.line}» and I answered «${input.picked}», but the reply is «${input.answer}». ` +
        `Why doesn't «${input.picked}» fit as the answer?`
      );
  }
}
