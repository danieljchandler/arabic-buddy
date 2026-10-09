/**
 * The question ladder: which kind of question a due card is asked as, read
 * off the card's own memory state.
 *
 * The quiz style (src/lib/reviewStyle.ts) serves the same due cards as the
 * flashcards, from the same two schedules — recognition and production — and
 * changes only the question. "Progressively harder" lives here, and it is
 * tied to spaced repetition rather than to a session counter: a word climbs
 * as its stability grows, drops when it lapses, and is asked the easiest
 * question the first time it is seen.
 *
 *   step 1  First look       sentence with the word blanked, four options,
 *                            and the word's meaning shown as a hint
 *   step 2  Fill the gap     the same gap, no hint
 *   step 3  Pick the picture the word, seen and heard → four pictures
 *   step 4  Hear it          the word's audio alone → pick the meaning
 *   step 5  Pick the word    the picture (or meaning) → four Arabic words,
 *                            each with its audio
 *   step 6  Answer the line  a line of the lesson's dialogue → pick the reply
 *                            that uses the word
 *   step 7  Say it           the picture alone (or the meaning) → say the
 *                            word; scored
 *   step 8  Say the line     the English line → say the Arabic sentence;
 *                            scored
 *
 * Steps 1–6 grade the recognition schedule, 7–8 the production schedule; the
 * deck already decides which direction a card is served in (it unlocks
 * production once recognition is confident), so the ladder only chooses the
 * question within that direction. Within recognition the climb goes from
 * form to meaning (gap, picture, listening) to meaning to form (pick the
 * word) to use (answer the line); production goes from the word to the line.
 * Nothing is typed: an Arabic keyboard is the one thing most learners do not
 * have, and saying the word is the skill.
 *
 * Every step has a fallback so the ladder never blocks a review: a word with
 * no sentence is asked for its meaning instead of a gap, a word with no
 * picture skips the picture steps, a word with no dialogue is asked to pick
 * the word instead of the reply, and a card with no material for any
 * question is served as the ordinary flashcard.
 */

export type QuizDirection = "recognition" | "production";

export type QuizFormat =
  /** Sentence gap, four Arabic options, the word's meaning shown. */
  | "cloze-hint"
  /** Sentence gap, four Arabic options, no hint. */
  | "cloze"
  /** The Arabic word with its audio → pick the English meaning. */
  | "meaning"
  /** The word, seen and heard → pick the picture of four. */
  | "picture-choice"
  /** The word's audio alone, no text → pick the English meaning. */
  | "listen"
  /** The picture (or the meaning) → pick the Arabic word of four, each with audio. */
  | "word-choice"
  /** A line of dialogue → pick the reply that uses the word. */
  | "reply-choice"
  /** The picture alone (or the meaning) → say the Arabic word; scored. */
  | "speak"
  /** The English line → say the Arabic sentence; scored. */
  | "speak-sentence"
  /** Nothing above fits this card: the ordinary flip-and-rate card. */
  | "flashcard";

export interface QuizMemory {
  /** FSRS stability in days, on the schedule the card is served on. */
  stability: number;
  /** Successful reviews on that schedule. */
  repetitions: number;
}

export interface QuizMaterial {
  /** A sentence that contains the word, so a gap can be cut from it. */
  hasSentence: boolean;
  /** The word has a picture of its own. */
  hasImage?: boolean;
  /** Other items available as wrong options for a text choice question. */
  distractors: number;
  /** Other items with a picture, as wrong options for the picture question. */
  imageDistractors?: number;
  /** A dialogue line uses the word, with a line before it and enough other lines. */
  hasReply?: boolean;
  /** Whether the device can record speech. */
  canSpeak: boolean;
}

export interface QuizRung {
  /** 1-based step on the ladder. */
  step: number;
  label: string;
  /** The question the step asks when the card has the material for it. */
  format: QuizFormat;
}

/** How many steps the ladder shows. */
export const QUIZ_STEP_COUNT = 8;

/** Options on a choice question, the answer included. */
export const CHOICE_COUNT = 4;

/**
 * Where the recognition steps change over, in days of stability. A first
 * guess: the numbers live here so they can be tuned from `review_log` once
 * the quiz has history. With the default FSRS weights a word rated Good each
 * time roughly triples its stability per review, so these fall near one step
 * per encounter. The production thresholds are on that schedule's own
 * stability.
 */
export const LADDER_THRESHOLDS = {
  /** Below this a recognition card is still a first look. */
  firstLookDays: 1,
  /** Below this the gap is asked without a hint. */
  gapDays: 4,
  /** Below this the picture is asked for. */
  pictureDays: 8,
  /** Below this the audio alone is asked. */
  hearDays: 16,
  /** Below this the word is picked from four; from here, the reply. */
  wordDays: 30,
  /** Production stability from which the whole sentence is asked for. */
  sentenceDays: 14,
} as const;

const RUNGS: Record<number, Omit<QuizRung, "step">> = {
  1: { label: "First look", format: "cloze-hint" },
  2: { label: "Fill the gap", format: "cloze" },
  3: { label: "Pick the picture", format: "picture-choice" },
  4: { label: "Hear it", format: "listen" },
  5: { label: "Pick the word", format: "word-choice" },
  6: { label: "Answer the line", format: "reply-choice" },
  7: { label: "Say it", format: "speak" },
  8: { label: "Say the line", format: "speak-sentence" },
};

function rung(step: number): QuizRung {
  return { step, ...RUNGS[step] };
}

/** The step a card's memory state puts it on, before material is considered. */
export function rungForMemory(memory: QuizMemory, direction: QuizDirection): QuizRung {
  const stability = Number.isFinite(memory.stability) ? Math.max(0, memory.stability) : 0;
  if (direction === "production") {
    return rung(stability >= LADDER_THRESHOLDS.sentenceDays ? 8 : 7);
  }
  if (memory.repetitions <= 0 || stability < LADDER_THRESHOLDS.firstLookDays) return rung(1);
  if (stability < LADDER_THRESHOLDS.gapDays) return rung(2);
  if (stability < LADDER_THRESHOLDS.pictureDays) return rung(3);
  if (stability < LADDER_THRESHOLDS.hearDays) return rung(4);
  if (stability < LADDER_THRESHOLDS.wordDays) return rung(5);
  return rung(6);
}

/**
 * The question to ask, after the card's material is taken into account.
 *
 * The fallbacks keep the direction: a recognition step never falls back to
 * speaking and a production step never to a choice, because the rating lands
 * on the schedule the deck served the card for. Within recognition a missing
 * piece of material falls to the nearest question the card can carry, so a
 * word without a picture is heard instead and a word without a dialogue is
 * picked from four instead of answered.
 */
export function pickQuizFormat(
  memory: QuizMemory,
  direction: QuizDirection,
  material: QuizMaterial,
): QuizFormat {
  const { format } = rungForMemory(memory, direction);
  const canChoose = material.distractors >= CHOICE_COUNT - 1;
  const canPicture = !!material.hasImage && (material.imageDistractors ?? 0) >= CHOICE_COUNT - 1;

  switch (format) {
    case "cloze-hint":
    case "cloze":
      if (!canChoose) return "flashcard";
      if (material.hasSentence) return format;
      // No sentence to cut a gap from: ask for the meaning, with the word in
      // view on a first look and only heard once it has been seen.
      return format === "cloze-hint" ? "meaning" : "listen";
    case "picture-choice":
      if (canPicture) return "picture-choice";
      return canChoose ? "listen" : "flashcard";
    case "listen":
      return canChoose ? "listen" : "flashcard";
    case "word-choice":
      return canChoose ? "word-choice" : "flashcard";
    case "reply-choice":
      if (material.hasReply) return "reply-choice";
      return canChoose ? "word-choice" : "flashcard";
    case "speak":
      return material.canSpeak ? "speak" : "flashcard";
    case "speak-sentence":
      if (!material.canSpeak) return "flashcard";
      return material.hasSentence ? "speak-sentence" : "speak";
    default:
      return "flashcard";
  }
}

/**
 * Whether the quiz should hold a word's production card back for now.
 *
 * The decks unlock production the moment recognition is rated Good, and
 * serve the production card as soon as it is due — in the same session, on
 * the refetch after the last card. For the flashcards that is fine. For the
 * ladder it skips steps: a word answered right once would be asked to be
 * said before it was ever asked without a hint, or heard alone. So the quiz
 * holds production until the recognition schedule's stability reaches the
 * picture step — the third encounter or so — which is where "say it"
 * belongs in the climb. The production schedule itself is untouched; the
 * card simply waits.
 */
export function holdsProduction(recognitionStability: number): boolean {
  const stability = Number.isFinite(recognitionStability) ? recognitionStability : 0;
  return stability < LADDER_THRESHOLDS.pictureDays;
}

/** Whether a format is scored by the app (true) or self-rated (false). */
export function isGradedFormat(format: QuizFormat): boolean {
  return format !== "flashcard";
}

/** Whether a format asks the learner to speak. */
export function isSpokenFormat(format: QuizFormat): boolean {
  return format === "speak" || format === "speak-sentence";
}
