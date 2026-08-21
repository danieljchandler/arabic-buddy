import { useState, useEffect } from "react";
import { Check, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { TranscriptLine, VocabItem, WordToken } from "@/types/transcript";
import { AskAISentence } from "@/components/shared/AskAISentence";

/**
 * One tappable Arabic word: a popover with its gloss, a save-to-My-Words
 * button, and an Ask AI shortcut seeded with the sentence it came from.
 *
 * `parentLine` only needs to carry `arabic`/`translation` (plus the optional
 * `startMs`/`endMs` a saved word can play back from) — a caller with no real
 * `TranscriptLine` handy, such as an on-screen-text overlay with no audio,
 * can build a minimal one rather than needing an actual transcript row.
 */
export const ClickableWord = ({
  token,
  parentLine,
  onSave,
  isSaved,
}: {
  token: WordToken;
  parentLine: Pick<TranscriptLine, "arabic" | "startMs" | "endMs"> & { translation?: string };
  onSave?: (word: VocabItem) => void;
  isSaved?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [liveTranslation, setLiveTranslation] = useState<string | null>(null);
  const [liveMsa, setLiveMsa] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // A real gloss exists if gloss is set and is not a legacy compound marker
  const hasGloss = !!token.gloss && !token.gloss.startsWith("(→") && !token.compoundRef;
  const displayGloss = hasGloss ? token.gloss : liveTranslation;

  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: displayGloss || token.gloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  // Auto-translate when popover opens and no gloss exists
  useEffect(() => {
    if (open && !hasGloss && !liveTranslation && !isTranslating) {
      setIsTranslating(true);
      supabase.functions
        .invoke("translate-phrase", {
          body: {
            phrase: token.surface,
            sentenceArabic: parentLine.arabic,
            sentenceEnglish: parentLine.translation,
          },
        })
        .then(({ data, error }) => {
          if (!error && data?.translation) {
            setLiveTranslation(data.translation);
            if (data.msa) setLiveMsa(data.msa);
          }
        })
        .catch((err) => console.warn("Word translation failed:", err))
        .finally(() => setIsTranslating(false));
    }
  }, [open, hasGloss, liveTranslation, isTranslating, token.surface]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "cursor-pointer transition-colors duration-150 rounded px-0.5",
            "hover:bg-primary/15 hover:text-primary",
          )}
          role="button"
          tabIndex={0}
        >
          {token.surface}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto min-w-[200px] p-3 z-[100]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-center border-b border-border pb-2">
            <p
              className="text-xl font-bold text-foreground mb-1"
              style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
              dir="rtl"
            >
              {token.surface}
            </p>
            {displayGloss && <p className="text-sm text-muted-foreground">{displayGloss}</p>}
            {(token.standard || liveMsa) && (
              <p className="text-xs text-muted-foreground/70" dir="rtl">
                (فصحى: {token.standard || liveMsa})
              </p>
            )}
            {!displayGloss && isTranslating && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs text-muted-foreground">Translating…</span>
              </div>
            )}
            {!displayGloss && !isTranslating && (
              <p className="text-xs text-muted-foreground italic">No definition available</p>
            )}
          </div>
          {onSave && displayGloss && (
            <Button
              variant="default"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                onSave(vocabItem);
                setOpen(false);
              }}
              disabled={isSaved}
            >
              {isSaved ? (
                <><Check className="h-4 w-4" /> Saved to My Words</>
              ) : (
                <><BookOpen className="h-4 w-4" /> Save to My Words</>
              )}
            </Button>
          )}
          <div className="pt-1 border-t border-border">
            <AskAISentence
              arabic={parentLine.arabic}
              english={parentLine.translation}
              variant="chip"
              className="w-full justify-center"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ClickableWord;
