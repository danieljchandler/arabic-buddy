import { useEffect, useState } from "react";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useUserSetPhrasesDueCount } from "@/hooks/useSetPhrases";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { useDialect } from "@/contexts/DialectContext";
import { isTaskCompletedToday } from "@/lib/todayCompletion";
import { BookOpen, Headphones, Newspaper, MessageCircle, Flame, Brain, type LucideIcon } from "lucide-react";

export type TodayTaskId =
  | "flashcards"
  | "daily-challenge"
  | "reading"
  | "listening"
  | "souq"
  | "set-phrases";

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
  const { data: vocabDue } = useUserVocabularyDueCount();
  const { data: phrasesDue } = useUserSetPhrasesDueCount();
  const { data: videos } = useDiscoverVideos({ dialect: activeDialect });

  const vocabDueCount = vocabDue?.dueCount ?? 0;
  const hasListening = (videos?.length ?? 0) > 0;

  const tasks: TodayTask[] = [
    {
      id: "flashcards",
      title: vocabDueCount > 0 ? `Review ${vocabDueCount} word${vocabDueCount === 1 ? "" : "s"}` : "Flashcards reviewed",
      subtitle: "Spaced repetition",
      countBadge: vocabDueCount > 0 ? String(vocabDueCount) : undefined,
      estMinutes: Math.max(2, Math.min(15, Math.ceil(vocabDueCount * 0.4))),
      icon: Brain,
      route: "/review/my-words",
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
      id: "listening",
      title: "Listen to 1 clip",
      subtitle: "Discover",
      estMinutes: 3,
      icon: Headphones,
      route: "/discover",
      done: isTaskCompletedToday("listening"),
      hidden: !hasListening,
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
