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
  const buttons: { rating: Rating; label: string; icon: React.ReactNode; color: string }[] = [
    { 
      rating: 'again', 
      label: 'Again', 
      icon: <RotateCcw className="w-5 h-5" />,
      color: 'bg-gradient-red'
    },
    { 
      rating: 'hard', 
      label: 'Hard', 
      icon: <ThumbsDown className="w-5 h-5" />,
      color: 'bg-gradient-sand'
    },
    { 
      rating: 'good', 
      label: 'Good', 
      icon: <ThumbsUp className="w-5 h-5" />,
      color: 'bg-gradient-green'
    },
    { 
      rating: 'easy', 
      label: 'Easy', 
      icon: <Sparkles className="w-5 h-5" />,
      color: 'bg-gradient-indigo'
    },
  ];

  return (
    <div className="w-full max-w-md mx-auto">
      <p className="text-center text-muted-foreground mb-4 font-semibold">
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
                "py-4 px-2 rounded-2xl",
                color,
                "text-white font-bold",
                "shadow-lg",
                "transform transition-all duration-200",
                "hover:scale-105 active:scale-95",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {icon}
              <span className="text-sm mt-1">{label}</span>
              <span className="text-xs opacity-80 mt-1">{nextInterval}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
