import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, Volume2, Play, Loader2, Quote } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  sentenceText: string;
  sentenceEnglish?: string | null;
  sentenceAudioUrl?: string | null;
  distractors: string[]; // other Arabic words from due queue
  onAnswered?: (correct: boolean) => void;
}

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Replace first occurrence of the target word (whitespace-bounded) with a blank
const buildCloze = (sentence: string, word: string) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\s|[،.,!؟?])${escaped}(?=$|\\s|[،.,!؟?])`);
  const m = sentence.match(re);
  if (!m) return null;
  const before = sentence.slice(0, m.index! + m[1].length);
  const after = sentence.slice(m.index! + m[0].length);
  return { before, after };
};

export const ReviewClozeCard = ({
  wordArabic,
  wordEnglish,
  sentenceText,
  sentenceEnglish,
  sentenceAudioUrl,
  distractors,
  onAnswered,
}: Props) => {
  const { activeDialect } = useDialect();
  const [selected, setSelected] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const cloze = useMemo(() => buildCloze(sentenceText, wordArabic), [sentenceText, wordArabic]);

  const options = useMemo(() => {
    const pool = distractors.filter((d) => d && d !== wordArabic);
    const picks = shuffle(pool).slice(0, 3);
    return shuffle([wordArabic, ...picks]);
  }, [distractors, wordArabic]);

  // Reset when card changes
  useEffect(() => {
    setSelected(null);
    setShowTranslation(false);
  }, [wordArabic, sentenceText]);

  // TTS fallback for the full sentence when no recorded audio
  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: sentenceText,
    skip: Boolean(sentenceAudioUrl),
    dialect: activeDialect,
  });
  const audioUrl = sentenceAudioUrl || ttsUrl;

  const playAudio = (url: string) => {
    const a = new Audio(url);
    a.play().catch(console.error);
  };

  // Auto-play sentence audio once available
  useEffect(() => {
    if (audioUrl) playAudio(audioUrl);
     
  }, [audioUrl, sentenceText]);

  if (!cloze) {
    // Word not found in sentence — caller should fall back to standard card
    return null;
  }

  const handleSelect = (opt: string) => {
    if (selected) return;
    setSelected(opt);
    onAnswered?.(opt === wordArabic);
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-6 text-center">
      <div className="flex items-center justify-center gap-2 mb-5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Fill in the missing word
        </span>
      </div>

      {/* Sentence with blank */}
      <div
        className="text-2xl leading-relaxed text-foreground mb-6"
        style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
        dir="rtl"
      >
        <span>{cloze.before}</span>
        <span
          className={cn(
            "inline-block min-w-[5rem] mx-1 px-3 py-0.5 rounded border-b-2 align-middle",
            selected == null && "border-primary/70 bg-primary/5",
            selected != null && selected === wordArabic && "border-green-600 bg-green-500/10 text-green-700",
            selected != null && selected !== wordArabic && "border-red-600 bg-red-500/10 text-red-700"
          )}
        >
          {selected ?? "ـــ"}
        </span>
        <span>{cloze.after}</span>
      </div>

      {/* Audio */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <Button
          variant="default"
          size="sm"
          onClick={() => audioUrl && playAudio(audioUrl)}
          disabled={!audioUrl || ttsLoading}
          className="gap-1.5"
        >
          {ttsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Play sentence
        </Button>
      </div>

      {/* Choices */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {options.map((opt) => {
          const isPicked = selected === opt;
          const isTarget = opt === wordArabic;
          const reveal = selected != null;
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={selected != null}
              className={cn(
                "rounded-lg border border-border bg-card px-3 py-3 text-lg transition-colors",
                "hover:bg-muted/60 disabled:hover:bg-card",
                reveal && isTarget && "border-green-600 bg-green-500/10",
                reveal && isPicked && !isTarget && "border-red-600 bg-red-500/10",
              )}
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              <span className="inline-flex items-center gap-1.5">
                {opt}
                {reveal && isTarget && <Check className="h-4 w-4 text-green-600" />}
                {reveal && isPicked && !isTarget && <X className="h-4 w-4 text-red-600" />}
              </span>
            </button>
          );
        })}
      </div>

      {selected != null && (
        <div className="animate-in fade-in duration-200 mt-4 text-center">
          <p className="text-base text-foreground">
            <span className="font-semibold">{wordArabic}</span>
            <span className="text-muted-foreground"> — {wordEnglish}</span>
          </p>
          {sentenceEnglish && (
            <div className="mt-3">
              {!showTranslation ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => setShowTranslation(true)}
                >
                  <Quote className="h-4 w-4" />
                  Show translation
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground italic">{sentenceEnglish}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
