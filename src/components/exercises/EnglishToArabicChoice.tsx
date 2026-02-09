import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  wordEnglish: string;
  correctArabic: string;
  options: string[];
  onResult: (result: 'correct' | 'incorrect') => void;
}

export function EnglishToArabicChoice({ wordEnglish, correctArabic, options, onResult }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (option: string) => {
    if (selected) return;
    setSelected(option);
    const isCorrect = option === correctArabic;
    setTimeout(() => onResult(isCorrect ? 'correct' : 'incorrect'), 800);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm text-muted-foreground font-medium">Choose the Arabic word</p>

      <p className="text-2xl font-bold text-foreground">{wordEnglish}</p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {options.map((option) => {
          const isCorrectAnswer = option === correctArabic;
          const isSelected = selected === option;
          const showResult = selected !== null;

          return (
            <button
              key={option}
              onClick={() => handleSelect(option)}
              disabled={selected !== null}
              dir="rtl"
              className={cn(
                "p-4 rounded-xl border-2 text-lg font-bold transition-all duration-200",
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
