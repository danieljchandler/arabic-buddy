import { cn } from "@/lib/utils";
import { Rating, estimateNextInterval } from "@/lib/spacedRepetition";
import { RotateCcw, ThumbsDown, ThumbsUp, Sparkles } from "lucide-react";

interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  disabled?: boolean;
}

/**
 * RatingButtons - Spaced repetition rating interface
 * 
 * Clean, minimal design that doesn't overwhelm the learner.
 */
export const RatingButtons = ({ 
  onRate, 
  easeFactor, 
  intervalDays, 
  repetitions,
  disabled 
}: RatingButtonsProps) => {
  const buttons: { rating: Rating; label: string; icon: React.ReactNode; color: string }[] = [
    { 
      rating: 'again', 
      label: 'Again', 
      icon: <RotateCcw className="w-4 h-4" />,
      color: 'border-destructive/20 hover:border-destructive/40'
    },
    { 
      rating: 'hard', 
      label: 'Hard', 
      icon: <ThumbsDown className="w-4 h-4" />,
      color: 'border-muted-foreground/20 hover:border-muted-foreground/40'
    },
    { 
      rating: 'good', 
      label: 'Good', 
      icon: <ThumbsUp className="w-4 h-4" />,
      color: 'border-primary/20 hover:border-primary/40'
    },
    { 
      rating: 'easy', 
      label: 'Easy', 
      icon: <Sparkles className="w-4 h-4" />,
      color: 'border-success/20 hover:border-success/40'
    },
  ];

  return (
    <div className="w-full max-w-sm mx-auto">
      <p className="text-center text-muted-foreground mb-4 text-sm">
        How well did you remember?
      </p>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map(({ rating, label, icon, color }) => {
          const nextInterval = estimateNextInterval(rating, easeFactor, intervalDays, repetitions);
          
          return (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center",
                "py-3 px-2 rounded-lg",
                "bg-card border",
                color,
                "transition-all duration-200",
                "hover:scale-[1.02] active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {icon}
              <span className="text-xs font-medium mt-1.5 text-foreground">{label}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{nextInterval}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
