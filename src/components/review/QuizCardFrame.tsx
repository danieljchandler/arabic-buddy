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
import {
  asDialogue,
  buildReplyQuestion,
  countWrongReplies,
  dialogueForWord,
  findReplyLine,
  type DialogueLine,
} from "@/lib/quizDialogue";
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
import type { AssetKeyInput } from "../../../supabase/functions/_shared/wordAssets";
import { normalizeDialect } from "../../../supabase/functions/_shared/ttsVoiceRoutingCore";
import { asStoredDialogue, type StoredDialogue } from "../../../supabase/functions/_shared/wordDialogue";

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
  /**
   * The reply steps (6 "answer the line", 9 "say the reply") for a word its
   * lesson has no line for: look the word's exchange up in the shared store,
   * and have one written on a miss (the store's `ensure`, on the learner's
   * daily dialogue allowance). Nothing is written to any row — an exchange
   * lives in the store alone — so a deck that cannot write its rows (the
   * curriculum) may ask for one as well as a learner's own words.
   */
  storedDialogues?: boolean;
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

/** How long a card waits to hear whether the store holds its exchange: a read of one row. */
export const DIALOGUE_LOOKUP_WAIT_MS = 1500;

/**
 * How long a reply step waits for an exchange being written for it. Written,
 * critiqued and checked by a native-speaker validator, it takes ten seconds
 * or so. Past this the card is asked its fallback (pick the word, say the
 * line), and the exchange is filed for the next time the word is asked.
 */
export const DIALOGUE_WRITING_WAIT_MS = 12_000;

type Waiting = "lookup" | "making" | null;

interface CardAssetOptions<T> {
  /** The card. Everything is settled once per card. */
  id: string;
  /** What to look up for this card, or null when it wants nothing from the store. */
  input: AssetKeyInput | null;
  /** The pool has loaded, so the card can be asked. */
  ready: boolean;
  /** Whether a miss is made for this card (`ensure`), once the store has said it has none. */
  make: boolean;
  /** Whether the card waits for what is being made: only when a question could follow. */
  waitForMaking: boolean;
  /** What the card uses of a filed asset or one just made; null when it is nothing usable. */
  read: (asset: { url: string | null; payload: unknown }) => T | null;
  /** Handed what was found or made, once per card, for the page to keep. */
  onFound?: (value: T) => void;
  lookupWaitMs: number;
  makingWaitMs: number;
}

interface CardAsset<T> {
  /** The card's question can go on screen: found, made, or given up on. */
  settled: boolean;
  /** What the card was asked with, fixed once settled; a later arrival is for next time. */
  value: T | null;
  /** What it is still waiting on. */
  waitingFor: Waiting;
}

/**
 * One thing a card wants from the shared store (its picture, its exchange),
 * settled once per card and then left alone.
 *
 * The store is read first (`useWordAsset`, free). On a miss, and only when
 * the frame says so, the asset is made (`useEnsureWordAsset`, which shares one
 * ask per word and is careful with the learner's allowance for the kind). The
 * card waits for the read for `lookupWaitMs`, and for what is being made only
 * when a question could follow, for `makingWaitMs`; then it settles on what it
 * has. Whatever arrives after that is for the next time the card is dealt: a
 * question already on screen never changes under the learner.
 */
function useCardAsset<T>(options: CardAssetOptions<T>): CardAsset<T> {
  const { id, input, ready } = options;
  const wanted = input !== null;
  const stored = useWordAsset(input);
  const readRef = useRef(options.read);
  readRef.current = options.read;
  const onFoundRef = useRef(options.onFound);
  onFoundRef.current = options.onFound;

  const storedValue = useMemo(
    () => (stored.asset ? readRef.current({ url: stored.asset.url, payload: stored.asset.payload }) : null),
    [stored.asset],
  );

  // Handed to the page once per card, whichever way it was found. A made one
  // is found twice: by the ask, and again by the lookup it invalidates, once
  // the store has filed it.
  const handedOverFor = useRef<string | null>(null);
  const handOver = (card: string, value: T, save: ((value: T) => void) | undefined) => {
    if (!save || handedOverFor.current === card) return;
    handedOverFor.current = card;
    save(value);
  };

  const ensure = useEnsureWordAsset();
  const [made, setMade] = useState<{ id: string; done: boolean; value: T | null } | null>(null);
  const shouldMake = options.make && wanted && ready && !stored.isLoading && storedValue === null;

  useEffect(() => {
    if (!shouldMake || !input) return;
    const card = id;
    // The page's callback as it is now: it closes over this card's word, and
    // what is made may come back after the next card has been dealt.
    const save = onFoundRef.current;
    setMade({ id: card, done: false, value: null });
    void ensure(input).then((outcome) => {
      const value =
        outcome.status === "made" ? readRef.current({ url: outcome.url, payload: outcome.payload ?? null }) : null;
      if (value !== null) handOver(card, value, save);
      setMade((now) => (now?.id === card ? { id: card, done: true, value } : now));
    });
    // One ask per card dealt; `ensure` shares it across re-serves of the word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldMake, id]);

  // What the store already had goes to the page as well.
  useEffect(() => {
    if (wanted && storedValue !== null) handOver(id, storedValue, onFoundRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, storedValue, id]);

  const makingNow = shouldMake && !(made?.id === id && made.done);
  const waitingFor: Waiting = !wanted
    ? null
    : stored.isLoading
      ? "lookup"
      : makingNow && options.waitForMaking
        ? "making"
        : null;

  const [settled, setSettled] = useState<{ id: string; value: T | null } | null>(null);
  const isSettled = !wanted || settled?.id === id;
  const arrived = storedValue ?? (made?.id === id ? made.value : null);

  useEffect(() => {
    if (isSettled || !ready) return;
    if (waitingFor === null) {
      setSettled({ id, value: arrived });
      return;
    }
    const giveUp = setTimeout(
      () => setSettled({ id, value: null }),
      waitingFor === "lookup" ? options.lookupWaitMs : options.makingWaitMs,
    );
    return () => clearTimeout(giveUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettled, ready, waitingFor, arrived, id]);

  return { settled: isSettled, value: settled?.id === id ? settled.value : null, waitingFor };
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
  sharedPictures = false,
  onPictureMade,
  storedDialogues = false,
}: QuizCardFrameProps) => {
  // A card the device could not record for is served as the flashcard; the
  // ladder is consulted again for the next one.
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const [answered, setAnswered] = useState<{ rating: Rating; correct: boolean } | null>(null);

  useEffect(() => {
    setAnswered(null);
  }, [item.id]);

  const rung = rungForMemory(item.memory, item.direction);
  const canSpeak = recordingSupported();

  // The lesson's dialogue, and the line of it that uses the word, if any.
  const lessonLines = useMemo(() => asDialogue(item.dialogue), [item.dialogue]);
  const lessonReplyLine = useMemo(() => findReplyLine(lessonLines, item.arabic), [lessonLines, item.arabic]);
  // Whether the lesson alone can carry the reply question: what decides if a
  // card at step 6 may fall back onto a picture, before any stored exchange
  // is known.
  const lessonQuestion = useMemo(
    () =>
      lessonReplyLine ? buildReplyQuestion(lessonLines, item.arabic, item.id, item.extraDialogueLines ?? []) : null,
    [lessonReplyLine, lessonLines, item.arabic, item.id, item.extraDialogueLines],
  );

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
  // three that ask for one, and the ones that can fall back onto one of those
  // (a word with no dialogue is picked from four, or said on its own when it
  // has no sentence either; one with no sentence is said on its own).
  const usesStore = sharedPictures || !!onPictureMade;
  const usesPicture =
    rung.format === "picture-choice" ||
    rung.format === "word-choice" ||
    rung.format === "speak" ||
    (rung.format === "reply-choice" && !lessonQuestion) ||
    (rung.format === "speak-sentence" && !hasSentence) ||
    (rung.format === "speak-reply" && !lessonReplyLine && !hasSentence);
  const pictureInput = useMemo(
    () => ({ kind: "image", word: item.arabic, gloss: item.english, dialect: item.dialect ?? null }),
    [item.arabic, item.english, item.dialect],
  );
  const wantsPicture = usesStore && usesPicture && !ownPicture;

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

  // Wrong replies beyond the dialogue itself: other lessons' lines, and the
  // other words' stored replies in this word's dialect (a mixed session's
  // pool holds every dialect's, and a reply in another one gives the answer
  // away).
  const extraLines = useMemo(() => {
    const dialect = normalizeDialect(item.dialect ?? null);
    return [
      ...(item.extraDialogueLines ?? []),
      ...entries.flatMap((entry) =>
        entry.dialogueLine && (!entry.dialogueDialect || entry.dialogueDialect === dialect) ? [entry.dialogueLine] : [],
      ),
    ];
  }, [item.extraDialogueLines, item.dialect, entries]);

  const canChoose = Math.min(arabicPool.length, englishPool.length) >= CHOICE_COUNT - 1;

  // And failing the store, for a learner's own word at "pick the picture",
  // one is drawn. Asked once the store has said it has none, and only of a
  // deck the quiz can ask questions of at all: with too few words for four
  // options every card is the flip card, and a picture nobody is about to be
  // asked about is not worth the learner's allowance yet. The card waits for
  // the drawing only when a picture question could follow, which takes three
  // other words with pictures; otherwise it goes on behind the fallback
  // question and the picture is there the next time one is wanted.
  const picture = useCardAsset<string>({
    id: item.id,
    input: wantsPicture ? pictureInput : null,
    ready,
    make: !!onPictureMade && rung.format === "picture-choice" && canChoose,
    waitForMaking: otherPictures.length >= CHOICE_COUNT - 1,
    read: (asset) => asset.url,
    // A picture found or drawn goes onto the learner's row, so their word
    // list shows it and it can be dealt as a wrong picture. Whatever the
    // page's save does, it is not this card's to report.
    onFound: onPictureMade
      ? (url) => {
          void Promise.resolve()
            .then(() => onPictureMade(url))
            .catch(() => {});
        }
      : undefined,
    lookupWaitMs: PICTURE_LOOKUP_WAIT_MS,
    makingWaitMs: PICTURE_DRAWING_WAIT_MS,
  });

  // ── The card's exchange ───────────────────────────────────────────────────
  //
  // For the reply steps, when the lesson has no line that uses the word: the
  // store's exchange for it, or one written for it. Written only where its
  // question could be asked at all (a deck with four options for the choice,
  // a device that records for the spoken reply), and waited for only where it
  // could be asked now — the choice needs three wrong replies from the other
  // words; saying the reply needs none.
  const wantsDialogue =
    storedDialogues && (rung.format === "reply-choice" || rung.format === "speak-reply") && !lessonReplyLine;
  const dialogueInput = useMemo(
    () => ({ kind: "dialogue", word: item.arabic, gloss: item.english, dialect: item.dialect ?? null }),
    [item.arabic, item.english, item.dialect],
  );
  const choosing = rung.format === "reply-choice";
  const exchange = useCardAsset<StoredDialogue>({
    id: item.id,
    input: wantsDialogue ? dialogueInput : null,
    ready,
    // Not for a learner who chose to rate this card themselves.
    make: choosing ? canChoose : canSpeak && unavailableFor !== item.id,
    waitForMaking: choosing ? countWrongReplies(extraLines, item.arabic) >= CHOICE_COUNT - 1 : true,
    read: (asset) => asStoredDialogue(asset.payload, item.arabic),
    lookupWaitMs: DIALOGUE_LOOKUP_WAIT_MS,
    makingWaitMs: DIALOGUE_WRITING_WAIT_MS,
  });

  const isSettled = picture.settled && exchange.settled;
  const pictureUrl = ownPicture ?? picture.value;

  // The question goes on screen with this render: fix the pool it was dealt
  // from. Until then (the pool still loading, a picture or an exchange still
  // awaited) the live one is read, so a pool that arrives late is the one
  // that is used.
  if (ready && isSettled && deal?.id !== item.id) setDeal({ id: item.id, pool });

  // The dialogue the reply steps are asked from: the lesson's when a line of
  // it uses the word, else the exchange the card settled on.
  const chosenDialogue = useMemo(
    () => dialogueForWord(item.dialogue, exchange.value, item.arabic),
    [item.dialogue, exchange.value, item.arabic],
  );
  const dialogueLines = chosenDialogue?.lines ?? null;
  const replyLine = useMemo(
    () => (dialogueLines ? findReplyLine(dialogueLines, item.arabic) : null),
    [dialogueLines, item.arabic],
  );
  const replyQuestion = useMemo(
    () => (dialogueLines ? buildReplyQuestion(dialogueLines, item.arabic, item.id, extraLines) : null),
    [dialogueLines, item.arabic, item.id, extraLines],
  );

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
          hasReplyLine: !!replyLine,
          canSpeak,
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
    const writingLine = ready && !exchange.settled && exchange.waitingFor === "making";
    const drawingPicture = ready && !writingLine && !picture.settled && picture.waitingFor === "making";
    const lookingUp = ready && !drawingPicture && !writingLine;
    const why = writingLine
      ? "Writing a line for this word"
      : drawingPicture
        ? "Drawing a picture for this word"
        : "Preparing the question";
    return (
      <div
        role="status"
        aria-label={why}
        className="rounded-2xl bg-card border border-border p-8 flex flex-col items-center justify-center gap-3 min-h-[16rem]"
      >
        <span className={lookingUp ? "animate-in fade-in duration-300 delay-300 fill-mode-backwards" : undefined}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </span>
        {(writingLine || drawingPicture) && <p className="text-sm text-muted-foreground text-center">{why}…</p>}
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
    case "speak-reply":
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
          reply={format === "speak-reply" ? replyLine : null}
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
