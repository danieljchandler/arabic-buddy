/**
 * The post-video debrief, client side: the conversation as the page holds it,
 * and how it is sent back to the tutor.
 *
 * The page's thread is richer than a chat log. Besides the tutor's and the
 * learner's messages it holds the cards the session puts in front of the
 * learner — the word quiz, one shadowing card per line — and each card, once
 * finished, is something the tutor must hear about. So the thread is kept as
 * typed items, and `toWireMessages` flattens it into the plain user/assistant
 * turns the edge function reads, describing every finished card in the same
 * words (`describeQuizResults`, `describeShadowResult`) the tutor's prompt
 * tells it to expect.
 *
 * Everything that decides what happens next — which card follows a tutor
 * message, which step follows which — lives here as pure functions, so the
 * page is left with the rendering and the network.
 */
import {
  describeQuizResults,
  describeShadowResult,
  type DebriefStep,
  type QuizItem,
  type QuizOutcome,
  type ShadowLine,
  type ShadowOutcome,
} from "../../supabase/functions/_shared/videoDebriefCore";
import type { NativeReviewFrame } from "../../supabase/functions/_shared/arabicReviewCore";
import type { Rating } from "./spacedRepetition";

export {
  DEBRIEF_STEPS,
  STEP_LABELS,
  stripStepMarker,
  type DebriefStep,
  type QuizItem,
  type QuizOutcome,
  type ShadowLine,
  type ShadowOutcome,
} from "../../supabase/functions/_shared/videoDebriefCore";

/** What `video-debrief`'s plan action answers. */
export interface DebriefPlan {
  video: { id: string; title: string; dialect: string; cefrLevel: string | null };
  /** The learner's CEFR band the tutor pitches its language at. */
  level: string;
  steps: DebriefStep[];
  quiz: QuizItem[];
  shadow: ShadowLine[];
  /** How many quiz words the learner marked themselves, by how. */
  marked: { saved: number; lookedUp: number };
  questionCount: number;
  /** True when the video's study guide was written for this request. */
  preparedNow: boolean;
}

export type DebriefItem =
  | {
      kind: "tutor";
      id: string;
      step: DebriefStep;
      text: string;
      /** Still arriving. */
      streaming: boolean;
      review?: NativeReviewFrame;
    }
  | { kind: "learner"; id: string; step: DebriefStep; text: string }
  /** The word quiz. `outcomes` is set once every card has been answered. */
  | { kind: "quiz"; id: string; step: DebriefStep; outcomes?: QuizOutcome[] }
  /** One line to shadow. `outcome` is set once it was said (or skipped). */
  | { kind: "shadow"; id: string; step: DebriefStep; lineIndex: number; outcome?: ShadowOutcome };

export interface WireMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The thread as the tutor reads it.
 *
 * An unfinished card says nothing yet — the learner has not done it — and an
 * empty tutor message (a turn that failed before its first token) would be an
 * assistant turn with no content, which some providers refuse outright.
 */
export function toWireMessages(items: DebriefItem[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "tutor":
        if (item.text.trim()) out.push({ role: "assistant", content: item.text });
        break;
      case "learner":
        if (item.text.trim()) out.push({ role: "user", content: item.text });
        break;
      case "quiz":
        if (item.outcomes) out.push({ role: "user", content: describeQuizResults(item.outcomes) });
        break;
      case "shadow":
        if (item.outcome) out.push({ role: "user", content: describeShadowResult(item.outcome) });
        break;
    }
  }
  return out;
}

/** The card a step puts in front of the learner after the tutor's message, if any. */
export type PendingCard = { kind: "quiz" } | { kind: "shadow"; lineIndex: number } | null;

/**
 * What follows a tutor message that did not finish its step.
 *
 * The words step opens with one line from the tutor and then the quiz; the
 * shadowing step alternates a card and the tutor's feedback on it until every
 * line has had its turn. A card already on screen and not yet finished means
 * nothing new is due.
 */
export function pendingCard(step: DebriefStep, items: DebriefItem[], plan: Pick<DebriefPlan, "quiz" | "shadow">): PendingCard {
  const inStep = items.filter((item) => item.step === step);
  if (step === "words") {
    if (plan.quiz.length === 0) return null;
    return inStep.some((item) => item.kind === "quiz") ? null : { kind: "quiz" };
  }
  if (step === "shadow") {
    const cards = inStep.filter((item): item is Extract<DebriefItem, { kind: "shadow" }> => item.kind === "shadow");
    if (cards.some((card) => !card.outcome)) return null;
    return cards.length < plan.shadow.length ? { kind: "shadow", lineIndex: cards.length } : null;
  }
  return null;
}

/** The step after `current`, or null after the last. */
export function nextStep(steps: DebriefStep[], current: DebriefStep): DebriefStep | null {
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/**
 * How a quiz answer reschedules a saved word.
 *
 * Choosing the meaning of a word you saved minutes ago is a genuine retrieval,
 * so it is recorded as one — the same two ratings a recognition card gets for
 * "knew it" and "didn't". There is no "easy": the options were on screen.
 */
export function quizRating(correct: boolean): Rating {
  return correct ? "good" : "again";
}

/** Where the debrief for a video lives. */
export function debriefPath(videoId: string): string {
  return `/debrief/${videoId}`;
}

/** The words a finished quiz says to keep working on, saved ones first. */
export function wordsToReview(quiz: QuizItem[], outcomes: QuizOutcome[] | undefined): QuizItem[] {
  if (!outcomes) return [];
  const missed = new Set(outcomes.filter((o) => !o.correct).map((o) => o.arabic));
  return quiz
    .filter((q) => missed.has(q.arabic))
    .sort((a, b) => Number(Boolean(b.vocabularyId)) - Number(Boolean(a.vocabularyId)));
}
