import { useState, useRef } from "react";
import { Volume2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface FlashcardWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
}

interface FlashcardProps {
  word: FlashcardWord;
  gradient: string;
}

export const Flashcard = ({ word, gradient }: FlashcardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTapHint, setShowTapHint] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = () => {
    setShowTapHint(false);
    
    if (word.audio_url) {
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
          "relative w-full aspect-[4/3] rounded-xl overflow-hidden",
          "transform transition-all duration-200",
          "hover:scale-[1.02] active:scale-95",
          "shadow-card",
          "bg-card border border-border",
          "focus:outline-none focus:ring-2 focus:ring-primary/50"
        )}
      >
        {/* Image Container */}
        <div className="absolute inset-3 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {word.image_url ? (
            <img
              src={word.image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted-foreground/10 flex items-center justify-center">
              <Volume2 className="w-8 h-8 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Playing indicator overlay */}
        {isPlaying && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
              <Volume2 className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
        )}

        {/* Tap hint */}
        {showTapHint && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-5 py-2.5 rounded-full bg-primary shadow-lg animate-bounce-gentle">
              <span className="text-primary-foreground font-semibold text-base flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Tap to hear
              </span>
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className="absolute top-3 right-3 w-10 h-10 rounded-lg flex items-center justify-center bg-primary shadow-lg">
          <Volume2 className="w-5 h-5 text-primary-foreground" />
        </div>
      </button>

      {/* Repeat Button */}
      <button
        onClick={playAudio}
        className={cn(
          "absolute -bottom-5 left-1/2 transform -translate-x-1/2",
          "w-12 h-12 rounded-full",
          "flex items-center justify-center",
          "bg-primary shadow-button",
          "transition-all duration-200",
          "hover:scale-110 active:scale-95",
          isPlaying && "animate-wiggle"
        )}
      >
        <RotateCcw className="w-6 h-6 text-primary-foreground" />
      </button>

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
