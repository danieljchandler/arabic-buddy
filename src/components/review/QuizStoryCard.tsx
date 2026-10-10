import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Languages, Loader2, Mic, MicOff, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { QuizTakeResult } from "@/components/review/QuizTakeResult";
import type { QuizSpeechResult } from "@/components/review/QuizSpeakCard";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useAzurePronunciation } from "@/hooks/useAzurePronunciation";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useMaskedSentenceAudio } from "@/hooks/useMaskedSentenceAudio";
import { useTakeRecorder } from "@/hooks/useTakeRecorder";
import { normalizeArabicWord } from "@/lib/arabicWord";
import { assessmentLocale, wordSpanSimilarity } from "@/lib/quizGrading";
import { buildChoices } from "@/lib/quizDistractors";
import { whyNotQuestion, type StoryGap } from "@/lib/quizStory";
import { cn } from "@/lib/utils";

export interface QuizStoryChoice {
  correct: boolean;
  /** The learner opened the passage's translation before answering. */
  hintUsed: boolean;
}

interface QuizStoryCardProps {
  /**
   * `story-gap` asks the learner to say the missing word, and scores it;
   * `story-choice` offers it among four, for a device that cannot record.
   */
  format: "story-gap" | "story-choice";
  id: string;
  /** The word: the answer. */
  arabic: string;
  /** Its meaning, named beside the gap when it is to be said. */
  english: string;
  transliteration?: string | null;
  /** The passage's dialect: its voice reads the passage, and the take is heard in it. */
  dialect?: string | null;
  story: StoryGap;
  /** Other Arabic words, for the wrong options of the choice. */
  distractors: string[];
  /** `story-gap`: every scored take; the last one is what the card is graded on. */
  onResult: (result: QuizSpeechResult) => void;
  /** `story-choice`: the pick. */
  onChoice: (answer: QuizStoryChoice) => void;
  /** The device cannot record after all, or the learner would rather rate it themselves. */
  onUnavailable: () => void;
}

const WORD_TAKE_MS = 5000;
const PHRASE_TAKE_MS = 8000;

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻾]/;

/**
 * The quiz's top step, "in a story" (quiz Phase 6): the word back in someone
 * else's sentences, heard at speed.
 *
 * Two sentences of a story — a published one's where the reading library has
 * the word, else two written for it — are shown and read aloud with the word
 * muted (`useMaskedSentenceAudio`, the cloze card's reading: the word is not
 * in what the voice is given). The learner says the missing word; the take is
 * scored against the word itself, in the passage's dialect, and graded by the
 * ordinary bands (`wordSpanSimilarity` reads what was heard, so the word said
 * with و, ب or ال attached is the word, and a word of three letters or fewer
 * must be heard exactly). The word's meaning is named beside the gap — a gap
 * in running speech fits more than one word, and a right word that is not
 * this one would be scored as a different word — and the passage's
 * translation is a tap away, which counts as help.
 *
 * On a device that cannot record, the same gap with four options. A wrong
 * pick offers "Why not this one?", which puts the pair and the passage to the
 * tutor.
 */
export const QuizStoryCard = ({
  format,
  id,
  arabic,
  english,
  transliteration,
  dialect,
  story,
  distractors,
  onResult,
  onChoice,
  onUnavailable,
}: QuizStoryCardProps) => {
  const speaking = format === "story-gap";
  const [picked, setPicked] = useState<string | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false);
  const hintUsedRef = useRef(false);
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();
  const { play, stop } = useAudioPlayer();

  const recorder = useTakeRecorder({
    maxDurationMs: arabic.trim().split(/\s+/).length > 1 ? PHRASE_TAKE_MS : WORD_TAKE_MS,
    onTake: async (blob) => {
      const scored = await assess(blob, arabic, assessmentLocale(dialect));
      if (!scored) return;
      const recognized = scored.recognizedText?.trim() || null;
      onResult({
        kind: "speech",
        score: scored.overall,
        // The word's span of what was heard, so a learner who says a word of
        // the sentence with it is still heard saying it.
        similarity: recognized ? wordSpanSimilarity(recognized, arabic) : null,
        recognized,
        hintUsed: hintUsedRef.current,
      });
    },
  });

  const answered = speaking ? !!result : picked !== null;
  const passage = useMaskedSentenceAudio({ text: story.text, span: story.span, dialect, revealed: answered });
  const word = useAzureTTS({ text: arabic, skip: !speaking || !result, dialect });

  useEffect(() => {
    reset();
    setPicked(null);
    setTranslationOpen(false);
    hintUsedRef.current = false;
  }, [id, reset]);

  // The passage plays itself once, muted, as soon as it exists: the gap is a
  // listening question first.
  const playedFor = useRef<string | null>(null);
  useEffect(() => {
    if (answered || !passage.url || playedFor.current === id) return;
    playedFor.current = id;
    play(passage.url);
  }, [answered, passage.url, id, play]);

  const options = useMemo(() => {
    const pool = distractors.filter((d) => d && ARABIC_RE.test(d));
    return buildChoices(arabic, pool, `${id}:story`, 4, normalizeArabicWord);
  }, [distractors, arabic, id]);

  const openTranslation = () => {
    if (!answered) hintUsedRef.current = true;
    setTranslationOpen(true);
  };

  const choose = (option: string) => {
    if (picked !== null) return;
    setPicked(option);
    onChoice({ correct: option === arabic, hintUsed: hintUsedRef.current });
  };

  const startTake = async () => {
    // The passage stops, so the microphone hears the learner and not the voice.
    stop();
    const ok = await recorder.start();
    if (!ok && !recorder.supported) onUnavailable();
  };

  const wrongPick = picked !== null && picked !== arabic;
  const gapText = !answered ? "ـــ" : speaking ? arabic : picked;

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        <BookOpen className="h-3.5 w-3.5" />
        {speaking ? "Say the missing word" : "Fill in the missing word"}
      </div>
      {story.title && <p className="text-xs text-muted-foreground mb-4">From the story “{story.title}”</p>}

      <div
        className="text-2xl leading-loose text-foreground mb-5 space-y-1 text-right"
        style={{ fontFamily: "var(--font-naskh)" }}
        dir="rtl"
        data-testid="story-passage"
      >
        {story.sentences.map((sentence, i) =>
          i === story.gap ? (
            <p key={i}>
              <span>{story.before}</span>
              <span
                data-testid="story-gap"
                className={cn(
                  "inline-block min-w-[4.5rem] mx-1 px-2.5 py-0.5 rounded-lg border-2 border-dashed align-middle text-center",
                  !answered && "border-primary/50 bg-primary/8 text-primary/60",
                  answered && !wrongPick && "border-solid border-success bg-success/10 text-success",
                  wrongPick && "border-solid border-destructive bg-destructive/10 text-destructive",
                )}
              >
                {gapText}
              </span>
              <span>{story.after}</span>
            </p>
          ) : (
            <p key={i}>{sentence.arabic}</p>
          ),
        )}
      </div>

      <div className="flex flex-col items-center justify-center gap-1.5 mb-5">
        <button
          type="button"
          onClick={() => passage.url && play(passage.url)}
          disabled={!passage.url || passage.isLoading}
          aria-label={answered ? "Play the whole passage" : "Play the passage with the word muted"}
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center",
            "bg-primary text-primary-foreground shadow-elegant transition-all hover:scale-105 active:scale-[0.98]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {passage.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {answered ? "Whole passage" : "Word muted"}
        </span>
      </div>

      {speaking && !result && (
        <p className="text-sm text-muted-foreground mb-4">
          The missing word means <span className="font-semibold text-foreground">{english}</span>
        </p>
      )}

      {translationOpen || answered ? (
        <p className="text-sm text-muted-foreground italic mb-4">{story.english}</p>
      ) : (
        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={openTranslation} className="gap-1.5 text-muted-foreground">
            <Languages className="h-4 w-4" />
            Show translation
          </Button>
        </div>
      )}

      {speaking ? (
        <>
          {!result && !isLoading && (
            <div className="flex flex-col items-center gap-2 mb-4">
              <Button
                size="lg"
                variant={recorder.isRecording ? "destructive" : "default"}
                onClick={recorder.isRecording ? recorder.stop : startTake}
                className="gap-2 rounded-full px-6"
              >
                {recorder.isRecording ? (
                  <>
                    <MicOff className="h-5 w-5" />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" />
                    Say it
                  </>
                )}
              </Button>
              {recorder.isRecording && <p className="text-xs text-muted-foreground animate-pulse">Listening…</p>}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking your take…
            </div>
          )}

          {(error || recorder.error) && !isLoading && (
            <div className="text-sm text-destructive text-center mb-4" role="alert">
              {error ?? recorder.error}
              <div className="mt-2 flex justify-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    reset();
                    void startTake();
                  }}
                  className="gap-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={onUnavailable}>
                  Rate it myself instead
                </Button>
              </div>
            </div>
          )}

          {result && (
            <QuizTakeResult
              result={result}
              target={arabic}
              transliteration={transliteration}
              targetAudio={{ url: word.ttsUrl, loading: word.isLoading, play }}
              onRetry={() => {
                reset();
                void startTake();
              }}
              ask={{ arabic: story.text, english: story.english }}
            />
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-2" role="radiogroup" aria-label="Choose the missing word">
            {options.map((option) => {
              const isPicked = picked === option;
              const isAnswer = option === arabic;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  onClick={() => choose(option)}
                  disabled={picked !== null}
                  className={cn(
                    "rounded-xl border-2 border-border bg-card px-3 min-h-[56px] text-xl transition-all",
                    picked === null && "hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5",
                    picked !== null && isAnswer && "border-success bg-success/10",
                    isPicked && !isAnswer && "border-destructive bg-destructive/10",
                    picked !== null && !isAnswer && !isPicked && "opacity-50",
                  )}
                  style={{ fontFamily: "var(--font-naskh)" }}
                  dir="rtl"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {option}
                    {picked !== null && isAnswer && <Check className="h-4 w-4 text-success" />}
                    {isPicked && !isAnswer && <X className="h-4 w-4 text-destructive" />}
                  </span>
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-4">
              <p className="text-base text-foreground">
                <span className="font-semibold" style={{ fontFamily: "var(--font-naskh)" }} dir="rtl">
                  {arabic}
                </span>
                <span className="text-muted-foreground"> — {english}</span>
              </p>
              <div className="mt-3 flex justify-center gap-2 flex-wrap">
                {wrongPick ? (
                  // The pair and the passage, to the tutor: why this gap takes
                  // one word and not the other.
                  <AskAISentence
                    arabic={story.text}
                    english={story.english}
                    variant="chip"
                    label="Why not this one?"
                    ask={whyNotQuestion({ picked: picked!, answer: arabic, meaning: english })}
                  />
                ) : (
                  <AskAISentence arabic={story.text} english={story.english} variant="chip" />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
