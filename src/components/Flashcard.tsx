import { useState, useRef } from "react";
import { Volume2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VocabularyWord } from "@/data/vocabulary";

interface FlashcardProps {
  word: VocabularyWord;
  gradient: string;
}

export const Flashcard = ({ word, gradient }: FlashcardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTapHint, setShowTapHint] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = () => {
    setShowTapHint(false);
    
    if (word.audioUrl) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
    } else {
      // Simulate audio playing with visual feedback when no audio file
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 1000);
    }
  };

  const handleAudioPlay = () => setIsPlaying(true);
  const handleAudioEnded = () => setIsPlaying(false);

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Main Card */}
      <button
        onClick={playAudio}
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
        <div className="absolute inset-4 rounded-2xl overflow-hidden bg-muted">
          <img
            src={word.imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>

        {/* Playing indicator overlay */}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center",
              gradient,
              "animate-pulse-glow"
            )}>
              <Volume2 className="w-12 h-12 text-white" />
            </div>
          </div>
        )}

        {/* Tap hint */}
        {showTapHint && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={cn(
              "px-6 py-3 rounded-full",
              gradient,
              "shadow-lg animate-bounce-gentle"
            )}>
              <span className="text-white font-bold text-lg flex items-center gap-2">
                <Volume2 className="w-5 h-5" />
                Tap to hear!
              </span>
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className={cn(
          "absolute top-4 right-4 w-14 h-14 rounded-2xl",
          "flex items-center justify-center",
          gradient,
          "shadow-lg"
        )}>
          <Volume2 className="w-7 h-7 text-white" />
        </div>
      </button>

      {/* Repeat Button */}
      <button
        onClick={playAudio}
        className={cn(
          "absolute -bottom-6 left-1/2 transform -translate-x-1/2",
          "w-16 h-16 rounded-full",
          "flex items-center justify-center",
          gradient,
          "shadow-button",
          "transition-all duration-300",
          "hover:scale-110 active:scale-95",
          isPlaying && "animate-wiggle"
        )}
      >
        <RotateCcw className="w-8 h-8 text-white" />
      </button>

      {/* Hidden Audio Element */}
      {word.audioUrl && (
        <audio
          ref={audioRef}
          src={word.audioUrl}
          onPlay={handleAudioPlay}
          onEnded={handleAudioEnded}
          preload="auto"
        />
      )}
    </div>
  );
};
