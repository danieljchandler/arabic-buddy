import { useState, useRef } from "react";
import { Volume2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReviewWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
}

interface ReviewCardProps {
  word: ReviewWord;
  gradient: string;
  showAnswer: boolean;
  onReveal: () => void;
}

export const ReviewCard = ({ word, gradient, showAnswer, onReveal }: ReviewCardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = () => {
    if (word.audio_url) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
    } else {
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 1000);
    }
  };

  const handleAudioPlay = () => setIsPlaying(true);
  const handleAudioEnded = () => setIsPlaying(false);

  const handleCardClick = () => {
    if (!showAnswer) {
      onReveal();
    }
    playAudio();
  };

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Main Card */}
      <button
        onClick={handleCardClick}
        className={cn(
          "relative w-full aspect-square rounded-3xl overflow-hidden",
          "transform transition-all duration-300",
          "hover:scale-[1.02] active:scale-95",
          "shadow-card",
          "bg-card",
          "focus:outline-none focus:ring-4 focus:ring-primary/50"
        )}
      >
        {/* Image Container */}
        <div className="absolute inset-4 rounded-2xl overflow-hidden bg-muted flex items-center justify-center">
          {word.image_url ? (
            <img
              src={word.image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-8xl opacity-50">📷</span>
          )}
        </div>

        {/* Playing indicator overlay */}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center",
              `bg-gradient-to-br ${gradient}`,
              "animate-pulse-glow"
            )}>
              <Volume2 className="w-12 h-12 text-white" />
            </div>
          </div>
        )}

        {/* Reveal hint */}
        {!showAnswer && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={cn(
              "px-6 py-3 rounded-full",
              `bg-gradient-to-br ${gradient}`,
              "shadow-lg animate-bounce-gentle"
            )}>
              <span className="text-white font-bold text-lg flex items-center gap-2">
                <Volume2 className="w-5 h-5" />
                Tap to reveal!
              </span>
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className={cn(
          "absolute top-4 right-4 w-14 h-14 rounded-2xl",
          "flex items-center justify-center",
          `bg-gradient-to-br ${gradient}`,
          "shadow-lg"
        )}>
          <Volume2 className="w-7 h-7 text-white" />
        </div>
      </button>

      {/* Answer Display */}
      {showAnswer && (
        <div className="mt-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
          <p className="text-4xl font-black text-foreground mb-2" dir="rtl">
            {word.word_arabic}
          </p>
          <p className="text-xl text-muted-foreground font-semibold">
            {word.word_english}
          </p>
        </div>
      )}

      {/* Repeat Button */}
      {showAnswer && (
        <button
          onClick={playAudio}
          className={cn(
            "absolute -bottom-6 left-1/2 transform -translate-x-1/2",
            "w-16 h-16 rounded-full",
            "flex items-center justify-center",
            `bg-gradient-to-br ${gradient}`,
            "shadow-button",
            "transition-all duration-300",
            "hover:scale-110 active:scale-95",
            isPlaying && "animate-wiggle"
          )}
        >
          <RotateCcw className="w-8 h-8 text-white" />
        </button>
      )}

      {/* Hidden Audio Element */}
      {word.audio_url && (
        <audio
          ref={audioRef}
          src={word.audio_url}
          onPlay={handleAudioPlay}
          onEnded={handleAudioEnded}
          preload="auto"
        />
      )}
    </div>
  );
};
