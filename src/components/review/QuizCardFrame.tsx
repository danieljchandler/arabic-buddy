import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuizChoiceCard } from "@/components/review/QuizChoiceCard";
import { QuizOptionsCard, type QuizOption } from "@/components/review/QuizOptionsCard";
import { QuizBossBanner } from "@/components/review/QuizBossBanner";
import { QuizRungBadge } from "@/components/review/QuizRungBadge";
import { QuizSpeakCard, type QuizSpeechResult } from "@/components/review/QuizSpeakCard";
import { QuizStoryCard } from "@/components/review/QuizStoryCard";
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
import { otherMeanings, seededShuffle } from "@/lib/quizDistractors";
import { gradeQuizAnswer, isCorrectRating } from "@/lib/quizGrading";
import { storyGap } from "@/lib/quizStory";
import { BOSS_MEMORY } from "@/lib/bossCard";
import {
  CHOICE_COUNT,
  pickQuizFormat,
  rungForMemory,
  type QuizDirection,
  type QuizFormat,
  type QuizMemory,
} from "@/lib/quizLadder";
import type { Rating } from "@/lib/spacedRepetition";
import {
  actionsOverlap,
  animationConcept,
  normaliseGloss,
  type AssetKeyInput,
} from "../../../supabase/functions/_shared/wordAssets";
import {
  asStoredAnimation,
  qualifiesForAnimation,
  type StoredAnimation,
} from "../../../supabase/functions/_shared/wordAnimation";
import { normalizeDialect } from "../../../supabase/functions/_shared/ttsVoiceRoutingCore";
import { asStoredDialogue, type StoredDialogue } from "../../../supabase/functions/_shared/wordDialogue";
import { asStoredStoryLine, type StoredStoryLine } from "../../../supabase/functions/_shared/wordStoryLine";

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
  /**
   * The authored category ("Verb — routine"), for a curriculum word: what
   * makes it an action word, which may be shown as an animation. A saved word
   * has none and is never one.
   */
  category?: string | null;
  /** The schedule the deck served the card on. */
  direction: QuizDirection;
  memory: QuizMemory;
  /**
   * The session's boss (quiz Phase 7, `src/lib/bossCard.ts`): the learner's
   * worst word, opening the session. Asked as a first look whatever its
   * memory, with its picture in view and its memory hook a tap away; beating
   * it is a celebration (the page's, once the rating is saved). A recognition
   * card only: the pages set it so.
   */
  boss?: {
    lapses: number;
    mnemonic?: string | null;
    /** The hook's picture, else the word's own. */
    pictureUrl?: string | null;
  } | null;
}

export interface QuizGraded {
  rating: Rating;
  correct: boolean;
  format: QuizFormat;
  /**
   * The step the card's memory puts it on. A boss is asked a first look
   * whatever its step; this is still its own, so beating it is not counted
   * as a climb from step 1.
   */
  step: number;
  /** The card that was asked, as the frame was handed it (the lightning round asks it again). */
  item: QuizItem;
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
  /**
   * Show an action word's animation from the shared store (`kind:
   * "animation"`, quiz Phase 5) where its picture would be: on "say it" and
   * on the picture question. A free read of a public table; nothing is ever
   * made from here, since only the content team's tools make clips. The
   * curriculum deck sets this: only an authored category says a word is an
   * action (`qualifiesForAnimation`).
   */
  animations?: boolean;
  /**
   * The top step ("in a story", quiz Phase 6): look the word's two-sentence
   * passage up in the shared store (`kind: "story_line"`), and on a miss have
   * one found in a published story or written (the store's `ensure`; a
   * written one is on the learner's daily dialogue allowance). Like an
   * exchange it lives in the store alone, so the curriculum deck may ask as
   * well as a learner's own words.
   */
  storyLines?: boolean;
  /**
   * The rescue panel for a leech (`LeechHelperPanel`), shown below the card.
   * Under the boss it waits for the answer, since it prints the memory hook
   * the boss keeps behind a tap; on every other card, the flip card included,
   * it is there from the start, as it always was.
   */
  leechPanel?: ReactNode;
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

/**
 * How long a card waits to hear whether the store holds its word's clip: a
 * read of one row. Nothing is ever made for it, so there is no longer wait;
 * past this the card is asked with its picture, as before clips existed.
 */
export const ANIMATION_LOOKUP_WAIT_MS = 1500;

/** How long a card waits to hear whether the store holds its story passage: a read of one row. */
export const STORY_LINE_LOOKUP_WAIT_MS = 1500;

/**
 * How long "in a story" waits for a passage being found or written for it.
 * One found in a published story is a few reads; one written is drafted,
 * critiqued and checked by a native-speaker validator, as an exchange is.
 * Past this the card is asked the step below (say the reply), and the
 * passage is filed for the next time the word is asked.
 */
export const STORY_LINE_WRITING_WAIT_MS = 12_000;

/**
 * The fewest clips the picture question plays at once. One moving option
 * among three stills is the answer more often than not, so motion would be a
 * tell: below this, every clip on the screen is shown as its poster.
 */
export const MIN_MOVING_OPTIONS = 2;

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
  animations = false,
  storyLines = false,
  leechPanel = null,
}: QuizCardFrameProps) => {
  // A card the device could not record for is served as the flashcard; the
  // ladder is consulted again for the next one.
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const [answered, setAnswered] = useState<{ rating: Rating; correct: boolean } | null>(null);

  useEffect(() => {
    setAnswered(null);
  }, [item.id]);

  // The boss is asked as a first look, whatever its memory; its own step is
  // what the page is told, so the session's climbs are counted from it.
  const boss = item.boss && item.direction === "recognition" ? item.boss : null;
  const memory = boss ? BOSS_MEMORY : item.memory;
  const rung = rungForMemory(memory, item.direction);
  const ownStep = boss ? rungForMemory(item.memory, item.direction).step : rung.step;
  const canSpeak = recordingSupported();
  // The boss's memory hook, open; opened before the answer, it is help.
  const [hook, setHook] = useState<{ id: string; helped: boolean } | null>(null);
  const hookOpen = hook?.id === item.id;
  const hookHelped = hookOpen && hook.helped;

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
  // has no sentence either; one with no sentence is said on its own; a word
  // with no passage is asked the reply, and so on down).
  const usesStore = sharedPictures || !!onPictureMade;
  const usesPicture =
    rung.format === "picture-choice" ||
    rung.format === "word-choice" ||
    rung.format === "speak" ||
    (rung.format === "reply-choice" && !lessonQuestion) ||
    (rung.format === "speak-sentence" && !hasSentence) ||
    ((rung.format === "speak-reply" || rung.format === "story-gap") && !lessonReplyLine && !hasSentence);
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

  // Wrong meanings: the other words' glosses, once each, never another gloss
  // of this word (`otherMeanings`).
  const englishPool = useMemo(
    () => otherMeanings(dealtPool, { arabic: item.arabic, english: item.english }),
    [dealtPool, item.arabic, item.english],
  );

  // Which word each wrong meaning belongs to, for "Why not this one?" on the
  // meaning questions: what the learner took the word for. Only the other
  // words, and a meaning two of them share names neither.
  const wordForMeaning = useMemo(() => {
    const ownWord = normalizeArabicWord(item.arabic);
    const words = new Map<string, string | null>();
    for (const other of dealtPool) {
      const key = other.english.trim().toLowerCase();
      if (!key || !ARABIC_RE.test(other.arabic)) continue;
      const word = normalizeArabicWord(other.arabic);
      if (word === ownWord) continue;
      const seen = words.get(key);
      if (seen === undefined) words.set(key, other.arabic);
      else if (seen !== null && normalizeArabicWord(seen) !== word) words.set(key, null);
    }
    return (english: string) => words.get(english.trim().toLowerCase()) ?? null;
  }, [dealtPool, item.arabic]);

  // Pictures of other words, once each, and never one that means what this
  // word means (another dialect's word for it, in a mixed deck) or shows its
  // action ("eat" where this one says "I eat", "watch" beside "watch / see",
  // "sells" beside "sell"): that is a second right answer. A past tense beside
  // its present ("ate", "eat") is not caught. A word is dealt one visual — its clip where the pool
  // has one, else its picture — so a clip and a picture of one word are never
  // both on the screen. The word's own is taken out where the options are
  // dealt, once it is known which visual that is.
  const otherPictures = useMemo(() => {
    const ownSense = normaliseGloss(item.english);
    const ownAction = animationConcept(item.english);
    const seen = new Set<string>();
    const out: QuizPoolEntry[] = [];
    for (const entry of entries) {
      const visual = entry.animation?.clip ?? entry.imageUrl;
      if (!visual || seen.has(visual)) continue;
      if (ownSense && normaliseGloss(entry.english) === ownSense) continue;
      if (ownAction && actionsOverlap(ownAction, animationConcept(entry.english))) continue;
      seen.add(visual);
      out.push(entry);
    }
    return out;
  }, [entries, item.english]);

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
  // words; saying the reply needs none. "In a story" falls back onto saying
  // the reply, so it looks the exchange up too, but never has one written: a
  // card that may be asked its passage is not charged for its fallback as well.
  const wantsDialogue =
    storedDialogues &&
    (rung.format === "reply-choice" || rung.format === "speak-reply" || rung.format === "story-gap") &&
    !lessonReplyLine;
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
    make: choosing ? canChoose : rung.format === "speak-reply" && canSpeak && unavailableFor !== item.id,
    waitForMaking: choosing ? countWrongReplies(extraLines, item.arabic) >= CHOICE_COUNT - 1 : true,
    read: (asset) => asStoredDialogue(asset.payload, item.arabic),
    lookupWaitMs: DIALOGUE_LOOKUP_WAIT_MS,
    makingWaitMs: DIALOGUE_WRITING_WAIT_MS,
  });

  // ── The card's clip ───────────────────────────────────────────────────────
  //
  // For an action word, on the steps that show its picture: "say it" (and the
  // steps that fall back onto it) and the picture question. Read from the
  // store, never made — only the content team's tools make clips — so the
  // card waits only for the read, and with none it is asked with its picture
  // exactly as before. Settled once, like the picture: a clip filed while the
  // question is on screen is for the next time.
  const usesClip =
    rung.format === "picture-choice" ||
    rung.format === "speak" ||
    (rung.format === "speak-sentence" && !hasSentence) ||
    ((rung.format === "speak-reply" || rung.format === "story-gap") && !lessonReplyLine && !hasSentence);
  const wantsAnimation =
    animations && usesClip && qualifiesForAnimation({ category: item.category, gloss: item.english });
  const animationInput = useMemo(() => ({ kind: "animation", gloss: item.english }), [item.english]);
  const animation = useCardAsset<StoredAnimation>({
    id: item.id,
    input: wantsAnimation ? animationInput : null,
    ready,
    make: false,
    waitForMaking: false,
    read: (asset) => asStoredAnimation(asset),
    lookupWaitMs: ANIMATION_LOOKUP_WAIT_MS,
    makingWaitMs: 0,
  });

  // ── The card's story passage ──────────────────────────────────────────────
  //
  // For the top step: two sentences of a story with the word in one of them,
  // from the store, or found in a published story or written for it on a
  // miss. Asked for only where its question can be asked at all — said on a
  // device that records, else its gap picked from four, which needs three
  // other words — and that question needs nothing more once the passage is
  // here, so the card waits for it whenever it asked. Settled once, like
  // everything else: a passage filed while the card is on screen is for the
  // next time the word is asked.
  const wantsStoryLine = storyLines && rung.format === "story-gap";
  const storyInput = useMemo(
    () => ({ kind: "story_line", word: item.arabic, gloss: item.english, dialect: item.dialect ?? null }),
    [item.arabic, item.english, item.dialect],
  );
  const storyAskable = canSpeak || canChoose;
  const storyLine = useCardAsset<StoredStoryLine>({
    id: item.id,
    input: wantsStoryLine ? storyInput : null,
    ready,
    make: storyAskable,
    waitForMaking: storyAskable,
    read: (asset) => asStoredStoryLine(asset.payload, item.arabic),
    lookupWaitMs: STORY_LINE_LOOKUP_WAIT_MS,
    makingWaitMs: STORY_LINE_WRITING_WAIT_MS,
  });
  const story = useMemo(
    () => storyGap(storyLine.value, item.arabic, item.english),
    [storyLine.value, item.arabic, item.english],
  );

  const isSettled = picture.settled && exchange.settled && animation.settled && storyLine.settled;
  const pictureUrl = ownPicture ?? picture.value;
  const ownClip = animation.value;

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
    () =>
      otherPictures.filter(
        (entry) =>
          (!pictureUrl || entry.imageUrl !== pictureUrl) && (!ownClip || entry.animation?.clip !== ownClip.clip),
      ),
    [otherPictures, pictureUrl, ownClip],
  );

  const format: QuizFormat =
    unavailableFor === item.id
      ? "flashcard"
      : pickQuizFormat(memory, item.direction, {
          hasSentence,
          hasImage: !!pictureUrl || !!ownClip,
          distractors: Math.min(arabicPool.length, englishPool.length),
          imageDistractors: imageEntries.length,
          hasReply: !!replyQuestion,
          hasReplyLine: !!replyLine,
          hasStoryLine: !!story,
          canSpeak,
        });

  const settle = (rating: Rating) => setAnswered({ rating, correct: isCorrectRating(rating) });

  const onChoice = (correct: boolean, hintUsed = false) =>
    settle(gradeQuizAnswer({ kind: "choice", correct, hintUsed: hintUsed || hookHelped }));

  const onSpeech = (result: QuizSpeechResult) =>
    settle(
      gradeQuizAnswer({
        kind: "speech",
        score: result.score,
        similarity: result.similarity,
        hintUsed: result.hintUsed,
        reply: result.reply,
      }),
    );

  const advance = () => {
    if (!answered) return;
    onGraded({ ...answered, format, step: ownStep, item });
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
    const writingPassage = ready && !storyLine.settled && storyLine.waitingFor === "making";
    const writingLine = ready && !writingPassage && !exchange.settled && exchange.waitingFor === "making";
    const drawingPicture =
      ready && !writingPassage && !writingLine && !picture.settled && picture.waitingFor === "making";
    const lookingUp = ready && !drawingPicture && !writingLine && !writingPassage;
    const why = writingPassage
      ? "Finding a story for this word"
      : writingLine
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
        {(writingPassage || writingLine || drawingPicture) && (
          <p className="text-sm text-muted-foreground text-center">{why}…</p>
        )}
      </div>
    );
  }

  // No question for this card: the flip card, and no boss with it.
  if (format === "flashcard")
    return (
      <>
        {renderFlashcard()}
        {leechPanel}
      </>
    );

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
          dialect={item.dialect}
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
          wordForMeaning={wordForMeaning}
          context={context}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    case "picture-choice": {
      // Each option is one visual: the word's clip where it has one, else its
      // picture. Clips move only where at least `MIN_MOVING_OPTIONS` of the
      // four do, so the one moving option is never the giveaway.
      const dealt = dealOptions(
        imageEntries,
        ownClip
          ? { key: "answer", animation: ownClip, english: item.english }
          : { key: "answer", imageUrl: pictureUrl, english: item.english },
        (e, i) =>
          // The word behind a wrong picture is never shown; "Why not this
          // one?" names it to the tutor once the pick is made.
          e.animation
            ? { key: `wrong-${i}`, animation: e.animation, english: e.english, arabic: e.arabic }
            : { key: `wrong-${i}`, imageUrl: e.imageUrl, english: e.english, arabic: e.arabic },
      );
      const moving = dealt.filter((option) => option.animation).length >= MIN_MOVING_OPTIONS;
      card = (
        <QuizOptionsCard
          id={item.id}
          format="picture-choice"
          prompt={{ arabic: item.arabic, audioUrl: item.audioUrl }}
          options={moving ? dealt : dealt.map((option) => (option.animation ? { ...option, still: true } : option))}
          answerKey="answer"
          dialect={item.dialect}
          onAnswer={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
        />
      );
      break;
    }
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
          animation={format === "speak" ? ownClip : null}
          dialect={item.dialect}
          sentence={context}
          reply={format === "speak-reply" ? replyLine : null}
          onResult={onSpeech}
          onUnavailable={() => setUnavailableFor(item.id)}
        />
      );
      break;
    case "story-gap":
    case "story-choice":
      card = (
        <QuizStoryCard
          format={format}
          id={item.id}
          arabic={item.arabic}
          english={item.english}
          transliteration={item.transliteration}
          dialect={item.dialect}
          story={story!}
          distractors={arabicPool}
          onResult={onSpeech}
          onChoice={({ correct, hintUsed }) => onChoice(correct, hintUsed)}
          onUnavailable={() => setUnavailableFor(item.id)}
        />
      );
      break;
  }

  return (
    <div>
      <QuizRungBadge step={rung.step} label={rung.label} combo={combo} className="mb-4" />
      {boss && (
        <QuizBossBanner
          lapses={boss.lapses}
          mnemonic={boss.mnemonic}
          pictureUrl={boss.pictureUrl ?? item.imageUrl ?? null}
          answered={!!answered}
          hookOpen={hookOpen}
          onOpenHook={() => setHook({ id: item.id, helped: !answered })}
        />
      )}
      {card}
      {answered && (
        <div className="mt-6 flex justify-center animate-in fade-in duration-200">
          <Button onClick={advance} className="gap-2 px-6">
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {(!boss || answered) && leechPanel}
    </div>
  );
};
