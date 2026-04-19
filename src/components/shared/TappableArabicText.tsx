import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface WordEnrichment {
  definition?: string;
  root?: string;
  otherUses?: { arabic: string; english: string }[];
}

interface WordData {
  translation: string;
  enrichment?: WordEnrichment;
  enriching?: boolean;
}

const enrichWord = async (
  word: string,
  dialect: string,
  sentenceContext?: { arabic?: string; english?: string }
): Promise<WordEnrichment> => {
  try {
    const { data, error } = await supabase.functions.invoke("word-enrichment", {
      body: {
        word,
        dialect,
        sentenceArabic: sentenceContext?.arabic,
        sentenceEnglish: sentenceContext?.english,
      },
    });
    if (error) throw error;
    return {
      definition: data?.definition || undefined,
      root: data?.root || undefined,
      otherUses: Array.isArray(data?.uses) ? data.uses : [],
    };
  } catch {
    return {};
  }
};

interface TappableArabicTextProps {
  /** The Arabic text to render as tappable words */
  text: string;
  /** Optional vocabulary context for instant translation before enrichment */
  vocabulary?: { word_arabic: string; word_english: string }[];
  /** Source label for saved words (e.g. "souq-news", "reading-practice") */
  source?: string;
  /** Additional className for the container */
  className?: string;
  /** Optional surrounding sentence (Arabic + accepted English) so word translations match context */
  sentenceContext?: { arabic?: string; english?: string };
}

/**
 * Renders Arabic text where each word is tappable.
 * Tapping a word shows a popover with translation, root, related forms,
 * and a "Save to My Words" button — matching the Reading Practice UX.
 */
export const TappableArabicText = ({
  text,
  vocabulary = [],
  source = "tappable-text",
  className,
  sentenceContext,
}: TappableArabicTextProps) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const addVocab = useAddUserVocabulary();
  const [wordTranslations, setWordTranslations] = useState<Record<string, WordData>>({});

  const handleWordTap = async (word: string) => {
    const cleanWord = word.replace(/[،.؟!,؛:«»"]/g, "").trim();
    if (!cleanWord) return;
    if (wordTranslations[cleanWord]) return;

    // Check vocabulary context for instant match
    const vocabMatch = vocabulary.find(
      (v) => cleanWord.includes(v.word_arabic) || v.word_arabic.includes(cleanWord)
    );
    const translation = vocabMatch?.word_english || "";

    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation, enriching: true },
    }));

    const enrichment = await enrichWord(cleanWord, activeDialect, sentenceContext ?? { arabic: text });
    const definition = enrichment?.definition || translation || "";

    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation: definition, enrichment, enriching: false },
    }));
  };

  const saveAsFlashcard = (arabic: string, english: string, root?: string) => {
    if (!user) {
      toast.error("Sign in to save flashcards");
      return;
    }
    addVocab.mutate(
      { word_arabic: arabic, word_english: english, root: root || undefined, source },
      {
        onSuccess: () => toast.success("Saved to My Words!"),
        onError: (err: any) => {
          if (err?.message?.includes("duplicate")) {
            toast.info("Already in your words");
          } else {
            toast.error("Failed to save");
          }
        },
      }
    );
  };

  const words = text.split(/\s+/);

  return (
    <p
      className={cn(
        "text-base leading-loose text-foreground/90 flex flex-wrap justify-end gap-1 font-arabic",
        className
      )}
      dir="rtl"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      {words.map((word, wIdx) => {
        const cleanWord = word.replace(/[،.؟!,؛:«»"]/g, "").trim();
        const wordData = wordTranslations[cleanWord];

        return (
          <Popover key={wIdx}>
            <PopoverTrigger asChild>
              <span
                onClick={() => handleWordTap(word)}
                className={cn(
                  "cursor-pointer rounded px-0.5 transition-colors",
                  wordData
                    ? "text-primary underline underline-offset-4 decoration-primary/30"
                    : "hover:bg-primary/10"
                )}
              >
                {word}
              </span>
            </PopoverTrigger>
            {wordData && (
              <PopoverContent className="w-64 p-3" side="top">
                <div className="space-y-2">
                  <p className="font-bold text-foreground font-arabic text-lg" dir="rtl">
                    {cleanWord}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {wordData.translation || "Tap to enrich…"}
                  </p>

                  {wordData.enriching ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading root & uses…</span>
                    </div>
                  ) : wordData.enrichment?.root ? (
                    <div className="pt-1 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground">Root</p>
                      <p className="font-arabic text-sm text-foreground" dir="rtl">
                        {wordData.enrichment.root}
                      </p>
                    </div>
                  ) : null}

                  {wordData.enrichment?.otherUses && wordData.enrichment.otherUses.length > 0 && (
                    <div className="pt-1 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Other forms</p>
                      <div className="space-y-0.5">
                        {wordData.enrichment.otherUses.map((u, i) => (
                          <p key={i} className="text-xs">
                            <span className="font-arabic" dir="rtl">{u.arabic}</span>
                            <span className="text-muted-foreground"> — {u.english}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {user && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs mt-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveAsFlashcard(cleanWord, wordData.translation, wordData.enrichment?.root);
                      }}
                    >
                      <BookmarkPlus className="h-3 w-3 mr-1" />
                      Save to My Words
                    </Button>
                  )}
                </div>
              </PopoverContent>
            )}
          </Popover>
        );
      })}
    </p>
  );
};
