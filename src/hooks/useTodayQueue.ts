import { useEffect, useState } from "react";
import { useReviewSession } from "@/hooks/useReviewSession";
import { useUserSetPhrasesDueCount } from "@/hooks/useSetPhrases";
import { useMistakes } from "@/hooks/useLearnerErrors";
import { useTodaysVideo } from "@/hooks/useTodaysVideo";
import { useDialect } from "@/contexts/DialectContext";
import { isTaskCompletedToday } from "@/lib/todayCompletion";
import { BookOpen, Play, Newspaper, MessageCircle, Flame, Brain, Sparkles, Target, Mic, type LucideIcon } from "lucide-react";

export type TodayTaskId =
  | "flashcards"
  | "daily-challenge"
  | "daily-story"
  | "reading"
  | "listening"
  | "souq"
  | "set-phrases"
  | "mistake-drill"
  | "speaking";

/** Unresolved mistake groups before the drill earns a slot in the queue. */
const MISTAKE_DRILL_THRESHOLD = 3;

/**
 * Which speaking surface today's task points at.
 *
 * Until now the queue was entirely receptive plus flashcards and drills; the
 * speaking surfaces existed but were never scheduled. The effect of AI
 * speaking practice that actually replicates is a drop in speaking anxiety
 * (d = 0.39–0.76 across two designs); the evidence for a skill gain over
 * alternatives is weak-to-null (docs/language-learning-research-2026-09.md
 * §6). So the copy promises practice, never speed.
 *
 * Rotates by calendar day so the three production surfaces each get a turn
 * without the learner choosing: a monologue, a chunk used in a situation, a
 * line said and scored. The daily goal is a fixed *count* of tasks, so this
 * competes for the same slots rather than adding to them — the evidence is
 * for speaking that substitutes for other study, not stacks on it.
 */
export function speakingSurfaceFor(date: Date): Pick<TodayTask, "title" | "subtitle" | "route"> {
  const day = Math.floor(date.getTime() / 86_400_000);
  switch (day % 3) {
    case 0:
      return { title: "Talk for a minute", subtitle: "Monologue", route: "/monologue" };
    case 1:
      return { title: "Use a phrase in a situation", subtitle: "Set phrases", route: "/set-phrases/practice" };
    default:
      return { title: "Say a line out loud", subtitle: "Pronunciation", route: "/pronunciation" };
  }
}

export interface TodayTask {
  id: TodayTaskId;
  title: string;
  subtitle?: string;
  countBadge?: string;
  estMinutes: number;
  icon: LucideIcon;
  route: string;
  done: boolean;
  hidden?: boolean;
  xpEstimate: number;
}

const useCompletionTick = () => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("today:tasks-changed", onChange);
    return () => window.removeEventListener("today:tasks-changed", onChange);
  }, []);
};

export const useTodayQueue = (): TodayTask[] => {
  useCompletionTick();
  const { activeDialect } = useDialect();
  // Covers all three SRS decks (curriculum, saved words, saved phrases) — the
  // flashcards task used to count only the personal-vocabulary deck, so cards
  // due elsewhere never showed up in the daily queue.
  const session = useReviewSession();
  const { data: phrasesDue } = useUserSetPhrasesDueCount();
  const { data: mistakeGroups } = useMistakes(activeDialect);
  // The same pick the home page leads with, so the task and the card at the top
  // of the page can never point at two different clips.
  const { video: todaysVideo } = useTodaysVideo();

  const vocabDueCount = session.totalDue;

  const tasks: TodayTask[] = [
    {
      id: "flashcards",
      title: vocabDueCount > 0 ? `Review ${vocabDueCount} word${vocabDueCount === 1 ? "" : "s"}` : "Flashcards reviewed",
      subtitle: "Spaced repetition",
      countBadge: vocabDueCount > 0 ? String(vocabDueCount) : undefined,
      estMinutes: Math.max(2, Math.min(15, Math.ceil(vocabDueCount * 0.4))),
      icon: Brain,
      // "/review" is the session entry point — it walks every deck that has
      // cards due, forwarding past any that are already clear.
      route: "/review",
      done: vocabDueCount === 0,
      hidden: vocabDueCount === 0 && !isTaskCompletedToday("flashcards"),
      xpEstimate: vocabDueCount * 3,
    },
    {
      id: "daily-challenge",
      title: "Daily challenge",
      subtitle: "Streak multiplier",
      estMinutes: 3,
      icon: Flame,
      route: "/daily-challenge",
      done: isTaskCompletedToday("daily-challenge"),
      xpEstimate: 20,
    },
    {
      id: "daily-story",
      title: "Today's story",
      subtitle: "Built from your words",
      estMinutes: 4,
      icon: Sparkles,
      route: "/today/story",
      done: isTaskCompletedToday("daily-story"),
      xpEstimate: 25,
    },
    {
      id: "reading",
      title: "Read 1 short passage",
      subtitle: "Reading Practice",
      estMinutes: 5,
      icon: BookOpen,
      route: "/reading",
      done: isTaskCompletedToday("reading"),
      xpEstimate: 15,
    },
    {
      // Kept as "listening" because that is the key completions are stored
      // under in localStorage; renaming the id would silently un-tick the task
      // for everyone who had already done it today. The home page renders this
      // one as the WatchTodayCard hero rather than as a queue row, so it still
      // counts towards "n of m tasks done" without appearing twice.
      id: "listening",
      title: "Watch today's video",
      subtitle: "Discover",
      estMinutes: 3,
      icon: Play,
      // Straight to today's clip rather than the browse list — the point of the
      // task is that the choice has already been made.
      route: todaysVideo ? `/discover/${todaysVideo.id}` : "/discover",
      done: isTaskCompletedToday("listening"),
      hidden: !todaysVideo,
      xpEstimate: 10,
    },
    {
      id: "souq",
      title: "1 Souq article",
      subtitle: "News in dialect",
      estMinutes: 4,
      icon: Newspaper,
      route: "/souq-news",
      done: isTaskCompletedToday("souq"),
      xpEstimate: 15,
    },
    {
      // Fossilized errors persist because nothing forces a correction; the
      // drill earns a queue slot once enough distinct targets have piled up.
      id: "mistake-drill",
      title: "Fix a stuck mistake",
      subtitle: "Your own error list",
      countBadge:
        (mistakeGroups?.length ?? 0) >= MISTAKE_DRILL_THRESHOLD
          ? String(mistakeGroups!.length)
          : undefined,
      estMinutes: 4,
      icon: Target,
      route: "/mistakes",
      done: isTaskCompletedToday("mistake-drill"),
      hidden:
        (mistakeGroups?.length ?? 0) < MISTAKE_DRILL_THRESHOLD &&
        !isTaskCompletedToday("mistake-drill"),
      xpEstimate: 20,
    },
    {
      id: "speaking",
      ...speakingSurfaceFor(new Date()),
      estMinutes: 10,
      icon: Mic,
      done: isTaskCompletedToday("speaking"),
      xpEstimate: 20,
    },
    {
      id: "set-phrases",
      title: phrasesDue && phrasesDue > 0 ? `Practice ${phrasesDue} phrase${phrasesDue === 1 ? "" : "s"}` : "Set phrases reviewed",
      subtitle: "Everyday expressions",
      countBadge: phrasesDue && phrasesDue > 0 ? String(phrasesDue) : undefined,
      estMinutes: 3,
      icon: MessageCircle,
      route: "/set-phrases",
      done: !phrasesDue || phrasesDue === 0,
      hidden: (!phrasesDue || phrasesDue === 0) && !isTaskCompletedToday("set-phrases"),
      xpEstimate: (phrasesDue ?? 0) * 3,
    },
  ];

  return tasks;
};
