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

export const RatingButtons = ({ 
  onRate, 
  easeFactor, 
  intervalDays, 
  repetitions,
  disabled 
}: RatingButtonsProps) => {
  const buttons: { rating: Rating; label: string; icon: React.ReactNode; variant: string }[] = [
    { 
      rating: 'again', 
      label: 'Again', 
      icon: <RotateCcw className="w-5 h-5" />,
      variant: 'bg-card border-2 border-destructive/30 text-foreground hover:border-destructive'
    },
    { 
      rating: 'hard', 
      label: 'Hard', 
      icon: <ThumbsDown className="w-5 h-5" />,
      variant: 'bg-card border-2 border-muted-foreground/30 text-foreground hover:border-muted-foreground'
    },
    { 
      rating: 'good', 
      label: 'Good', 
      icon: <ThumbsUp className="w-5 h-5" />,
      variant: 'bg-card border-2 border-primary/30 text-foreground hover:border-primary'
    },
    { 
      rating: 'easy', 
      label: 'Easy', 
      icon: <Sparkles className="w-5 h-5" />,
      variant: 'bg-card border-2 border-success/30 text-foreground hover:border-success'
    },
  ];

  return (
    <div className="w-full max-w-md mx-auto">
      <p className="text-center text-muted-foreground mb-3 font-medium text-sm">
        How well did you remember?
      </p>
      <div className="grid grid-cols-4 gap-2.5">
        {buttons.map(({ rating, label, icon, variant }) => {
          const nextInterval = estimateNextInterval(rating, easeFactor, intervalDays, repetitions);
          
          return (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center",
                "py-3 px-2 rounded-xl",
                variant,
                "font-medium",
                "shadow-card",
                "transform transition-all duration-200",
                "hover:scale-105 active:scale-95",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {icon}
              <span className="text-xs mt-1">{label}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{nextInterval}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
