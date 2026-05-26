import { useSiblingWords } from "@/hooks/useSiblingWords";
import { Volume2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SiblingWordsPanelProps {
  root: string | null | undefined;
  currentWordId: string;
  dialect: string;
  onPlayAudio?: (url: string) => void;
}

const stageStyles: Record<string, string> = {
  NEW: "bg-muted text-muted-foreground",
  LEARNING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  REVIEW: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  MASTERED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

/**
 * Surfaces other words the user already knows that share the same root.
 * Reinforces morphology — reviewing كتب shows كاتب, مكتبة, etc.
 */
export const SiblingWordsPanel = ({
  root,
  currentWordId,
  dialect,
  onPlayAudio,
}: SiblingWordsPanelProps) => {
  const { data: siblings, isLoading } = useSiblingWords({
    root,
    excludeId: currentWordId,
    dialect,
  });

  if (!root || isLoading || !siblings || siblings.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-primary/15 bg-primary/5 p-3 animate-in fade-in duration-300">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          From the same root
        </p>
        <span
          className="ml-auto text-sm font-arabic text-primary/80"
          dir="rtl"
          style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
        >
          {root}
        </span>
      </div>
      <ul className="space-y-1.5">
        {siblings.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
          >
            <span
              className="font-arabic text-base text-foreground/90 min-w-0 flex-shrink-0"
              dir="rtl"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
            >
              {s.word_arabic}
            </span>
            <span className="text-xs text-muted-foreground truncate flex-1">
              {s.word_english}
            </span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium",
                stageStyles[s.stage] ?? stageStyles.NEW,
              )}
            >
              {s.stage.toLowerCase()}
            </span>
            {s.word_audio_url && onPlayAudio && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={() => onPlayAudio(s.word_audio_url!)}
                aria-label={`Play ${s.word_english}`}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
