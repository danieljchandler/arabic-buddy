import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Headphones, Loader2, Quote, Volume2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { buildChoices } from "@/lib/quizDistractors";
import { whyNotQuestion } from "@/lib/quizWhyNot";
import { cn } from "@/lib/utils";

export interface QuizChoiceAnswer {
  correct: boolean;
  /** The learner opened the sentence before answering. */
  hintUsed: boolean;
}

interface QuizChoiceCardProps {
  /** `meaning` shows the Arabic with its audio; `listen` plays the audio alone. */
  format: "meaning" | "listen";
  /** Seeds the option order, so a re-render never reshuffles under a finger. */
  id: string;
  arabic: string;
  /** The answer. */
  english: string;
  transliteration?: string | null;
  audioUrl?: string | null;
  dialect?: string | null;
  /** English meanings of other cards, for the wrong options. */
  pool: string[];
  /**
   * The Arabic word a wrong option's meaning belongs to, where the deck says
   * which: named in "Why not this one?", since what the learner took the word
   * for is the confusion to explain.
   */
  wordForMeaning?: (english: string) => string | null;
  /** The sentence the word was learnt in, offered as a hint. */
  context?: { arabic: string; english?: string | null } | null;
  onAnswer: (answer: QuizChoiceAnswer) => void;
}

/**
 * A choice question about a word's meaning.
 *
 * Two steps of the ladder share this card. On a first look with no sentence
 * to cut a gap from, the word is shown and heard and the learner picks its
 * meaning. Once the word is settled it is only heard — recognising سوق on a
 * page says nothing about catching it at speed, so the audio-only question is
 * the one that matters for a spoken dialect, and it is the harder of the two.
 *
 * The sentence the word came from is always a tap away, because that is the
 * learner's own context for it; opening it before answering marks the answer
 * as helped, which the grading turns into Hard rather than Good.
 */
export const QuizChoiceCard = ({
  format,
  id,
  arabic,
  english,
  transliteration,
  audioUrl,
  dialect,
  pool,
  wordForMeaning,
  context,
  onAnswer,
}: QuizChoiceCardProps) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const hintUsedRef = useRef(false);

  const { ttsUrl, isLoading } = useAzureTTS({ text: arabic, skip: Boolean(audioUrl), dialect });
  const { isPlaying, play } = useAudioPlayer();
  const playableUrl = audioUrl || ttsUrl;

  const options = useMemo(() => buildChoices(english, pool, id), [english, pool, id]);

  useEffect(() => {
    setSelected(null);
    setHintOpen(false);
    hintUsedRef.current = false;
  }, [id]);

  // The audio-only question is unanswerable in silence, so it plays itself
  // once as soon as it exists; the shown-word question waits for a tap.
  const autoPlayedFor = useRef<string | null>(null);
  useEffect(() => {
    if (format !== "listen" || !playableUrl) return;
    if (autoPlayedFor.current === id) return;
    autoPlayedFor.current = id;
    play(playableUrl);
  }, [format, playableUrl, id, play]);

  const answered = selected != null;
  const correct = selected === english;

  const choose = (option: string) => {
    if (answered) return;
    setSelected(option);
    onAnswer({ correct: option === english, hintUsed: hintUsedRef.current });
  };

  const openHint = () => {
    if (!answered) hintUsedRef.current = true;
    setHintOpen(true);
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
        {format === "listen" ? (
          <>
            <Headphones className="h-3.5 w-3.5" />
            What did you hear?
          </>
        ) : (
          <>
            <BookOpen className="h-3.5 w-3.5" />
            What does it mean?
          </>
        )}
      </div>

      {format === "listen" && !answered ? (
        <button
          type="button"
          onClick={() => playableUrl && play(playableUrl)}
          disabled={!playableUrl}
          aria-label="Play the word again"
          className={cn(
            "mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all duration-200",
            playableUrl
              ? "border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-[0.98]"
              : "border-border bg-muted cursor-not-allowed",
            isPlaying && "border-primary bg-primary/10",
          )}
        >
          {isLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Volume2 className={cn("h-8 w-8", playableUrl ? "text-primary" : "text-muted-foreground")} />
          )}
        </button>
      ) : (
        <div className="flex items-center justify-center gap-3 mb-6">
          <p
            className="text-4xl font-bold text-foreground break-words"
            style={{ fontFamily: "var(--font-naskh)" }}
            dir="rtl"
          >
            {arabic}
          </p>
          <button
            type="button"
            onClick={() => playableUrl && play(playableUrl)}
            disabled={!playableUrl}
            aria-label="Play the word"
            className={cn(
              "flex-shrink-0 p-3 rounded-full border transition-all duration-200",
              playableUrl
                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                : "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed",
              isPlaying && "bg-primary text-primary-foreground border-primary",
            )}
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      )}

      {answered && transliteration && (
        <p className="text-sm text-muted-foreground italic -mt-3 mb-5">{transliteration}</p>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2" role="radiogroup" aria-label="Choose the meaning">
        {options.map((option) => {
          const isPicked = selected === option;
          const isAnswer = option === english;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isPicked}
              onClick={() => choose(option)}
              disabled={answered}
              className={cn(
                "rounded-xl border-2 border-border bg-card px-3 min-h-[56px] text-sm font-medium transition-all",
                "flex items-center justify-center gap-2",
                !answered && "hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5",
                answered && isAnswer && "border-success bg-success/10",
                answered && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                answered && !isAnswer && !isPicked && "opacity-50",
              )}
            >
              {answered && isAnswer && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
              {answered && isPicked && !isAnswer && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
              <span className="text-foreground">{option}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div
          role="status"
          className={cn(
            "mt-4 p-3 rounded-xl text-center text-sm font-semibold animate-in fade-in zoom-in-95 duration-300",
            correct ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {correct ? "Correct! أحسنت" : `${arabic} means "${english}"`}
        </div>
      )}

      {context?.arabic && (
        <div className="mt-4">
          {hintOpen ? (
            <div className="rounded-lg bg-muted/40 border border-border p-3 animate-in fade-in duration-200">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Where you met it
              </p>
              <p className="text-lg leading-relaxed" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
                {context.arabic}
              </p>
              {answered && context.english && (
                <p className="text-sm text-muted-foreground italic mt-1">{context.english}</p>
              )}
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={openHint} className="gap-1.5 text-muted-foreground">
              <Quote className="h-4 w-4" />
              Show the sentence
            </Button>
          )}
        </div>
      )}

      {answered && (
        <div className="mt-3 flex justify-center">
          {correct ? (
            <AskAISentence arabic={arabic} english={english} variant="chip" />
          ) : (
            // The word and the meaning picked for it, to the tutor.
            <AskAISentence
              arabic={arabic}
              english={english}
              variant="chip"
              label="Why not this one?"
              ask={whyNotQuestion({
                format,
                word: arabic,
                picked: selected,
                pickedWord: wordForMeaning?.(selected) ?? null,
                meaning: english,
              })}
            />
          )}
        </div>
      )}
    </div>
  );
};
