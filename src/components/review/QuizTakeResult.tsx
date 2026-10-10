import { Loader2, RotateCcw, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { scoreBand, type WordResult } from "@/hooks/useAzurePronunciation";
import { cn } from "@/lib/utils";

interface QuizTakeResultProps {
  /** The scored take: the calibrated score, what was recognised, and per-word accuracy. */
  result: { overall: number; recognizedText?: string | null; words: WordResult[] };
  /** What the learner was asked to say. */
  target: string;
  transliteration?: string | null;
  /** The target said, played back right after the learner's own take. */
  targetAudio: { url: string | null; loading: boolean; play: (url: string) => void };
  onRetry: () => void;
  /** What "Ask AI" opens the tutor on. */
  ask: { arabic: string; english?: string };
  /** Anything the step shows beside the target (a story's passage, filled in). */
  children?: ReactNode;
}

/**
 * A scored take on a speaking step: the score and its band, what was heard,
 * and the target with its audio, so a learner who said a different word sees
 * that before they see a number. Shared by every speaking card, so a take
 * reads the same wherever it was asked.
 */
export const QuizTakeResult = ({
  result,
  target,
  transliteration,
  targetAudio,
  onRetry,
  ask,
  children,
}: QuizTakeResultProps) => {
  const band = scoreBand(Math.round(result.overall));
  const recognized = result.recognizedText?.trim() || null;
  return (
    <div className="w-full max-w-xs mx-auto rounded-xl bg-muted/40 border border-border p-4 animate-in fade-in duration-300">
      <div className="mb-1">
        <span className={cn("text-3xl font-bold", band.color)}>{Math.round(result.overall)}</span>
        <span className="text-sm text-muted-foreground ml-1">/ 100</span>
      </div>
      <p className={cn("text-sm font-medium mb-3", band.color)}>{band.label}</p>

      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">We heard</p>
      <p className="text-lg mb-3" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
        {recognized ?? "…nothing we could make out"}
      </p>

      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">The target</p>
      <div className="flex items-center justify-center gap-2">
        <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
          {target}
        </p>
        <button
          type="button"
          onClick={() => targetAudio.url && targetAudio.play(targetAudio.url)}
          disabled={!targetAudio.url}
          aria-label="Play the target"
          className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
        >
          {targetAudio.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
      {transliteration && <p className="text-sm text-muted-foreground italic">{transliteration}</p>}

      {result.words.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2 mt-3" dir="rtl">
          {result.words.map((w, i) => (
            <span key={i} className={cn("px-2 py-0.5 rounded-md text-sm font-medium bg-muted", scoreBand(w.accuracy).color)}>
              {w.word}
            </span>
          ))}
        </div>
      )}

      {children}

      <div className="mt-3 flex justify-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </Button>
        <AskAISentence arabic={ask.arabic} english={ask.english} variant="chip" />
      </div>
    </div>
  );
};
