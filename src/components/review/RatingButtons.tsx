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
      color: 'from-red-400 to-red-600'
    },
    { 
      rating: 'hard', 
      label: 'Hard', 
      icon: <ThumbsDown className="w-5 h-5" />,
      color: 'from-orange-400 to-orange-600'
    },
    { 
      rating: 'good', 
      label: 'Good', 
      icon: <ThumbsUp className="w-5 h-5" />,
      color: 'from-green-400 to-green-600'
    },
    { 
      rating: 'easy', 
      label: 'Easy', 
      icon: <Sparkles className="w-5 h-5" />,
      color: 'from-blue-400 to-blue-600'
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
                `bg-gradient-to-br ${color}`,
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
