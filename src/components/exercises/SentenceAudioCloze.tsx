import { useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  sentenceAudioUrl: string;
  sentenceText: string;          // full sentence with the word in it
  correctWord: string;           // the missing word
  options: string[];             // 4 Arabic word choices
  onResult: (result: 'correct' | 'incorrect') => void;
}

export function SentenceAudioCloze({ sentenceAudioUrl, sentenceText, correctWord, options, onResult }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const playAudio = () => {
    setPlaying(true);
    const audio = new Audio(sentenceAudioUrl);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.play().catch(() => setPlaying(false));
  };

  const handleSelect = (option: string) => {
    if (selected) return;
    setSelected(option);
    const isCorrect = option === correctWord;
    setTimeout(() => onResult(isCorrect ? 'correct' : 'incorrect'), 800);
  };

  // Auto-play
  useState(() => { playAudio(); });

  // Create cloze sentence by replacing the target word with ___
  const clozeText = sentenceText.replace(correctWord, '______');

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-sm text-muted-foreground font-medium">Fill in the missing word</p>

      <button
        onClick={playAudio}
        className={cn(
          "w-14 h-14 rounded-full flex items-center justify-center",
          "bg-primary text-primary-foreground",
          "transition-all duration-200",
          playing && "animate-pulse-glow"
        )}
      >
        <Volume2 className="h-6 w-6" />
      </button>

      <p
        className="text-xl font-arabic text-foreground text-center leading-relaxed px-4"
        dir="rtl"
      >
        {clozeText}
      </p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {options.map((option) => {
          const isCorrectAnswer = option === correctWord;
          const isSelected = selected === option;
          const showResult = selected !== null;

          return (
            <button
              key={option}
              onClick={() => handleSelect(option)}
              disabled={selected !== null}
              dir="rtl"
              className={cn(
                "p-3 rounded-xl border-2 text-base font-bold transition-all duration-200",
                "font-arabic",
                !showResult && "border-border bg-card hover:border-primary/40 active:scale-[0.97]",
                showResult && isCorrectAnswer && "border-[hsl(var(--success))] bg-[hsl(var(--success)/0.1)]",
                showResult && isSelected && !isCorrectAnswer && "border-destructive bg-destructive/10",
                showResult && !isSelected && !isCorrectAnswer && "opacity-50"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
