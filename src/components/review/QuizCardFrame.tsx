import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuizChoiceCard } from "@/components/review/QuizChoiceCard";
import { QuizOptionsCard, type QuizOption } from "@/components/review/QuizOptionsCard";
import { QuizRungBadge } from "@/components/review/QuizRungBadge";
import { QuizSpeakCard, type QuizSpeechResult } from "@/components/review/QuizSpeakCard";
import { ReviewClozeCard } from "@/components/review/ReviewClozeCard";
import type { QuizPoolEntry } from "@/hooks/useQuizPool";
import { recordingSupported } from "@/hooks/useTakeRecorder";
import { normalizeArabicWord, sentenceHasWord } from "@/lib/arabicWord";
import { asDialogue, buildReplyQuestion, type DialogueLine } from "@/lib/quizDialogue";
import { seededShuffle } from "@/lib/quizDistractors";
import { gradeQuizAnswer, isCorrectRating } from "@/lib/quizGrading";
import {
  CHOICE_COUNT,
  pickQuizFormat,
  rungForMemory,
  type QuizDirection,
  type QuizFormat,
  type QuizMemory,
} from "@/lib/quizLadder";
import type { Rating } from "@/lib/spacedRepetition";

/** One due card, in the shape every deck can produce. */
export interface QuizItem {
  id: string;
  arabic: string;
  english: string;
  transliteration?: string | null;
  audioUrl?: string | null;
  imageUrl?: string | null;
  /** The sentence the word was learnt in, when the deck has one. */
  sentence?: { arabic: string; english?: string | null; audioUrl?: string | null } | null;
  /** The lesson's authored dialogue (`lessons.dialogue`), when the deck has one. */
  dialogue?: unknown;
  /** Lines from other lessons' dialogues, to top up a short one's wrong replies. */
  extraDialogueLines?: DialogueLine[];
  dialect?: string | null;
  /** The schedule the deck served the card on. */
  direction: QuizDirection;
  memory: QuizMemory;
}

export interface QuizGraded {
  rating: Rating;
  correct: boolean;
  format: QuizFormat;
  /** The step the card was asked on. */
  step: number;
}

interface QuizCardFrameProps {
  item: QuizItem;
  /** The other cards in the deck, for wrong options. */
  pool: ReadonlyArray<QuizPoolEntry>;
  /**
   * False while the pool is still loading. The ladder would otherwise read a
   * thin pool as "no question for this card" and flash the flip card for the
   * instant before the real pool arrives.
   */
  ready?: boolean;
  /** Called once, when the learner moves on from an answered card. */
  onGraded: (graded: QuizGraded) => void;
  /** The ordinary flip-and-rate card, for when the ladder has no question. */
  renderFlashcard: () => ReactNode;
  combo?: number;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻾]/;

/**
 * Asks a due card the question its memory state puts it on, and turns the
 * answer into a rating.
 *
 * The frame is the only place the ladder, the cards and the grading meet:
 * the review pages hand it a card and get a rating back, exactly as they get
 * one from the rating buttons, so everything downstream — the offline queue,
 * relearn, leeches, production unlock, the review log — is untouched by the
 * style. Moving on is a deliberate tap: a right answer plays the full sentence
 * or the target's audio, and advancing on a timer would cut it off.
 *
 * The pages mount one frame per presentation (`key` on the card id and the
 * session count). A failed card on a short deck is re-served at once under
 * the same id, and a frame that lived on would show it already answered,
 * Continue still armed with the old rating.
 */
export const QuizCardFrame = ({
  item,
  pool,
  ready = true,
  onGraded,
  renderFlashcard,
  combo = 0,
}: QuizCardFrameProps) => {
  // A card the device could not record for is served as the flashcard; the
  // ladder is consulted again for the next one.
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const [answered, setAnswered] = useState<{ rating: Rating; correct: boolean } | null>(null);

  useEffect(() => {
    setAnswered(null);
  }, [item.id]);

  // The other words, once each by normalised Arabic, never the word itself in
  // another spelling.
  const entries = useMemo(() => {
    const own = normalizeArabicWord(item.arabic);
    const seen = new Set<string>();
    const out: QuizPoolEntry[] = [];
    for (const other of pool) {
      if (!ARABIC_RE.test(other.arabic)) continue;
      const key = normalizeArabicWord(other.arabic);
      if (!key || key === own || seen.has(key)) continue;
      seen.add(key);
      out.push(other);
    }
    return out;
  }, [pool, item.arabic]);

  const arabicPool = useMemo(() => entries.map((e) => e.arabic), [entries]);

  const englishPool = useMemo(() => {
    const own = item.english.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const other of pool) {
      const key = other.english.trim().toLowerCase();
      if (!key || key === own || seen.has(key)) continue;
      seen.add(key);
      out.push(other.english);
    }
    return out;
  }, [pool, item.english]);

  // Pictures of other words, once each, and never the word's own picture.
  const imageEntries = useMemo(() => {
    const seen = new Set<string>(item.imageUrl ? [item.imageUrl] : []);
    const out: QuizPoolEntry[] = [];
    for (const entry of entries) {
      if (!entry.imageUrl || seen.has(entry.imageUrl)) continue;
      seen.add(entry.imageUrl);
      out.push(entry);
    }
    return out;
  }, [entries, item.imageUrl]);

  const replyQuestion = useMemo(() => {
    const lines = asDialogue(item.dialogue);
    if (lines.length === 0) return null;
    return buildReplyQuestion(lines, item.arabic, item.id, item.extraDialogueLines ?? []);
  }, [item.dialogue, item.arabic, item.id, item.extraDialogueLines]);

  const hasSentence = !!item.sentence?.arabic && sentenceHasWord(item.sentence.arabic, item.arabic);
  const rung = rungForMemory(item.memory, item.direction);
  const format: QuizFormat =
    unavailableFor === item.id
      ? "flashcard"
      : pickQuizFormat(item.memory, item.direction, {
          hasSentence,
          hasImage: !!item.imageUrl,
          distractors: Math.min(arabicPool.length, englishPool.length),
          imageDistractors: imageEntries.length,
          hasReply: !!replyQuestion,
          canSpeak: recordingSupported(),
        });

  const settle = (rating: Rating) => setAnswered({ rating, correct: isCorrectRating(rating) });

  const onChoice = (correct: boolean, hintUsed = false) =>
    settle(gradeQuizAnswer({ kind: "choice", correct, hintUsed }));

  const onSpeech = (result: QuizSpeechResult) =>
    settle(
      gradeQuizAnswer({
        kind: "speech",
        score: result.score,
        similarity: result.similarity,
        hintUsed: result.hintUsed,
      }),
    );

  const advance = () => {
    if (!answered) return;
    onGraded({ ...answered, format, step: rung.step });
  };

  // Enter or Space moves on once a card is answered, matching the flip card's
  // keyboard flow; the rating keys do nothing here because the app rated.
  useEffect(() => {
    if (!answered) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- advance closes over answered/format/rung
  }, [answered]);

  if (!ready) {
    return (
      <div
        role="status"
        aria-label="Preparing the question"
        className="rounded-2xl bg-card border border-border p-8 flex items-center justify-center min-h-[16rem]"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (format === "flashcard") return <>{renderFlashcard()}</>;

  const context = item.sentence?.arabic
    ? { arabic: item.sentence.arabic, english: item.sentence.english ?? null }
    : null;

  /** The answer plus wrong options from `from`, dealt once for this card. */
  const dealOptions = (from: QuizPoolEntry[], answer: QuizOption, toOption: (e: QuizPoolEntry, i: number) => QuizOption) => {
    const picks = seededShuffle(from, `${item.id}:${format}:picks`).slice(0, CHOICE_COUNT - 1).map(toOption);
    return seededShuffle([answer, ...picks], `${item.id}:${format}:order`);
  };

  let card: ReactNode;
  switch (format) {
    case "cloze-hint":
    case "cloze":
      card = (
        <ReviewClozeCard
          wordArabic={item.arabic}
          wordEnglish={item.english}
          sentenceText={item.sentence!.arabic}
          sentenceEnglish={item.sentence!.english ?? null}
          sentenceAudioUrl={item.sentence!.audioUrl ?? null}
          distractors={arabicPool}
          hintEnglish={format === "cloze-hint" ? item.english : null}
          onAnswered={(correct) => onChoice(correct)}
        />
      );
      break;
    case "meaning":
    case "listen":
      card = (
        <QuizChoiceCard
          format={format}
          id={item.id}
          arabic={item.arabic}
          english={item.english}
          transliteration={item.transliteration}
          audioUrl={item.audioUrl}
          dialect={item.dialect}
          pool={englishPool}
          context={context}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    case "picture-choice":
      card = (
        <QuizOptionsCard
          id={item.id}
          format="picture-choice"
          prompt={{ arabic: item.arabic, audioUrl: item.audioUrl }}
          options={dealOptions(
            imageEntries,
            { key: "answer", imageUrl: item.imageUrl, english: item.english },
            (e, i) => ({ key: `wrong-${i}`, imageUrl: e.imageUrl, english: e.english }),
          )}
          answerKey="answer"
          dialect={item.dialect}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    case "word-choice":
      card = (
        <QuizOptionsCard
          id={item.id}
          format="word-choice"
          prompt={{ imageUrl: item.imageUrl, english: item.english }}
          options={dealOptions(
            entries,
            {
              key: "answer",
              arabic: item.arabic,
              english: item.english,
              transliteration: item.transliteration,
              audioUrl: item.audioUrl,
            },
            (e, i) => ({ key: `wrong-${i}`, arabic: e.arabic, english: e.english, audioUrl: e.audioUrl }),
          )}
          answerKey="answer"
          dialect={item.dialect}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    case "reply-choice": {
      const q = replyQuestion!;
      card = (
        <QuizOptionsCard
          id={item.id}
          format="reply-choice"
          prompt={{
            arabic: q.prompt.arabic,
            english: q.prompt.english ?? null,
            speaker: q.prompt.speaker ?? null,
          }}
          options={q.options.map((line, i) => ({
            key: line.arabic === q.answer.arabic ? "answer" : `wrong-${i}`,
            arabic: line.arabic,
            english: line.english ?? null,
            transliteration: line.transliteration ?? null,
            speaker: line.speaker ?? null,
          }))}
          answerKey="answer"
          dialect={item.dialect}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    }
    case "speak":
    case "speak-sentence":
      card = (
        <QuizSpeakCard
          format={format}
          id={item.id}
          arabic={item.arabic}
          english={item.english}
          transliteration={item.transliteration}
          imageUrl={item.imageUrl}
          dialect={item.dialect}
          sentence={context}
          onResult={onSpeech}
          onUnavailable={() => setUnavailableFor(item.id)}
        />
      );
      break;
  }

  return (
    <div>
      <QuizRungBadge step={rung.step} label={rung.label} combo={combo} className="mb-4" />
      {card}
      {answered && (
        <div className="mt-6 flex justify-center animate-in fade-in duration-200">
          <Button onClick={advance} className="gap-2 px-6">
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
