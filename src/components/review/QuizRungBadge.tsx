import { Flame } from "lucide-react";
import { QUIZ_STEP_COUNT } from "@/lib/quizLadder";
import { cn } from "@/lib/utils";

interface QuizRungBadgeProps {
  step: number;
  label: string;
  /** Consecutive correct answers; shown from two up. */
  combo?: number;
  className?: string;
}

/**
 * Where a card sits on the ladder, and the session's combo beside it.
 *
 * The ladder is invisible otherwise: a learner who is asked to fill a gap
 * today and to say the word next week has no way to see that the word moved.
 * A dot per step (`QUIZ_STEP_COUNT`) and the step's name make the climb
 * legible without a number to chase.
 */
export const QuizRungBadge = ({ step, label, combo = 0, className }: QuizRungBadgeProps) => (
  <div className={cn("flex items-center justify-center gap-3 text-xs text-muted-foreground", className)}>
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Step ${step} of ${QUIZ_STEP_COUNT}: ${label}`}
    >
      {Array.from({ length: QUIZ_STEP_COUNT }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors",
            i + 1 < step && "bg-primary/40",
            i + 1 === step && "bg-primary h-2 w-2",
            i + 1 > step && "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
    <span className="font-medium text-foreground">{label}</span>
    {combo >= 2 && (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400 font-semibold"
        aria-label={`${combo} in a row`}
      >
        <Flame className="h-3 w-3" />
        {combo}
      </span>
    )}
  </div>
);
