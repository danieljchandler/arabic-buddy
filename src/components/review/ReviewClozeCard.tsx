import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, Volume2, Play, Loader2, Quote } from "lucide-react";
import { useMaskedSentenceAudio } from "@/hooks/useMaskedSentenceAudio";
import { cn } from "@/lib/utils";
import { findWordSpan, normalizeArabicWord } from "@/lib/arabicWord";
import { buildChoices } from "@/lib/quizDistractors";
import { whyNotQuestion } from "@/lib/quizWhyNot";
import { AskAISentence } from "@/components/shared/AskAISentence";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  sentenceText: string;
  sentenceEnglish?: string | null;
  sentenceAudioUrl?: string | null;
  distractors: string[]; // other Arabic words from due queue
  /**
   * The word's meaning, shown above the gap before answering. The quiz
   * ladder's first look offers it; later steps do not.
   */
  hintEnglish?: string | null;
  /**
   * The dialect the sentence is in, whose voice reads it — muted and whole.
   * Unset, the learner's active dialect; the quiz passes the card's own, since
   * a mixed deck's sentence is not always in the dialect the learner has on.
   */
  dialect?: string | null;
  /**
   * The question alone, asked against a clock (the lightning round): nothing
   * is synthesised or played, and nothing beyond the answer is offered — no
   * translation, no tutor. The round costs nothing and moves on by itself.
   */
  bare?: boolean;
  onAnswered?: (correct: boolean) => void;
}

// Replace the first occurrence of the target word with a blank. Matching is
// normalized (harakat, hamza carriers, ى/ة, attached punctuation), because a
// word saved vocalized — AI enrichment returns بَيْت — never string-matches
// its own bare occurrence in a sentence, and the card silently refused to
// build. The sentence keeps its original spelling; only lookup is folded.
const buildCloze = (sentence: string, word: string) => {
  const span = findWordSpan(sentence, word);
  if (!span) return null;
  return { span, before: sentence.slice(0, span.start), after: sentence.slice(span.end) };
};

export const ReviewClozeCard = ({
  wordArabic,
  wordEnglish,
  sentenceText,
  sentenceEnglish,
  sentenceAudioUrl,
  distractors,
  hintEnglish,
  dialect,
  bare = false,
  onAnswered,
}: Props) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const cloze = useMemo(() => buildCloze(sentenceText, wordArabic), [sentenceText, wordArabic]);

  // The sentence read with the word muted, so the audio doesn't give the
  // answer away: a recording always contains the word, so it is not played
  // until the learner has answered, and then the whole sentence is heard in
  // context (`useMaskedSentenceAudio`, which the story passage shares).
  const { url: audioUrl, isLoading: ttsLoading } = useMaskedSentenceAudio({
    text: sentenceText,
    span: cloze?.span ?? null,
    dialect,
    revealed: selected != null,
    // Bare, nothing plays at all: not even a recording, which costs nothing
    // but would talk over the next question.
    recordingUrl: bare ? null : sentenceAudioUrl,
    skip: bare,
  });

  // Seeded on the card, not rolled per render: an unseeded shuffle re-dealt
  // the options on every re-render — the offline queue's "Saving" badge, an
  // XP toast — so the answer moved under the learner's finger. The pool is
  // also de-duplicated by normalised form, so the answer in another spelling
  // can never be offered as a wrong option.
  const options = useMemo(() => {
    // Only keep Arabic-script options so we never offer English answers when
    // the prompt requires an Arabic word.
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;
    const pool = distractors.filter((d) => d && ARABIC_RE.test(d));
    return buildChoices(wordArabic, pool, `${wordArabic}|${sentenceText}`, 4, normalizeArabicWord);
  }, [distractors, wordArabic, sentenceText]);

  // Reset when card changes
  useEffect(() => {
    setSelected(null);
    setShowTranslation(false);
  }, [wordArabic, sentenceText]);

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
    <div className="rounded-3xl bg-card border border-plum/15 p-7 text-center shadow-elegant">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          Fill in the missing word
        </span>
      </div>

      {hintEnglish && selected == null && (
        <p className="text-sm text-muted-foreground mb-4">
          The missing word means <span className="font-semibold text-foreground">{hintEnglish}</span>
        </p>
      )}

      {/* Sentence with blank */}
      <div
        className="text-3xl leading-loose text-foreground mb-7"
        style={{ fontFamily: "var(--font-naskh)" }}
        dir="rtl"
      >
        <span>{cloze.before}</span>
        <span
          className={cn(
            "inline-block min-w-[5.5rem] mx-1.5 px-3 py-1 rounded-lg border-2 border-dashed align-middle transition-colors",
            selected == null && "border-primary/50 bg-primary/8 text-primary/60",
            selected != null && selected === wordArabic && "border-green-600 bg-green-500/15 text-green-700 border-solid",
            selected != null && selected !== wordArabic && "border-red-600 bg-red-500/15 text-red-700 border-solid"
          )}
        >
          {selected ?? "ـــ"}
        </span>
        <span>{cloze.after}</span>
      </div>

      {/* Circular audio button */}
      {!bare && (
        <div className="flex flex-col items-center justify-center gap-1.5 mb-7">
          <button
            type="button"
            onClick={() => audioUrl && playAudio(audioUrl)}
            disabled={!audioUrl || ttsLoading}
            aria-label={selected == null ? "Play sentence with word muted" : "Play full sentence"}
            className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center",
              "bg-primary text-primary-foreground shadow-elegant",
              "transition-all hover:scale-105 active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {ttsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6 ml-0.5" />}
          </button>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {selected == null ? "Word muted" : "Full sentence"}
          </span>
        </div>
      )}

      {/* Choices */}
      <div className="grid grid-cols-2 gap-2.5 mb-2">
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
                "rounded-xl border-2 border-plum/15 bg-card px-3 min-h-[56px] text-xl transition-all",
                "hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5",
                "disabled:hover:translate-y-0",
                reveal && isTarget && "border-green-600 bg-green-500/12",
                reveal && isPicked && !isTarget && "border-red-600 bg-red-500/12",
                reveal && !isTarget && !isPicked && "opacity-50",
              )}
              style={{ fontFamily: "var(--font-naskh)" }}
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
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-5 text-center">
          <p className="text-base text-foreground">
            <span className="font-semibold">{wordArabic}</span>
            <span className="text-muted-foreground"> — {wordEnglish}</span>
          </p>
          {sentenceEnglish && !bare && (
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
          {!bare && (
            <div className="mt-3 flex justify-center">
              {selected !== wordArabic ? (
                // The pair and the sentence, to the tutor: why this gap takes
                // one word and not the other.
                <AskAISentence
                  arabic={sentenceText}
                  english={sentenceEnglish ?? wordEnglish}
                  variant="chip"
                  label="Why not this one?"
                  ask={whyNotQuestion({
                    format: hintEnglish ? "cloze-hint" : "cloze",
                    picked: selected,
                    answer: wordArabic,
                    meaning: wordEnglish,
                  })}
                />
              ) : (
                <AskAISentence
                  arabic={sentenceText}
                  english={sentenceEnglish ?? wordEnglish}
                  variant="chip"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

