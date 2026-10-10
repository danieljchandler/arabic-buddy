import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, Image as ImageIcon, Loader2, MessageCircle, Volume2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { QuizAnimation } from "@/components/review/QuizAnimation";
import { cn } from "@/lib/utils";
import type { StoredAnimation } from "../../../supabase/functions/_shared/wordAnimation";

/** One option on a picture, word or reply question. */
export interface QuizOption {
  key: string;
  arabic?: string | null;
  english?: string | null;
  transliteration?: string | null;
  imageUrl?: string | null;
  /** An action word's clip, shown in place of its picture on the picture question. */
  animation?: StoredAnimation | null;
  /** Show the clip as its poster: the frame holds a lone clip still, so motion is no tell. */
  still?: boolean;
  audioUrl?: string | null;
  speaker?: string | null;
}

export interface QuizOptionsPrompt {
  arabic?: string | null;
  english?: string | null;
  transliteration?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  speaker?: string | null;
}

interface QuizOptionsCardProps {
  id: string;
  /**
   * `picture-choice`: the word, seen and heard → four pictures.
   * `word-choice`: the picture (or the meaning) → four Arabic words with audio.
   * `reply-choice`: a line someone said → four replies.
   */
  format: "picture-choice" | "word-choice" | "reply-choice";
  prompt: QuizOptionsPrompt;
  /** Already in the order to show; the frame deals them from a seed. */
  options: QuizOption[];
  answerKey: string;
  dialect?: string | null;
  onAnswer: (answer: { correct: boolean; hintUsed: boolean }) => void;
}

const naskh = { fontFamily: "var(--font-naskh)" } as const;

/**
 * The three choice questions above the gap: pick the picture, pick the word,
 * pick the reply.
 *
 * They climb in what the learner has to bring. The picture question goes from
 * the word, seen and heard, to a thing — recognition of the easiest kind. The
 * word question goes the other way, from a picture or a meaning to the Arabic
 * form, with each option playable so the sound is part of what is weighed.
 * The reply question is the first that asks for use rather than meaning: a
 * line of the lesson's own dialogue is said, and the learner picks what to
 * answer with. Translations of a prompt are a tap away and count as help,
 * which the grading turns into Hard rather than Good.
 */
export const QuizOptionsCard = ({ id, format, prompt, options, answerKey, dialect, onAnswer }: QuizOptionsCardProps) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const hintUsedRef = useRef(false);

  useEffect(() => {
    setSelected(null);
    setHintOpen(false);
    hintUsedRef.current = false;
  }, [id]);

  const answered = selected != null;
  const answer = useMemo(() => options.find((o) => o.key === answerKey), [options, answerKey]);
  const correct = selected === answerKey;

  // The prompt's own sound: the word for the picture question, the line for
  // the reply question. Both play themselves once; the word question has no
  // Arabic to play before the answer.
  const promptText = prompt.arabic ?? "";
  const { ttsUrl: promptTts, isLoading: promptLoading } = useAzureTTS({
    text: promptText,
    skip: !promptText || Boolean(prompt.audioUrl) || format === "word-choice",
    dialect,
  });
  const promptAudio = prompt.audioUrl || promptTts;
  const { isPlaying, play } = useAudioPlayer();
  const autoPlayedFor = useRef<string | null>(null);
  useEffect(() => {
    if (format === "word-choice" || !promptAudio) return;
    if (autoPlayedFor.current === id) return;
    autoPlayedFor.current = id;
    play(promptAudio);
  }, [format, promptAudio, id, play]);

  // After the answer, the right option is heard where it has no recording.
  const { ttsUrl: answerTts } = useAzureTTS({
    text: answer?.arabic ?? "",
    skip: !answered || !answer?.arabic || Boolean(answer?.audioUrl) || format === "picture-choice",
    dialect,
  });
  const answerAudio = answer?.audioUrl || answerTts;

  const choose = (key: string) => {
    if (answered) return;
    setSelected(key);
    onAnswer({ correct: key === answerKey, hintUsed: hintUsedRef.current });
  };

  const openHint = () => {
    if (!answered) hintUsedRef.current = true;
    setHintOpen(true);
  };

  const title =
    format === "picture-choice" ? "Which picture?" : format === "word-choice" ? "Which word?" : "What would you say?";
  const TitleIcon = format === "picture-choice" ? ImageIcon : format === "word-choice" ? Volume2 : MessageCircle;

  // What the prompt withholds until asked: the word's meaning behind a
  // picture, the translation of a line that was said.
  const hint =
    format === "word-choice" && prompt.imageUrl
      ? { label: "Show meaning", text: prompt.english ?? null }
      : format === "reply-choice"
        ? { label: "Show translation", text: prompt.english ?? null }
        : null;

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
        <TitleIcon className="h-3.5 w-3.5" />
        {title}
      </div>

      {/* The prompt */}
      {format === "picture-choice" && (
        <div className="flex items-center justify-center gap-3 mb-6">
          <p className="text-4xl font-bold text-foreground break-words" style={naskh} dir="rtl">
            {prompt.arabic}
          </p>
          <button
            type="button"
            onClick={() => promptAudio && play(promptAudio)}
            disabled={!promptAudio}
            aria-label="Play the word"
            className={cn(
              "flex-shrink-0 p-3 rounded-full border transition-all duration-200",
              promptAudio
                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                : "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed",
              isPlaying && "bg-primary text-primary-foreground border-primary",
            )}
          >
            {promptLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      )}

      {format === "word-choice" &&
        (prompt.imageUrl ? (
          <div className="mb-6 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
            <img src={prompt.imageUrl} alt="" className="w-full h-full object-contain" />
          </div>
        ) : (
          <p className="text-3xl font-bold text-foreground mb-6 break-words max-w-full">{prompt.english}</p>
        ))}

      {format === "reply-choice" && (
        <div className="mb-6 rounded-lg bg-muted/40 border border-border p-4 text-right" dir="rtl">
          {prompt.speaker && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1" dir="ltr">
              {prompt.speaker} says
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xl leading-relaxed text-foreground" style={naskh}>
              {prompt.arabic}
            </p>
            <button
              type="button"
              onClick={() => promptAudio && play(promptAudio)}
              disabled={!promptAudio}
              aria-label="Play the line"
              className={cn(
                "flex-shrink-0 p-2.5 rounded-full border transition-all duration-200",
                promptAudio
                  ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                  : "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed",
                isPlaying && "bg-primary text-primary-foreground border-primary",
              )}
            >
              {promptLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          {hintOpen && prompt.english && (
            <p className="text-sm text-muted-foreground italic mt-2" dir="ltr">
              {prompt.english}
            </p>
          )}
        </div>
      )}

      {/* The options */}
      {format === "picture-choice" && (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Choose the picture">
          {options.map((option) => {
            const isPicked = selected === option.key;
            const isAnswer = option.key === answerKey;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isPicked}
                aria-label={option.english ?? "picture"}
                onClick={() => choose(option.key)}
                disabled={answered}
                className={cn(
                  "relative rounded-xl overflow-hidden aspect-square border-2 transition-all duration-200",
                  !answered && "border-border hover:border-primary/40 hover:scale-[1.02] active:scale-[0.98]",
                  answered && isAnswer && "border-success bg-success/10",
                  answered && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                  answered && !isAnswer && !isPicked && "opacity-50 border-border",
                )}
              >
                {option.animation ? (
                  <QuizAnimation animation={option.animation} still={option.still} className="w-full h-full object-cover" />
                ) : option.imageUrl ? (
                  <img src={option.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
                {answered && isAnswer && (
                  <CheckCircle2 className="absolute top-1.5 right-1.5 h-5 w-5 text-success drop-shadow" />
                )}
                {answered && isPicked && !isAnswer && (
                  <XCircle className="absolute top-1.5 right-1.5 h-5 w-5 text-destructive drop-shadow" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {format === "word-choice" && (
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Choose the word">
          {options.map((option) => {
            const isPicked = selected === option.key;
            const isAnswer = option.key === answerKey;
            return (
              <div
                key={option.key}
                role="radio"
                aria-checked={isPicked}
                aria-disabled={answered}
                tabIndex={answered ? -1 : 0}
                onClick={() => choose(option.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose(option.key);
                  }
                }}
                className={cn(
                  "rounded-xl border-2 border-border bg-card px-3 min-h-[56px] text-xl transition-all",
                  "flex items-center justify-between gap-2",
                  !answered && "cursor-pointer hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5",
                  answered && isAnswer && "border-success bg-success/10",
                  answered && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                  answered && !isAnswer && !isPicked && "opacity-50",
                )}
              >
                <span className="min-w-0 truncate text-foreground" style={naskh} dir="rtl">
                  {option.arabic}
                </span>
                {option.audioUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      play(option.audioUrl!);
                    }}
                    aria-label={`Play ${option.arabic}`}
                    className="p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 shrink-0"
                  >
                    <Volume2 className="h-4 w-4 text-primary" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {format === "reply-choice" && (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Choose the reply">
          {options.map((option) => {
            const isPicked = selected === option.key;
            const isAnswer = option.key === answerKey;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isPicked}
                onClick={() => choose(option.key)}
                disabled={answered}
                className={cn(
                  "rounded-xl border-2 border-border bg-card px-4 py-3 text-lg leading-relaxed text-right transition-all",
                  !answered && "hover:border-primary/40 hover:bg-primary/5",
                  answered && isAnswer && "border-success bg-success/10",
                  answered && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                  answered && !isAnswer && !isPicked && "opacity-50",
                )}
                style={naskh}
                dir="rtl"
              >
                {option.arabic}
              </button>
            );
          })}
        </div>
      )}

      {/* Feedback and the reveal */}
      {answered && (
        <div
          role="status"
          className={cn(
            "mt-4 p-3 rounded-xl text-center text-sm font-semibold animate-in fade-in zoom-in-95 duration-300",
            correct ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {correct
            ? "Correct! أحسنت"
            : format === "picture-choice"
              ? `${prompt.arabic} is "${answer?.english ?? ""}"`
              : format === "word-choice"
                ? `It's ${answer?.arabic ?? ""}`
                : "That isn't what fits here"}
        </div>
      )}

      {answered && answer && format !== "picture-choice" && (
        <div className="mt-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-center gap-2">
            <p className="text-2xl font-bold text-foreground" style={naskh} dir="rtl">
              {answer.arabic}
            </p>
            <button
              type="button"
              onClick={() => answerAudio && play(answerAudio)}
              disabled={!answerAudio}
              aria-label="Play the answer"
              className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
          {answer.transliteration && <p className="text-sm text-muted-foreground italic">{answer.transliteration}</p>}
          {answer.english && <p className="text-base text-muted-foreground mt-1">{answer.english}</p>}
        </div>
      )}

      {hint?.text && !hintOpen && !answered && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={openHint} className="gap-1.5 text-muted-foreground">
            <Eye className="h-4 w-4" />
            {hint.label}
          </Button>
        </div>
      )}
      {format === "word-choice" && hintOpen && !answered && hint?.text && (
        <p className="mt-4 text-base text-foreground animate-in fade-in duration-200">{hint.text}</p>
      )}

      {answered && answer?.arabic && (
        <div className="mt-3 flex justify-center">
          <AskAISentence arabic={answer.arabic} english={answer.english ?? prompt.english ?? ""} variant="chip" />
        </div>
      )}
    </div>
  );
};
