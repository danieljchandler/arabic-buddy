import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useDueWords,
  useReviewStats,
  buildReviewUpdate,
  type DueCurriculumCard,
} from "@/hooks/useReview";
import { nextRelearn, pushRelearn, type RelearnEntry } from "@/lib/relearn";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { useFsrsCalibration } from "@/hooks/useFsrsCalibration";
import { useFsrsWeights } from "@/hooks/useFsrsWeights";
import { useReviewQueue } from "@/hooks/useReviewQueue";
import { useReviewSession } from "@/hooks/useReviewSession";
import { RootChip } from "@/components/vocab/RootChip";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { SessionHandoff } from "@/components/review/SessionHandoff";
import { SessionProgress } from "@/components/review/SessionProgress";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { useDialect } from "@/contexts/DialectContext";
import { Rating, calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { scheduleDirectionFor } from "@/lib/reviewOrder";
import type { QuizAsked } from "@/lib/quizRatingFields";
import { ReviewAudioCard } from "@/components/review/ReviewAudioCard";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { Trophy, Brain, Sparkles, LogIn, Shuffle, Eye, Volume2, ImagePlus, WifiOff, CloudUpload, PenLine, BookOpen, Music, Play, Loader2, RefreshCw } from "lucide-react";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useReviewKeyboard } from "@/hooks/useKeyboardShortcuts";
import { useReviewStyle } from "@/hooks/useReviewStyle";
import { useCurriculumWordPool } from "@/hooks/useQuizPool";
import { useAddXP } from "@/hooks/useGamification";
import { QuizCardFrame, type QuizGraded, type QuizItem } from "@/components/review/QuizCardFrame";
import { ReviewStyleSwitch } from "@/components/review/ReviewStyleSwitch";
import { QuizSessionSummary } from "@/components/review/QuizSessionSummary";
import { LightningRound } from "@/components/review/LightningRound";
import { addLightningWord, lightningWordFor, type LightningWord } from "@/lib/lightningRound";
import { EMPTY_QUIZ_SESSION, comboBonus, recordQuizAnswer, type QuizSessionStats } from "@/lib/quizSession";
import { LADDER_THRESHOLDS, rungForMemory } from "@/lib/quizLadder";
import { bossBeaten, bossFor } from "@/lib/bossCard";
import { celebrate } from "@/lib/celebrations";
import { asDialogue } from "@/lib/quizDialogue";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl, sharedJingleUrl } from "@/lib/jingleAudio";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";



const DIALECT_FLAGS: Record<string, string> = {
  Gulf: "🇦🇪",
  Egyptian: "🇪🇬",
  Yemeni: "🇾🇪",
};

/**
 * How long the end of the list shows "Checking for more cards…" while it asks
 * what is due next, before it shows the end of the session instead. The
 * request is not abandoned: what it brings is served when it lands.
 */
const LIST_WAIT_MS = 4000;

/** No cards: the list just walked, spent. */
const NO_CARDS: DueCurriculumCard[] = [];

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const queryClient = useQueryClient();

  const { activeDialect } = useDialect();
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  const [mixAll, setMixAll] = useState(false);

  // How the learner wants to be asked. The quiz serves the same cards from
  // the same schedules; only the question and who grades it change — and a
  // production card waits until the word has climbed to the picture step.
  const { style: reviewStyle } = useReviewStyle();
  const quiz = reviewStyle === "quiz";
  const {
    data: fetchedDueWords,
    isLoading: wordsLoading,
    isPaused: wordsPaused,
    isError: wordsError,
    refetch,
  } = useDueWords(
    mixAll,
    // The quiz opens on the boss: the recognition leech with the most lapses
    // goes first (src/lib/bossCard.ts), while the learner tracks leeches.
    quiz ? { holdProductionBelow: LADDER_THRESHOLDS.pictureDays, bossFirst: leechTrackingEnabled } : {},
  );
  const { data: stats } = useReviewStats(mixAll);
  // The list just walked is spent: every card of it has been rated, so it is
  // never shown again while the page asks what is due next (closeList).
  const [listSpent, setListSpent] = useState(false);
  const dueWords = listSpent ? NO_CARDS : fetchedDueWords;
  const { enqueue, pendingCount, isFlushing, isOnline } = useReviewQueue();
  const session = useReviewSession(mixAll);
  const { data: wordPool, isLoading: poolLoading } = useCurriculumWordPool(activeDialect, mixAll, quiz);
  const addXP = useAddXP();
  const [quizStats, setQuizStats] = useState<QuizSessionStats>(EMPTY_QUIZ_SESSION);
  // Today's right answers at the first four steps, for the lightning round.
  const [lightningWords, setLightningWords] = useState<LightningWord<QuizItem>[]>([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  // Curriculum cards live in vocabulary_words, whose UPDATE policy admits only
  // admin/recorder — for anyone else the image save matches zero rows with no
  // error, so the generation cost is spent and nothing persists. Only offer
  // the button to roles whose save actually works.
  const { isAdmin, isRecorder } = useAdminAuth();
  const canEditCurriculumImages = isAdmin || isRecorder;
  const [jingleLoading, setJingleLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackAudioUrlRef = useRef<string | null>(null);


  // In-session relearn: cards rated Again/Hard come back a few cards later
  // (see lib/relearn). Without this, a failed card's 1-minute learning step
  // never fires — the end-of-list refetch runs seconds too early, the session
  // ends, and the card gets no successful retrieval until tomorrow.
  const [relearn, setRelearn] = useState<RelearnEntry<DueCurriculumCard>[]>([]);
  // The main list has been walked to the end; only relearn cards remain.
  const [mainDone, setMainDone] = useState(false);
  // The page is asking what is due after the list it walked (closeList), and
  // has not waited LIST_WAIT_MS yet.
  const [closingList, setClosingList] = useState(false);
  const closingRef = useRef(false);
  // Which close a fetch's answer belongs to: a deck switched meanwhile makes it
  // the old deck's, and it must not touch the new one.
  const closeGeneration = useRef(0);

  // Leaving the page drops the deck it built. A cached list served on the way
  // back in is the one from before this visit's ratings, with the cards just
  // rated still in it (offline, its paused fetch would be joined, not redone).
  useEffect(() => () => queryClient.removeQueries({ queryKey: ["due-words"] }), [queryClient]);
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();
  const { weights } = useFsrsWeights();

  // The card on screen: a due relearn card takes precedence over the list.
  const relearnPick = nextRelearn(relearn, sessionCount, mainDone);

  usePageAiContext(
    useMemo(() => {
      const word = relearnPick?.card ?? dueWords?.[currentIndex];
      if (!word) return null;
      return {
        kind: "word" as const,
        title: "Review",
        summary:
          "Spaced-repetition review of due vocabulary — recognition, production and audio cards.",
        // The card is a recall test; handing the assistant the pair before the
        // learner flips would let it give the answer away.
        content: showAnswer
          ? `Current card: ${word.word_arabic} — ${word.word_english}`
          : undefined,
      };
    }, [dueWords, currentIndex, showAnswer, relearnPick]),
  );

  const handleFlip = useCallback(() => setShowAnswer(true), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleRate is
  // recreated per render; list everything it closes over so the keyboard
  // path never rates through a stale session state.
  const handleRateKeyboard = useCallback((rating: Rating) => {
    handleRate(rating);
  }, [dueWords, currentIndex, relearn, relearnPick, sessionCount, mainDone]);

  useReviewKeyboard({
    showAnswer,
    onFlip: handleFlip,
    onRate: handleRateKeyboard,
    // A relearn card outlives the fetched list, so gate on there being a card
    // rather than on the list being non-empty — otherwise a mid-session
    // invalidation leaves a card on screen that the keyboard cannot rate.
    // The quiz grades, so its cards take no rating keys; the frame handles
    // Enter and Space itself.
    enabled: !quiz && ((dueWords?.length ?? 0) > 0 || !!relearnPick),
  });

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  /**
   * Play a stored jingle, repairing older files whose container header the
   * generator wrote wrong (same path the personal decks use).
   */
  const playJingle = async (url: string) => {
    if (audioRef.current) audioRef.current.pause();
    if (fallbackAudioUrlRef.current) {
      URL.revokeObjectURL(fallbackAudioUrlRef.current);
      fallbackAudioUrlRef.current = null;
    }
    try {
      const audioFile = await createPlayableJingleAudioFromUrl(url);
      const repairedUrl = URL.createObjectURL(audioFile.blob);
      fallbackAudioUrlRef.current = repairedUrl;
      const audio = new Audio(repairedUrl);
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error("Jingle playback failed:", err);
      toast.error("Couldn't play that jingle. Try regenerating it.");
    }
  };

  /**
   * Generate (or replay) a jingle for the curriculum word on screen.
   *
   * The personal decks have had this since jingles landed; the curriculum deck
   * had no button at all, so an Egyptian (or any) lesson word could never get
   * one. The jingle is stored on the learner's own `word_reviews` row —
   * `vocabulary_words` is admin-write only — upserted because a brand-new card
   * has no review row yet.
   */
  const generateJingle = async (word: DueCurriculumCard, regenerate = false) => {
    if (!user) return;
    const existingUrl = word.review?.jingle_audio_url ?? null;
    if (existingUrl && !regenerate) {
      playJingle(existingUrl);
      return;
    }
    setJingleLoading(true);
    try {
      const response = await supabase.functions.invoke("generate-word-jingle", {
        body: {
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          dialect: word.dialect_module ?? activeDialect,
          // The first jingle for a word comes from the shared asset store —
          // another learner's, or a new one filed for the next. A regeneration
          // asks for a different one, so it stays this learner's own.
          share: !regenerate,
        },
      });
      if (showCapToastIfLimited(response.error, response.data)) return;
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      let jingleUrl = sharedJingleUrl(response.data);
      if (!jingleUrl) {
        const audioFile = await createPlayableJingleAudio(response.data);
        const fileName = `jingles/${user.id}/curriculum-${word.id}-${Date.now()}.${audioFile.extension}`;
        const { error: uploadError } = await supabase.storage
          .from("flashcard-audio")
          .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
        if (uploadError) throw uploadError;
        jingleUrl = supabase.storage.from("flashcard-audio").getPublicUrl(fileName).data.publicUrl;
      }
      const lyrics = (response.data as { lyrics?: string | null })?.lyrics ?? null;
      const { data: savedReview, error: saveError } = await supabase
        .from("word_reviews")
        .upsert(
          {
            user_id: user.id,
            word_id: word.id,
            jingle_audio_url: jingleUrl,
            jingle_lyrics: lyrics,
          } as never,
          { onConflict: "user_id,word_id" },
        )
        .select("*")
        .single();
      if (saveError) throw saveError;
      // Patch the cached queue in place rather than refetching — a refetch
      // reorders the deck under the learner mid-card. Patch with the row the
      // upsert actually produced: fabricating a review object with no `id`
      // for a brand-new card sent its first rating down the UPDATE branch as
      // `.eq("id", undefined)`, a permanent error that dropped the rating.
      queryClient.setQueriesData<DueCurriculumCard[] | undefined>(
        { queryKey: ["due-words"] },
        (prev) =>
          prev?.map((c) =>
            c.id === word.id
              ? {
                  ...c,
                  review: {
                    ...(c.review ?? ({} as NonNullable<DueCurriculumCard["review"]>)),
                    ...(savedReview as unknown as NonNullable<DueCurriculumCard["review"]>),
                  },
                }
              : c,
          ),
      );
      setShowLyrics(true);
      toast.success("🎵 Jingle created — tap Play jingle to listen.");
    } catch (err) {
      console.error("Jingle generation error:", err);
      const message = err instanceof Error ? err.message : "";
      if (message.includes("Rate limit") || message.includes("429")) {
        toast.error("Rate limited — try again in a moment");
      } else if (message.includes("402") || message.includes("Credits")) {
        toast.error("AI credits exhausted — please add funds");
      } else {
        toast.error("Failed to generate jingle");
      }
    } finally {
      setJingleLoading(false);
    }
  };


  /**
   * Cache a synthesised pronunciation onto the shared curriculum word.
   *
   * `vocabulary_words` is admin/recorder-write only, so unlike the personal
   * deck the client can't stamp `audio_url` itself — without this every
   * audio-first card would re-synthesise the same word on every review, for
   * every learner. The edge function does the write under the service role and
   * re-synthesises from the word's own text, so nothing arbitrary can be
   * attached to a shared row. Best-effort: a failure just means we synthesise
   * again next time.
   */
  const persistCurriculumAudio = useCallback(async () => {
    // The card on screen, which during a relearn pass is not the one the list
    // index points at — caching against that would stamp the wrong word.
    const word = relearnPick?.card ?? dueWords?.[currentIndex];
    if (!word || word.audio_url) return;
    try {
      await supabase.functions.invoke("persist-word-audio", {
        // Same fallback the card uses for playback. Sending the raw nullable
        // column instead would let the learner hear one voice and cache
        // another — and the cache is written once and never revisited.
        body: { wordId: word.id, dialect: word.dialect_module ?? activeDialect },
      });
    } catch (err) {
      console.warn("Couldn't cache word audio:", err);
    }
  }, [dueWords, currentIndex, activeDialect, relearnPick]);

  /**
   * The end of the list: ask what is due now. It used to show the walked
   * list's first card while the refetch was out, and the server, not yet
   * holding the last ratings the queue was still sending, could send the same
   * cards back: the session served a card it had just rated. Now the walked
   * list is spent at once and never shown again; the due list leaves out any
   * card whose rating is still queued (useDueWords), whatever the server says;
   * and the page shows "Checking for more cards…" for at most LIST_WAIT_MS,
   * then the end of the session, serving what the fetch brings when it lands.
   * Offline, React Query holds the fetch until the connection is back.
   */
  const closeList = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const generation = ++closeGeneration.current;
    setListSpent(true);
    setClosingList(true);
    setCurrentIndex(0);
    const waited = window.setTimeout(() => {
      if (generation === closeGeneration.current) setClosingList(false);
    }, LIST_WAIT_MS);
    void refetch().finally(() => {
      window.clearTimeout(waited);
      if (generation !== closeGeneration.current) return;
      closingRef.current = false;
      setListSpent(false);
      setClosingList(false);
    });
  };

  const handleRate = (rating: Rating, asked?: QuizAsked) => {
    const word = relearnPick?.card ?? dueWords?.[currentIndex];
    // Gate on the card, not the list: a relearn card outlives the fetched
    // list, and dropping its rating would lose the retrieval it is owed.
    if (!word) return;
    const wordCount = dueWords?.length ?? 0;
    const direction = scheduleDirectionFor(word.card_type);

    // Queue locally; background processor retries on network failures.
    // The direction decides which column set the rating lands in — getting it
    // wrong silently corrupts the card's schedule, so it is passed explicitly
    // rather than inferred at flush time.
    enqueue({
      wordId: word.id,
      rating,
      currentReview: word.review,
      direction,
      // What the quiz asked it as, for the review log (quiz Phase 8).
      asked,
    });

    // A failed card re-enters the session a few cards later, carrying the
    // schedule this rating just computed — the queue flushes writes in order,
    // so the re-presentation's rating supersedes it from the right state.
    // Anki semantics: Again always repeats; Hard repeats only while the card
    // is still in learning (repetitions 0) — on a graduated card Hard is a
    // pass, already scheduled days out, and re-rating it minutes later just
    // churns the schedule. Cards with no review row yet are exempt: their
    // first rating is an INSERT whose id the client never sees, so a second
    // in-session rating could not target the row.
    let nextQueue = relearnPick ? relearn.slice(1) : relearn;
    if ((rating === "again" || (rating === "hard" && word.repetitions === 0)) && word.review) {
      const { update } = buildReviewUpdate(rating, direction, word.review, new Date(), {
        fuzzSeed: word.id,
        desiredRetention,
        stabilityMultiplier,
        weights,
      });
      const requeued = { ...word, review: { ...word.review, ...update } };
      nextQueue = pushRelearn(nextQueue, requeued, sessionCount + 1);
    }
    setRelearn(nextQueue);

    setSessionCount((prev) => prev + 1);
    setShowAnswer(false);

    if (relearnPick) {
      // Rating a relearn card never advances the main list; when the last
      // relearn card resolves after the main list is done, the session is over.
      if (mainDone && nextQueue.length === 0) {
        setMainDone(false);
        closeList();
      }
      return;
    }

    // Advance immediately — UI does not wait on the network
    if (currentIndex < wordCount - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else if (nextQueue.length > 0) {
      // End of the fetched list with relearn cards owed: hold the session
      // open and present them instead of refetching into "all caught up".
      setMainDone(true);
    } else {
      // End of list: what is due next.
      closeList();
    }
  };


  /**
   * A quiz answer. The app rated it, so this records the session tally (the
   * step the card's new memory state lands on says whether it climbed) and
   * hands the rating down the same path a tap on the rating buttons takes.
   */
  const handleQuizGraded = (graded: QuizGraded) => {
    const word = relearnPick?.card ?? dueWords?.[currentIndex];
    if (!word) return;
    const direction = scheduleDirectionFor(word.card_type);
    const { result } = buildReviewUpdate(graded.rating, direction, word.review, new Date(), {
      fuzzSeed: word.id,
      desiredRetention,
      stabilityMultiplier,
      weights,
    });
    const stepAfter = rungForMemory(
      { stability: result.stability, repetitions: result.repetitions },
      direction,
    ).step;
    const next = recordQuizAnswer(quizStats, {
      correct: graded.correct,
      stepBefore: graded.step,
      stepAfter,
    });
    setQuizStats(next);
    const lightning = lightningWordFor(graded, graded.item);
    if (lightning) setLightningWords((prev) => addLightningWord(prev, lightning));
    // A flourish, never a schedule: the combo pays XP and nothing else.
    const bonus = comboBonus(next.combo);
    if (bonus) addXP.mutate({ amount: bonus, reason: "quiz_combo" });
    handleRate(graded.rating, { format: graded.format, step: graded.askedStep });
    // Beating the boss is the moment, celebrated once the rating is on its
    // way, as the session moves on.
    if (bossBeaten(graded)) celebrate({ kind: "boss", detail: graded.item.arabic });
  };

  const handleToggleMix = () => {
    setMixAll((prev) => !prev);
    setCurrentIndex(0);
    setSessionCount(0);
    setQuizStats(EMPTY_QUIZ_SESSION);
    setLightningWords([]);
    setShowAnswer(false);
    // Switching decks starts a new session; relearn cards belong to the old one.
    setRelearn([]);
    setMainDone(false);
    // A close still out belongs to the old deck.
    closeGeneration.current++;
    closingRef.current = false;
    setListSpent(false);
    setClosingList(false);
  };

  if (authLoading || wordsLoading) {
    return (
      <AppShell compact>
        <LoadingPanel variant="page" statusOverride="Loading your reviews…" />
      </AppShell>
    );
  }

  // Offline before the deck has loaded at all: its first fetch waits for the
  // connection, which React Query does not count as loading. That is not an
  // empty deck, so neither "all caught up" nor a forward to another one.
  if (fetchedDueWords === undefined && wordsPaused) {
    return (
      <AppShell compact>
        <div className="max-w-md mx-auto text-center pt-24" role="status">
          <h1 className="text-xl font-bold text-foreground mb-3">You&apos;re offline</h1>
          <p className="text-muted-foreground mb-8">Your reviews load as soon as the connection is back.</p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Go Home
          </Button>
        </div>
      </AppShell>
    );
  }

  // Between the last card and what comes next (closeList): briefly, a loader;
  // past LIST_WAIT_MS, with the fetch still out (a slow or dropped
  // connection), what is happening and a way out. Not the end of the session
  // yet, so no celebration and no lightning round until the answer lands.
  if (listSpent) {
    if (closingList) {
      return (
        <AppShell compact>
          <LoadingPanel variant="page" statusOverride="Checking for more cards…" />
        </AppShell>
      );
    }
    return (
      <AppShell compact>
        <div className="max-w-md mx-auto text-center pt-24" role="status">
          <h1 className="text-xl font-bold text-foreground mb-3">Still checking for more cards</h1>
          <p className="text-muted-foreground mb-8">
            {isOnline ? "The connection is slow." : "You're offline."} Your answers are kept on this device and
            saved as soon as it allows.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Go Home
          </Button>
        </div>
      </AppShell>
    );
  }

  // A failed fetch used to fall through to "All caught up!" — a false success
  // on the app's central loop. Say what happened and offer a retry instead.
  if (wordsError) {
    return (
      <AppShell compact>
        <div className="max-w-md mx-auto text-center pt-24">
          <h1 className="text-xl font-bold text-foreground mb-3">Your reviews didn&apos;t load</h1>
          <p className="text-muted-foreground mb-8">
            Check your connection and try again — your cards and progress are safe.
          </p>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <PageCorner />
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mx-auto mb-6">
            <LogIn className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to track your progress with spaced repetition.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" />
            Login to Review
          </Button>
        </div>
      </AppShell>
    );
  }

  // Relearn cards outlive the fetched list: a mid-session invalidation can
  // empty dueWords while a failed card is still owed its retrieval.
  if ((!dueWords || dueWords.length === 0) && !relearnPick) {
    // The other decks' counts load independently of this one, and they read as
    // 0 until they arrive — deciding now would flash "All caught up" before
    // forwarding. Wait for real numbers first.
    if (session.isLoading) {
      return (
        <AppShell compact>
          <LoadingPanel variant="page" />
        </AppShell>
      );
    }

    // "/review" is the single entry point for the daily session, so arriving
    // with no curriculum cards shouldn't dead-end on "All caught up" while
    // other decks have work waiting — forward straight into the next one.
    // Only on arrival: if cards were rated here, show the completion state
    // first and let the learner choose to continue.
    const brandNew = !!stats && stats.learnedCount === 0 && stats.masteredCount === 0;
    const forwardTo = sessionCount === 0 ? session.nextDeck("curriculum") : null;
    if (forwardTo) {
      return <Navigate to={forwardTo.route} replace />;
    }

    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <PageCorner />
          <div className="flex items-center gap-2">
            <ReviewStyleSwitch />
            <button
              onClick={handleToggleMix}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mixAll
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
              Mix All
            </button>
            {sessionCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{sessionCount}</span>
              </div>
            )}
          </div>
        </div>

        <SessionHandoff
          deckId="curriculum"
          session={session}
          reviewed={sessionCount}
          // A brand-new learner has reviewed nothing: "you've reviewed all
          // your words" was a lie, and "Back to Topics" went home. Point them
          // at learning their first words instead.
          heading={brandNew ? "Nothing to review yet" : undefined}
          message={
            brandNew
              ? "Words you learn in lessons come back here on the day you'd be about to forget them."
              : `You've reviewed all your due ${mixAll ? "" : `${activeDialect} `}curriculum words.`
          }
          fallbackLabel={brandNew ? "Learn your first words" : "Go Home"}
          fallbackRoute={brandNew ? "/curriculum" : "/"}
        >
          {quiz && <QuizSessionSummary stats={quizStats} />}
          {quiz && <LightningRound words={lightningWords} pool={wordPool ?? []} />}
          {stats && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-card rounded-xl p-4 border border-border">
                <Brain className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.learnedCount}</p>
                <p className="text-xs text-muted-foreground">Learning</p>
              </div>
              <div className="bg-card rounded-xl p-4 border border-border">
                <Sparkles className="h-6 w-6 text-accent mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.masteredCount}</p>
                <p className="text-xs text-muted-foreground">Mastered</p>
              </div>
            </div>
          )}
        </SessionHandoff>
      </AppShell>
    );
  }

  // Safety: clamp index if list shrank after refetch. The list can even be
  // empty here when only a relearn card keeps the session alive.
  const safeIndex = Math.max(0, Math.min(currentIndex, (dueWords?.length ?? 0) - 1));
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
  }

  const currentWord = relearnPick?.card ?? dueWords?.[safeIndex];
  if (!currentWord) return null;

  const dialectFlag = DIALECT_FLAGS[currentWord.dialect_module || "Gulf"] || "";
  const dialectLabel = currentWord.dialect_module || "Gulf";

  // Which schedule this card is being rated against. Audio and recognition
  // share one (see scheduleDirectionFor); production has its own, so the
  // interval preview on the rating buttons must read from the matching columns
  // or it shows the learner the wrong next-review estimate.
  const isProduction = currentWord.card_type === "production";
  const isAudio = currentWord.card_type === "audio";
  const review = currentWord.review;

  const stability = (isProduction ? review?.production_ease_factor : review?.ease_factor) ?? 0;
  const difficulty = (isProduction ? review?.production_difficulty : review?.difficulty) ?? 5.0;
  const intervalDays = (isProduction ? review?.production_interval_days : review?.interval_days) ?? 0;
  const repetitions = (isProduction ? review?.production_repetitions : review?.repetitions) ?? 0;
  const elapsedDays = elapsedDaysSince(
    isProduction ? review?.production_last_reviewed_at : review?.last_reviewed_at,
  );

  // The flip card and its rating buttons, as JSX the quiz frame can fall
  // back to for a card the ladder has no question for.
  const flashcard = (
    <>
      {isAudio ? (
            <ReviewAudioCard
              wordArabic={currentWord.word_arabic}
              wordEnglish={currentWord.word_english}
              audioUrl={currentWord.audio_url}
              dialect={currentWord.dialect_module ?? activeDialect}
              showAnswer={showAnswer}
              onReveal={() => setShowAnswer(true)}
              onAudioGenerated={persistCurriculumAudio}
            />
          ) : (
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            {/* Direction label — without it, a production card looks like a
                recognition card the learner has simply failed to read. */}
            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
              {isProduction ? (
                <>
                  <PenLine className="h-3.5 w-3.5" />
                  Say it in Arabic
                </>
              ) : (
                <>
                  <BookOpen className="h-3.5 w-3.5" />
                  Recognise
                </>
              )}
            </div>
            {/* Image if available. Hidden on production cards — a picture of the
                answer turns recall into recognition. */}
            {!isProduction && currentWord.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
                <img
                  src={currentWord.image_url}
                  alt=""
                  className="w-full h-full object-contain"
                  style={currentWord.image_position ? {
                    objectPosition: currentWord.image_position.replace(' ', '% ') + '%',
                  } : undefined}
                />
              </div>
            )}
            {/* Generate image button. Production cards don't show an image, so
                there's nothing to generate from here. */}
            {!isProduction && canEditCurriculumImages && (
              <div className="mb-6 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImageDialogOpen(true)}
                  className="gap-1.5 text-muted-foreground"
                >
                  <ImagePlus className="h-4 w-4" />
                  {currentWord.image_url ? "Regenerate Image" : "Generate Image"}
                </Button>
              </div>
            )}

            {isProduction ? (
              /* Prompt in English; the Arabic is what the learner has to
                 produce, so it stays hidden until they've committed. */
              <p className="text-3xl font-bold text-foreground mb-6 break-words max-w-full">
                {currentWord.word_english}
              </p>
            ) : (
              <p
                className="text-4xl font-bold text-foreground mb-6 break-words max-w-full"
                style={{ fontFamily: "var(--font-naskh)" }}
                dir="rtl"
              >
                {currentWord.word_arabic}
              </p>
            )}

            {/* Audio button. Never before the answer on a production card — it
                would simply read out the answer. */}
            <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
              {currentWord.audio_url && (!isProduction || showAnswer) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  Word
                </Button>
              )}

              {/* Jingle: a sung mnemonic in the word's own dialect. Held to the
                  same reveal rule as the audio — the lyrics contain the word. */}
              {(!isProduction || showAnswer) && (
                review?.jingle_audio_url ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => playJingle(review.jingle_audio_url!)}
                      className="gap-1.5"
                    >
                      <Play className="h-4 w-4" />
                      Play jingle
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={jingleLoading}
                      onClick={() => generateJingle(currentWord, true)}
                      className="gap-1.5 text-muted-foreground"
                    >
                      {jingleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Regenerate
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={jingleLoading}
                    onClick={() => generateJingle(currentWord)}
                    className="gap-1.5"
                  >
                    {jingleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Music className="h-4 w-4" />
                    )}
                    {jingleLoading ? "Creating jingle…" : "Create jingle"}
                  </Button>
                )
              )}
            </div>

            {/* Lyrics of the generated jingle, tappable like everywhere else. */}
            {review?.jingle_audio_url && review?.jingle_lyrics && (!isProduction || showAnswer) && (
              <div className="mb-6">
                {showLyrics ? (
                  <div className="rounded-lg bg-muted/40 border border-border p-3 text-left animate-in fade-in duration-200 max-w-md mx-auto">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Jingle lyrics
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowLyrics(false)}
                        className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                      >
                        Hide
                      </button>
                    </div>
                    <div
                      className="text-sm leading-relaxed space-y-1"
                      dir="rtl"
                      style={{ fontFamily: "var(--font-naskh)" }}
                    >
                      {review.jingle_lyrics.split(/\r?\n/).map((line, i) =>
                        line.trim() ? (
                          <TappableArabicText key={i} text={line} source="jingle-lyrics" />
                        ) : (
                          <div key={i} className="h-2" />
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLyrics(true)}
                    className="gap-1.5 text-muted-foreground text-xs"
                  >
                    Show lyrics
                  </Button>
                )}
              </div>
            )}


            {/* Pronunciation practice. Same reasoning: on a production card the
                learner must recall the word before being scored saying it. */}
            {(!isProduction || showAnswer) && (
              <div className="mb-6">
                <PronunciationButton word={currentWord.word_arabic} />
              </div>
            )}

            {/* Reveal the other side */}
            {showAnswer && (
              <div className="animate-in fade-in duration-200 mb-4">
                {isProduction ? (
                  <p
                    className="text-3xl font-bold text-foreground break-words"
                    style={{ fontFamily: "var(--font-naskh)" }}
                    dir="rtl"
                  >
                    {currentWord.word_arabic}
                  </p>
                ) : (
                  <p className="text-xl text-muted-foreground">{currentWord.word_english}</p>
                )}
                {/* Only after the reveal. On a production card the Arabic is
                    the answer, and a root shown alongside the English prompt
                    would hand over most of it. */}
                <RootChip root={currentWord.root} className="mt-2" />
                <div className="mt-3 flex justify-center">
                  <AskAISentence
                    arabic={currentWord.word_arabic}
                    english={currentWord.word_english}
                    variant="chip"
                  />
                </div>
              </div>
            )}
            {!showAnswer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Eye className="h-4 w-4" />
                {isProduction ? "Reveal Arabic" : "Reveal English"}
              </Button>
            )}
          </div>
          )}
    </>
  );

  // Rating waits for the reveal. Grading before checking the answer is a
  // judgment-of-learning, which runs overconfident — every inflated "Good"
  // writes a too-long interval. The keyboard path has always gated this way
  // (flip first, then rate); the buttons match.
  const ratingButtons = (
    <div className="mt-10">
      <RatingButtons
        onRate={(rating) => handleRate(rating)}
        stability={stability}
        difficulty={difficulty}
        intervalDays={intervalDays}
        repetitions={repetitions}
        elapsedDays={elapsedDays}
        disabled={!showAnswer}
        // Tapping a rating before the reveal flips the card instead of
        // doing nothing at all.
        onBlocked={handleFlip}
      />
    </div>
  );

  // The card as the quiz sees it: one direction, one memory state, and the
  // authored sentence to cut a gap from. The id carries the direction so a
  // word served both ways in one session is two distinct questions.
  const quizItem: QuizItem = {
    id: `${currentWord.id}:${currentWord.card_type}`,
    arabic: currentWord.word_arabic,
    english: currentWord.word_english,
    transliteration: currentWord.transliteration ?? null,
    audioUrl: currentWord.audio_url,
    imageUrl: currentWord.image_url,
    sentence: currentWord.example_arabic
      ? { arabic: currentWord.example_arabic, english: currentWord.example_english ?? null }
      : null,
    // The lesson's dialogue for "answer the line", topped up with the other
    // lessons' lines in the deck so a short dialogue still has wrong replies.
    dialogue: currentWord.dialogue,
    extraDialogueLines: (dueWords ?? [])
      .filter((w) => w.lesson_id !== currentWord.lesson_id)
      .flatMap((w) => asDialogue(w.dialogue)),
    dialect: currentWord.dialect_module ?? activeDialect,
    // What makes it an action word, which may be shown as an animation.
    category: currentWord.category ?? null,
    direction: scheduleDirectionFor(currentWord.card_type),
    memory: { stability, repetitions },
    // The session's first card, when it is the boss: asked as a first look
    // with its memory hook and picture a tap away.
    boss: bossFor({
      answered: sessionCount,
      position: safeIndex,
      relearn: !!relearnPick,
      tracking: leechTrackingEnabled,
      card: {
        isLeech: !!review?.is_leech,
        lapses: (review?.lapses ?? 0) + (review?.production_lapses ?? 0),
        direction: scheduleDirectionFor(currentWord.card_type),
        mnemonic: review?.mnemonic,
        pictureUrl: review?.mnemonic_image_url,
      },
    }),
  };
  // Rescue for a leech: below the card. In the quiz the frame places it, and
  // under the boss holds it back until the answer (it prints the hook).
  const leechPanel =
    leechTrackingEnabled && review?.is_leech && review?.id ? (
      <LeechHelperPanel
        kind="curriculum"
        rowId={review.id}
        arabic={currentWord.word_arabic}
        english={currentWord.word_english}
        dialect={currentWord.dialect_module ?? activeDialect}
        mnemonic={review.mnemonic ?? null}
        mnemonicImageUrl={review.mnemonic_image_url ?? null}
        deckKeys={[["due-words"]]}
      />
    ) : null;

  const quizPool =
    wordPool && wordPool.length > 0
      ? wordPool
      : (dueWords ?? []).map((w) => ({
          arabic: w.word_arabic,
          english: w.word_english,
          imageUrl: w.image_url,
          audioUrl: w.audio_url,
          dialect: w.dialect_module ?? activeDialect,
        }));

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        <div className="flex items-center gap-2">
          <ReviewStyleSwitch />
          <button
            onClick={handleToggleMix}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              mixAll
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            Mix All
          </button>
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">
              {currentWord.topic?.name || 'Review'}
            </span>
          </div>
          {pendingCount > 0 && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                isOnline
                  ? "bg-card border-border text-muted-foreground"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
              }`}
              title={isOnline ? "Saving ratings…" : "Offline — will retry when reconnected"}
            >
              {isOnline ? (
                <CloudUpload className={`h-3.5 w-3.5 ${isFlushing ? "animate-pulse" : ""}`} />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {isOnline ? `Saving ${pendingCount}` : `${pendingCount} pending`}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>

        </div>
      </div>

      {/* Dialect tag */}
      {mixAll && (
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {dialectFlag} {dialectLabel}
          </span>
        </div>
      )}

      {/* Progress bar */}
      <SessionProgress
        deckId="curriculum"
        session={session}
        position={safeIndex + 1}
        total={dueWords?.length ?? 0}
      />

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          {quiz ? (
            <QuizCardFrame
              // One mount per presentation: a failed card on a short deck is
              // re-served at once under the same id, and must be asked afresh
              // rather than shown already answered with its old rating.
              key={`${quizItem.id}:${sessionCount}`}
              item={quizItem}
              pool={quizPool}
              ready={!poolLoading}
              combo={quizStats.combo}
              onGraded={handleQuizGraded}
              leechPanel={leechPanel}
              // A curriculum word with no picture on its row is shown the
              // shared store's, if one is filed. Read only: a learner cannot
              // write `vocabulary_words`, and the rows are filled by
              // scripts/curriculum-pictures.ts.
              sharedPictures
              // A word its lesson's dialogue never uses is asked its reply
              // steps from the store's exchange, written for it on a miss.
              // That needs no row write, so the curriculum deck may ask too;
              // it is charged to this learner's dialogue allowance, once per
              // word for every learner after them.
              storedDialogues
              // An action word (a verb by its authored category) is shown its
              // clip on "say it" and the picture question, if the store has
              // one. Read only: clips are made by
              // scripts/curriculum-animations.ts, never on a learner's miss.
              animations
              // A mature word is asked in a story: its passage from the store,
              // found in a published story on a miss or written for it, either
              // way on this learner's dialogue allowance.
              storyLines
              renderFlashcard={() => (
                <>
                  {flashcard}
                  {ratingButtons}
                </>
              )}
            />
          ) : (
            flashcard
          )}

          {/* Rescue for a card the learner keeps failing. The personal decks
              have had this since leech tracking landed; the curriculum deck —
              the one the app hands every learner — had nothing. */}
          {/* In the quiz the frame shows it, under the card: there it waits
              for the boss's answer, since it prints the memory hook. */}
          {!quiz && leechPanel}
        </div>

        {/* In the quiz style the app has rated; the buttons only return when
            the ladder has no question for a card and the flip card stands in. */}
        {!quiz && ratingButtons}
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          const { data, error } = await supabase
            .from("vocabulary_words")
            .update({ image_url: imageUrl })
            .eq("id", wordId)
            .select("id");
          if (error) throw error;
          if (!data || data.length === 0) {
            throw new Error("The image was generated but could not be saved to this word.");
          }
          refetch();
        }}
      />
    </AppShell>
  );
};

export default Review;
