import { useMemo, useState } from "react";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Sentence {
  arabic: string;
  english: string;
}

interface ArticleSentencesProps {
  bodyDialect: string;
  summaryEnglish: string;
  sentences?: Sentence[];
  vocabulary?: { word_arabic: string; word_english: string }[];
}

// Fallback splitter when AI didn't return per-sentence pairs
function splitArabicSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+|\n+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const ArticleSentences = ({
  bodyDialect,
  summaryEnglish,
  sentences,
  vocabulary,
}: ArticleSentencesProps) => {
  const lines = useMemo<Sentence[]>(() => {
    if (sentences && sentences.length > 0) return sentences;
    return splitArabicSentences(bodyDialect).map((arabic) => ({
      arabic,
      english: "",
    }));
  }, [sentences, bodyDialect]);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        Tap any word for translation · Tap a line to reveal English
      </p>
      {lines.map((line, i) => {
        const isOpen = revealed.has(i);
        return (
          <div
            key={i}
            className="rounded-xl border border-border/40 bg-card/40 p-3"
          >
            <TappableArabicText
              text={line.arabic}
              vocabulary={vocabulary || []}
              source="souq-news"
              sentenceContext={{
                arabic: line.arabic,
                english: line.english || summaryEnglish,
              }}
            />
            {line.english && (
              <button
                onClick={() => toggle(i)}
                className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {isOpen ? "Hide translation" : "Reveal translation"}
              </button>
            )}
            <div
              className={cn(
                "grid transition-all duration-200",
                isOpen
                  ? "grid-rows-[1fr] opacity-100 mt-2"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {line.english}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
