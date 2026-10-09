import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuizChoiceCard } from "@/components/review/QuizChoiceCard";
import { QuizOptionsCard, type QuizOption } from "@/components/review/QuizOptionsCard";
import { QuizRungBadge } from "@/components/review/QuizRungBadge";
import { QuizSpeakCard, type QuizSpeechResult } from "@/components/review/QuizSpeakCard";
import { ReviewClozeCard } from "@/components/review/ReviewClozeCard";
import { useEnsureWordAsset } from "@/hooks/useEnsureWordAsset";
import type { QuizPoolEntry } from "@/hooks/useQuizPool";
import { recordingSupported } from "@/hooks/useTakeRecorder";
import { useWordAsset } from "@/hooks/useWordAsset";
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
  /**
   * Show the shared store's picture for a card that has none of its own, on
   * the steps that use one. A free read of a public table, and nothing is
   * written: the curriculum deck sets this, since a learner cannot write
   * `vocabulary_words` (the rows are filled by `scripts/curriculum-pictures.ts`).
   */
  sharedPictures?: boolean;
  /**
   * The learner's own words: as `sharedPictures`, and a saved word that
   * reaches "pick the picture" with no picture anywhere has one made (the
   * store's `ensure`, on the learner's daily picture allowance). Called with
   * the url, from the store or newly drawn, for the page to put on the
   * learner's row. It can arrive after the card has been answered.
   */
  onPictureMade?: (url: string) => void | Promise<void>;
}

/**
 * How long a card waits to hear whether the store holds its picture. A read
 * of one row; past this the card is asked without one rather than held.
 */
export const PICTURE_LOOKUP_WAIT_MS = 1500;

/**
 * How long "pick the picture" waits for a picture being drawn for it. A
 * drawing takes around ten seconds. Past this the card is asked its fallback
 * question, and the picture still lands on the learner's row when it comes.
 */
export const PICTURE_DRAWING_WAIT_MS = 12_000;

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
  sharedPictures = false,
  onPictureMade,
}: QuizCardFrameProps) => {
  // A card the device could not record for is served as the flashcard; the
  // ladder is consulted again for the next one.
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const [answered, setAnswered] = useState<{ rating: Rating; correct: boolean } | null>(null);

  useEffect(() => {
    setAnswered(null);
  }, [item.id]);

  const rung = rungForMemory(item.memory, item.direction);

  const replyQuestion = useMemo(() => {
    const lines = asDialogue(item.dialogue);
    if (lines.length === 0) return null;
    return buildReplyQuestion(lines, item.arabic, item.id, item.extraDialogueLines ?? []);
  }, [item.dialogue, item.arabic, item.id, item.extraDialogueLines]);

  const hasSentence = !!item.sentence?.arabic && sentenceHasWord(item.sentence.arabic, item.arabic);

  // ── The card's picture ────────────────────────────────────────────────────
  //
  // Its own, as it was when the card was dealt: a picture that reaches the
  // row while the card is on screen (the one being drawn for it, below) must
  // not turn the question into another one under the learner.
  const [dealt, setDealt] = useState({ id: item.id, own: item.imageUrl ?? null });
  if (dealt.id !== item.id) setDealt({ id: item.id, own: item.imageUrl ?? null });
  const ownPicture = dealt.id === item.id ? dealt.own : (item.imageUrl ?? null);

  // Failing that, the shared store's, on the steps that use a picture: the
  // three that ask for one, and the two that fall back onto one of those
  // (a word with no dialogue is picked from four; one with no sentence is
  // said on its own).
  const usesStore = sharedPictures || !!onPictureMade;
  const usesPicture =
    rung.format === "picture-choice" ||
    rung.format === "word-choice" ||
    rung.format === "speak" ||
    (rung.format === "reply-choice" && !replyQuestion) ||
    (rung.format === "speak-sentence" && !hasSentence);
  const pictureInput = useMemo(
    () => ({ kind: "image", word: item.arabic, gloss: item.english, dialect: item.dialect ?? null }),
    [item.arabic, item.english, item.dialect],
  );
  const wantsShared = usesStore && usesPicture && !ownPicture;
  const stored = useWordAsset(wantsShared ? pictureInput : null);

  // ── The other words ───────────────────────────────────────────────────────
  //
  // As they were when the question was put on screen. The page patches the
  // pool when a picture is saved (so the next card can deal it), and a pool
  // that grew under a question would change which question it is, or deal
  // different wrong answers beside the one already picked.
  const [deal, setDeal] = useState<{ id: string; pool: ReadonlyArray<QuizPoolEntry> } | null>(null);
  const dealtPool = deal?.id === item.id ? deal.pool : pool;

  // The other words, once each by normalised Arabic, never the word itself in
  // another spelling.
  const entries = useMemo(() => {
    const own = normalizeArabicWord(item.arabic);
    const seen = new Set<string>();
    const out: QuizPoolEntry[] = [];
    for (const other of dealtPool) {
      if (!ARABIC_RE.test(other.arabic)) continue;
      const key = normalizeArabicWord(other.arabic);
      if (!key || key === own || seen.has(key)) continue;
      seen.add(key);
      out.push(other);
    }
    return out;
  }, [dealtPool, item.arabic]);

  const arabicPool = useMemo(() => entries.map((e) => e.arabic), [entries]);

  const englishPool = useMemo(() => {
    const own = item.english.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const other of dealtPool) {
      const key = other.english.trim().toLowerCase();
      if (!key || key === own || seen.has(key)) continue;
      seen.add(key);
      out.push(other.english);
    }
    return out;
  }, [dealtPool, item.english]);

  // Pictures of other words, once each. The word's own is taken out where
  // the options are dealt, once it is known which picture that is.
  const otherPictures = useMemo(() => {
    const seen = new Set<string>();
    const out: QuizPoolEntry[] = [];
    for (const entry of entries) {
      if (!entry.imageUrl || seen.has(entry.imageUrl)) continue;
      seen.add(entry.imageUrl);
      out.push(entry);
    }
    return out;
  }, [entries]);

  // And failing that, for a learner's own word at "pick the picture", one is
  // made. Asked once the store has said it has none, and only of a deck the
  // quiz can ask questions of at all: with too few words for four options
  // every card is the flip card, and a picture nobody is about to be asked
  // about is not worth the learner's allowance yet.
  const ensure = useEnsureWordAsset();
  const [drawing, setDrawing] = useState<{ id: string; done: boolean; url: string | null } | null>(null);
  const onPictureMadeRef = useRef(onPictureMade);
  onPictureMadeRef.current = onPictureMade;
  const canChoose = Math.min(arabicPool.length, englishPool.length) >= CHOICE_COUNT - 1;
  const shouldDraw =
    !!onPictureMade &&
    wantsShared &&
    rung.format === "picture-choice" &&
    ready &&
    canChoose &&
    !stored.isLoading &&
    !stored.url;

  // Handed to the page once per card, whichever way the picture was found. A
  // drawn one is found twice: by the ask, and again by the lookup it
  // invalidates, once the store has filed it.
  const handedOverFor = useRef<string | null>(null);
  const handOver = (id: string, url: string, save: QuizCardFrameProps["onPictureMade"]) => {
    if (!save || handedOverFor.current === id) return;
    handedOverFor.current = id;
    // Whatever the page's save does, it is not this card's to report.
    void Promise.resolve()
      .then(() => save(url))
      .catch(() => {});
  };

  useEffect(() => {
    if (!shouldDraw) return;
    const id = item.id;
    // The page's callback as it is now: it closes over this card's word, and
    // the picture may come back after the next card has been dealt.
    const save = onPictureMadeRef.current;
    setDrawing({ id, done: false, url: null });
    void ensure(pictureInput).then((outcome) => {
      const url = outcome.status === "made" ? outcome.url : null;
      if (url) handOver(id, url, save);
      setDrawing((now) => (now?.id === id ? { id, done: true, url } : now));
    });
    // One ask per card dealt; `ensure` shares it across re-serves of the word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldDraw, item.id]);

  // A picture the store already had goes onto the learner's row as well, so
  // their word list shows it and it can be dealt as a wrong picture.
  useEffect(() => {
    if (wantsShared && stored.url) handOver(item.id, stored.url, onPictureMadeRef.current);
  }, [wantsShared, stored.url, item.id]);

  // What the card is waiting to hear before it can be asked: whether the
  // store has its picture (a moment), or the picture being drawn for it — and
  // that only when a picture question could follow, which takes three other
  // words with pictures. Otherwise the drawing goes on behind the fallback
  // question and the picture is there the next time one is wanted.
  const drawingNow = shouldDraw && !(drawing?.id === item.id && drawing.done);
  const waitingFor: "lookup" | "drawing" | null = !wantsShared
    ? null
    : stored.isLoading
      ? "lookup"
      : drawingNow && otherPictures.length >= CHOICE_COUNT - 1
        ? "drawing"
        : null;

  // Settled once per card, and then left alone: a picture that turns up
  // after the question is on screen is for next time.
  const [settled, setSettled] = useState<{ id: string; url: string | null } | null>(null);
  const isSettled = !wantsShared || settled?.id === item.id;
  const arrived = stored.url ?? (drawing?.id === item.id ? drawing.url : null);

  useEffect(() => {
    if (isSettled || !ready) return;
    if (waitingFor === null) {
      setSettled({ id: item.id, url: arrived });
      return;
    }
    const giveUp = setTimeout(
      () => setSettled({ id: item.id, url: null }),
      waitingFor === "lookup" ? PICTURE_LOOKUP_WAIT_MS : PICTURE_DRAWING_WAIT_MS,
    );
    return () => clearTimeout(giveUp);
  }, [isSettled, ready, waitingFor, arrived, item.id]);

  const pictureUrl = ownPicture ?? (settled?.id === item.id ? settled.url : null);

  // The question goes on screen with this render: fix the pool it was dealt
  // from. Until then (the pool still loading, a picture still awaited) the
  // live one is read, so a pool that arrives late is the one that is used.
  if (ready && isSettled && deal?.id !== item.id) setDeal({ id: item.id, pool });

  const imageEntries = useMemo(
    () => otherPictures.filter((entry) => entry.imageUrl !== pictureUrl),
    [otherPictures, pictureUrl],
  );

  const format: QuizFormat =
    unavailableFor === item.id
      ? "flashcard"
      : pickQuizFormat(item.memory, item.direction, {
          hasSentence,
          hasImage: !!pictureUrl,
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

  if (!ready || !isSettled) {
    // Say why only when the wait is long enough to wonder about. The store's
    // answer usually comes within a blink, so its spinner fades in late: a
    // card that is merely being looked up shows an empty frame, not a flash.
    const drawingPicture = ready && waitingFor === "drawing";
    const lookingUp = ready && !drawingPicture;
    return (
      <div
        role="status"
        aria-label={drawingPicture ? "Drawing a picture for this word" : "Preparing the question"}
        className="rounded-2xl bg-card border border-border p-8 flex flex-col items-center justify-center gap-3 min-h-[16rem]"
      >
        <span className={lookingUp ? "animate-in fade-in duration-300 delay-300 fill-mode-backwards" : undefined}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </span>
        {drawingPicture && (
          <p className="text-sm text-muted-foreground text-center">Drawing a picture for this word…</p>
        )}
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
            { key: "answer", imageUrl: pictureUrl, english: item.english },
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
          prompt={{ imageUrl: pictureUrl, english: item.english }}
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
          imageUrl={pictureUrl}
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
