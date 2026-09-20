import { useMemo, useRef, useState } from "react";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { ChevronDown, ChevronUp, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { pairSentences, type ReaderSentence } from "@/lib/sentences";
import { useLineAudio } from "@/hooks/useLineAudio";
import { cn } from "@/lib/utils";

interface SentenceReaderProps {
  /** The whole body, split on punctuation when `sentences` is absent. */
  body: string;
  /** Per-sentence text, when the generator authored it. */
  sentences?: ReaderSentence[];
  vocabulary?: { word_arabic: string; word_english: string }[];
  /** Where a word saved from here came from, e.g. "souq-news", "daily-story". */
  source: string;
  /** Start with every translation showing (the learner's display preference). */
  revealByDefault?: boolean;
  /** Extra classes for the Arabic line — a story reads at a larger size than news. */
  arabicClassName?: string;
  /** Dialect override for the spoken lines; defaults to the active dialect. */
  dialect?: string;
}

/**
 * A body of Arabic read one sentence to a card: every word tappable for a
 * gloss, the English hidden behind a tap so the eye cannot cheat, an Ask AI
 * chip per line, and a speaker on each line so the learner can hear it said.
 *
 * The alternative — the body as one block with a translation under it — is the
 * hardest possible presentation of the hardest thing a learner reads, and it is
 * what this exists to replace. Shared by Souq News and Today's Story so the two
 * behave identically.
 */
export const SentenceReader = ({
  body,
  sentences,
  vocabulary,
  source,
  revealByDefault = false,
  arabicClassName,
  dialect,
}: SentenceReaderProps) => {
  const lines = useMemo<ReaderSentence[]>(() => {
    if (sentences && sentences.length > 0) return sentences;
    return pairSentences({ arabic: body });
  }, [sentences, body]);

  const initial = () =>
    revealByDefault ? new Set(lines.map((_, i) => i)) : new Set<number>();
  const [revealed, setRevealed] = useState<Set<number>>(initial);

  /**
   * Close everything when the body changes.
   *
   * `revealed` is a set of positions with no tie to the content, so swapping
   * `sentences` for another story left the same positions open: a reader who
   * revealed line 2 of one article opened the next with line 2 already
   * translated — which for a sentence-by-sentence exercise is precisely the
   * thing it exists to prevent.
   *
   * Keyed on the Arabic rather than on the array identity, because the parent
   * rebuilds the list on every render.
   */
  const contentKey = `${revealByDefault}|${lines.map((l) => l.arabic).join(" ")}`;
  const lastContent = useRef(contentKey);
  if (lastContent.current !== contentKey) {
    lastContent.current = contentKey;
    setRevealed(initial());
  }

  const toggle = (i: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const spoken = useMemo(() => lines.map((l) => l.arabic), [lines]);
  const { playingIndex, loadingIndex, isPlayingAll, playLine, playAll } =
    useLineAudio({ lines: spoken, dialect });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-muted-foreground">
          Tap any word for translation · Tap a line to reveal English
        </p>
        {lines.length > 0 && (
          <button
            type="button"
            onClick={() => playAll()}
            aria-label={isPlayingAll ? "Stop reading aloud" : "Play every line in order"}
            className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            {isPlayingAll ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {isPlayingAll ? "Stop" : "Play all"}
          </button>
        )}
      </div>
      {lines.map((line, i) => {
        const isOpen = revealed.has(i);
        const english = line.english ?? "";
        const hasTranslation = Boolean(english || line.literal);
        const isSounding = playingIndex === i;
        const isFetching = loadingIndex === i;
        return (
          <div
            key={i}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              isSounding
                ? "border-primary/50 bg-primary/5"
                : "border-border/40 bg-card/40",
            )}
          >
            <TappableArabicText
              text={line.arabic}
              vocabulary={vocabulary || []}
              source={source}
              className={arabicClassName}
              sentenceContext={{
                arabic: line.arabic,
                english,
              }}
            />
            {line.transliteration && (
              <p className="text-xs text-muted-foreground italic mt-1">
                {line.transliteration}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              {hasTranslation ? (
                <button
                  onClick={() => toggle(i)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {isOpen ? "Hide translation" : "Reveal translation"}
                </button>
              ) : <span />}
              {/*
                No whole-body fallback. Both this and the word-gloss context
                above once used `line.english || summaryEnglish`. On the
                authored path that never fires; on the split-sentence path every
                line has an empty English, so each one was sent up paired with
                the body's whole summary — telling the model, and the word
                lookup that produces the gloss a learner then saves, that a
                four-word sentence means a paragraph. An absent translation is
                better described as absent.
              */}
              <div className="flex items-center gap-1 shrink-0">
                <AskAISentence
                  arabic={line.arabic}
                  english={english}
                  variant="chip"
                />
                <button
                  type="button"
                  onClick={() => playLine(i)}
                  disabled={isFetching}
                  aria-label={isSounding ? "Stop this line" : "Play this line"}
                  title={isSounding ? "Stop this line" : "Play this line"}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                    isSounding
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                >
                  {isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isSounding ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div
              className={cn(
                "grid transition-all duration-200",
                isOpen
                  ? "grid-rows-[1fr] opacity-100 mt-2"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <TranslationPair
                  variant="compact"
                  literal={line.literal}
                  natural={english}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
