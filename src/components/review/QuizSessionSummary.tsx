import { ArrowDownRight, ArrowUpRight, Flame, Target } from "lucide-react";
import { quizAccuracy, type QuizSessionStats } from "@/lib/quizSession";

interface QuizSessionSummaryProps {
  stats: QuizSessionStats;
}

/**
 * What a quiz session added up to, shown on the deck's end screen.
 *
 * Four numbers and nothing to chase: how often the answer was right, the
 * longest run, and how many words moved a step up or down the ladder. The
 * climbs are the one figure that means something in spaced-repetition terms,
 * which is why they are counted from the next question's step and not from
 * the answer.
 */
export const QuizSessionSummary = ({ stats }: QuizSessionSummaryProps) => {
  const accuracy = quizAccuracy(stats);
  if (accuracy == null) return null;

  const tiles = [
    { icon: Target, value: `${Math.round(accuracy * 100)}%`, label: "Right" },
    { icon: Flame, value: String(stats.bestCombo), label: "Best run" },
    { icon: ArrowUpRight, value: String(stats.promotions), label: "Climbed" },
    { icon: ArrowDownRight, value: String(stats.demotions), label: "Dropped" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 mb-8" role="list" aria-label="Quiz session summary">
      {tiles.map(({ icon: Icon, value, label }) => (
        <div key={label} role="listitem" className="bg-card rounded-xl p-3 border border-border">
          <Icon className="h-5 w-5 text-primary mx-auto mb-1.5" aria-hidden />
          <p className="text-lg font-bold text-foreground tabular-nums">{value}</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
};
