/**
 * The daily recap, client side: what the strip at the bottom of the screen
 * decides, and the session page's half of the conversation.
 *
 * The recap is the debrief's next-morning counterpart — a guided chat with
 * the tutor over what the learner did yesterday (or, when yesterday was
 * empty, over the last week). The server builds the plan from what the app
 * recorded (`_shared/recapCore.ts`, `_shared/recapWindow.ts`); this file
 * holds everything the page decides without the network: the thread as typed
 * items, how it is flattened for the tutor, which card follows which step,
 * what the learner's clock says, and when the strip has earned its place on
 * screen.
 */
import {
  describeQuizResults,
  describeShadowResult,
  type RecapPlan as ServerRecapPlan,
  type RecapStep,
  type RecapOutcome,
} from "../../supabase/functions/_shared/recapCore";
import type { NativeReviewFrame } from "../../supabase/functions/_shared/arabicReviewCore";
import { localDateKey } from "./localDate";
import type { QuizItem, QuizOutcome, ShadowOutcome } from "./videoDebrief";

export {
  RECAP_STEPS,
  RECAP_STEP_LABELS,
  isRecapStep,
  stripStepMarker,
  windowLabel,
  windowTitle,
  type RecapCounts,
  type RecapOutcome,
  type RecapQuizItem,
  type RecapShadowLine,
  type RecapSlip,
  type RecapStep,
} from "../../supabase/functions/_shared/recapCore";

/** Where the recap lives. */
export const RECAP_PATH = "/recap";

/** The Today-queue task id, and so the key completion is stored under. */
export const RECAP_TASK_ID = "recap";

/** XP for a finished session: between the daily story and the challenge. */
export const RECAP_XP = 25;

/** What `daily-recap`'s summary action answers. */
export interface RecapSummary {
  /** The learner's local date the summary is for (their "today"). */
  date: string;
  /** 1 when yesterday had something in it; 7 when the week stood in for it. */
  windowDays: number;
  hasContent: boolean;
  counts: ServerRecapPlan["counts"];
  /** "Yesterday: 1 video, 4 new words, 2 slips" */
  headline: string;
  firstVideo: string | null;
  status: "none" | "ready" | "completed";
}

/** What `daily-recap`'s plan action answers. */
export interface RecapPlan extends ServerRecapPlan {
  status: "ready" | "completed";
  /** False when the plan could not be kept (the migration is not applied); the same plan is rebuilt per request. */
  stored: boolean;
}

export type RecapItem =
  | {
      kind: "tutor";
      id: string;
      step: RecapStep;
      text: string;
      /** Still arriving. */
      streaming: boolean;
      review?: NativeReviewFrame;
    }
  | { kind: "learner"; id: string; step: RecapStep; text: string }
  /** The word quiz. `outcomes` is set once every card has been answered. */
  | { kind: "quiz"; id: string; step: RecapStep; outcomes?: QuizOutcome[] }
  /** One line to shadow. `outcome` is set once it was said (or skipped). */
  | { kind: "shadow"; id: string; step: RecapStep; lineIndex: number; outcome?: ShadowOutcome };

export interface WireMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The thread as the tutor reads it: the two voices, plus every finished card
 * described in the words the tutor's prompt tells it to expect. An unfinished
 * card says nothing yet, and an empty tutor turn is dropped — some providers
 * refuse an assistant message with no content.
 */
export function toRecapWireMessages(items: RecapItem[]): WireMessage[] {
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
export type PendingRecapCard = { kind: "quiz" } | { kind: "shadow"; lineIndex: number } | null;

/**
 * What follows a tutor message that did not finish its step: the quiz after
 * the words step's opening line, one shadowing card per line in turn. A card
 * already on screen and not yet finished means nothing new is due.
 */
export function pendingRecapCard(
  step: RecapStep,
  items: RecapItem[],
  plan: Pick<RecapPlan, "quiz" | "shadow">,
): PendingRecapCard {
  const inStep = items.filter((item) => item.step === step);
  if (step === "words") {
    if (plan.quiz.length === 0) return null;
    return inStep.some((item) => item.kind === "quiz") ? null : { kind: "quiz" };
  }
  if (step === "shadow") {
    const cards = inStep.filter((item): item is Extract<RecapItem, { kind: "shadow" }> => item.kind === "shadow");
    if (cards.some((card) => !card.outcome)) return null;
    return cards.length < plan.shadow.length ? { kind: "shadow", lineIndex: cards.length } : null;
  }
  return null;
}

/** The step after `current`, or null after the last. */
export function nextRecapStep(steps: RecapStep[], current: RecapStep): RecapStep | null {
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/**
 * What the client tells the server about its clock.
 *
 * Profiles store no timezone, and "yesterday" computed in UTC is the wrong
 * day for everyone in the Americas, so each request carries the learner's
 * local date and offset. The offset is east-positive (the opposite sign to
 * `getTimezoneOffset`), matching what the server parses.
 */
export function recapClock(now: Date = new Date()): { localDate: string; tzOffsetMinutes: number } {
  // `-0` for a learner on UTC would round-trip as 0 but fail a strict equality.
  return { localDate: localDateKey(now), tzOffsetMinutes: 0 - now.getTimezoneOffset() || 0 };
}

/** What a finished session reports back: the card results and the steps it got through. */
export function recapOutcome(items: RecapItem[], doneSteps: Iterable<RecapStep>): RecapOutcome {
  const quiz = items.find((item): item is Extract<RecapItem, { kind: "quiz" }> => item.kind === "quiz");
  return {
    quiz: quiz?.outcomes ?? [],
    shadow: items.flatMap((item) => (item.kind === "shadow" && item.outcome ? [item.outcome] : [])),
    stepsDone: [...doneSteps],
  };
}

/** The words a finished quiz says to keep working on, saved ones first. */
export function recapWordsToReview(quiz: QuizItem[], outcomes: QuizOutcome[] | undefined): QuizItem[] {
  if (!outcomes) return [];
  const missed = new Set(outcomes.filter((o) => !o.correct).map((o) => o.arabic));
  return quiz
    .filter((q) => missed.has(q.arabic))
    .sort((a, b) => Number(Boolean(b.vocabularyId)) - Number(Boolean(a.vocabularyId)));
}

// ── The strip ──────────────────────────────────────────────────────────────

const NUDGE_KEY = "hakiya:recap-nudge:v1";

/** Whether the learner waved today's strip away on this device. */
export function isRecapNudgeDismissed(date: string): boolean {
  try {
    return window.localStorage.getItem(NUDGE_KEY) === date;
  } catch {
    return false;
  }
}

/** Wave today's strip away. It comes back tomorrow, when there is a new day to go over. */
export function dismissRecapNudge(date: string): void {
  try {
    window.localStorage.setItem(NUDGE_KEY, date);
  } catch {
    // Private mode or a full quota: the strip will simply return on reload.
  }
}

export interface NudgeDecision {
  /** Not an auth, admin, print or immersive route, and not the recap itself. */
  routeAllowed: boolean;
  isAuthenticated: boolean;
  summary: RecapSummary | null | undefined;
  /** Waved away today on this device. */
  dismissed: boolean;
  /** Done today, by this device's Today queue or by the server's record. */
  completedToday: boolean;
}

/**
 * Whether the strip has earned its place on this screen.
 *
 * It shows for a signed-in learner, on a route where chrome belongs, when
 * there is something to go over, and until the learner either does it or
 * waves it away for the day. Never while the summary is still loading: a
 * strip that appears a second after the page did is a strip the thumb was
 * about to land next to.
 */
export function shouldShowRecapNudge(decision: NudgeDecision): boolean {
  if (!decision.routeAllowed || !decision.isAuthenticated) return false;
  const { summary } = decision;
  if (!summary || !summary.hasContent) return false;
  if (summary.status === "completed" || decision.completedToday || decision.dismissed) return false;
  return true;
}

/** "Yesterday's recap" or "This week's recap". */
export function recapTitle(windowDays: number): string {
  return windowDays <= 1 ? "Yesterday's recap" : "This week's recap";
}
