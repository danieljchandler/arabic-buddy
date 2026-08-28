import { useState, useRef, useCallback, useMemo } from "react";
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
import { ReviewAudioCard } from "@/components/review/ReviewAudioCard";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { Trophy, Brain, Sparkles, LogIn, Shuffle, Eye, Volume2, ImagePlus, WifiOff, CloudUpload, PenLine, BookOpen, Music, Play, Loader2, RefreshCw } from "lucide-react";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { useReviewKeyboard } from "@/hooks/useKeyboardShortcuts";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl } from "@/lib/jingleAudio";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";



const DIALECT_FLAGS: Record<string, string> = {
  Gulf: "🇦🇪",
  Egyptian: "🇪🇬",
  Yemeni: "🇾🇪",
};

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const queryClient = useQueryClient();

  const { activeDialect } = useDialect();
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  const [mixAll, setMixAll] = useState(false);

  const { data: dueWords, isLoading: wordsLoading, isError: wordsError, refetch } = useDueWords(mixAll);
  const { data: stats } = useReviewStats(mixAll);
  const { enqueue, pendingCount, isFlushing, isOnline } = useReviewQueue();
  const session = useReviewSession(mixAll);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
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
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();

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
    enabled: (dueWords?.length ?? 0) > 0 || !!relearnPick,
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
        },
      });
      if (showCapToastIfLimited(response.error, response.data)) return;
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      const audioFile = await createPlayableJingleAudio(response.data);
      const fileName = `jingles/${user.id}/curriculum-${word.id}-${Date.now()}.${audioFile.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const jingleUrl = urlData.publicUrl;
      const lyrics = (response.data as { lyrics?: string | null })?.lyrics ?? null;
      const { error: saveError } = await supabase
        .from("word_reviews")
        .upsert(
          {
            user_id: user.id,
            word_id: word.id,
            jingle_audio_url: jingleUrl,
            jingle_lyrics: lyrics,
          } as never,
          { onConflict: "user_id,word_id" },
        );
      if (saveError) throw saveError;
      // Patch the cached queue in place rather than refetching — a refetch
      // reorders the deck under the learner mid-card.
      queryClient.setQueriesData<DueCurriculumCard[] | undefined>(
        { queryKey: ["due-words"] },
        (prev) =>
          prev?.map((c) =>
            c.id === word.id
              ? {
                  ...c,
                  review: {
                    ...(c.review ?? ({} as NonNullable<DueCurriculumCard["review"]>)),
                    jingle_audio_url: jingleUrl,
                    jingle_lyrics: lyrics,
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

  const goToNext = async () => {
    if (!dueWords) return;
    setShowAnswer(false);
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  const handleRate = (rating: Rating) => {
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
        void refetch();
        setCurrentIndex(0);
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
      // End of list: refetch (queue keeps flushing in background)
      void refetch();
      setCurrentIndex(0);
    }
  };


  const handleToggleMix = () => {
    setMixAll((prev) => !prev);
    setCurrentIndex(0);
    setSessionCount(0);
    setShowAnswer(false);
    // Switching decks starts a new session; relearn cards belong to the old one.
    setRelearn([]);
    setMainDone(false);
  };

  if (authLoading || wordsLoading) {
    return (
      <AppShell compact>
        <LoadingPanel variant="page" statusOverride="Loading your reviews…" />
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

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        <div className="flex items-center gap-2">
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
            {!isProduction && (
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
                style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
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
            </div>

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
                    style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
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

          {/* Rescue for a card the learner keeps failing. The personal decks
              have had this since leech tracking landed; the curriculum deck —
              the one the app hands every learner — had nothing. */}
          {leechTrackingEnabled && review?.is_leech && review?.id && (
            <LeechHelperPanel
              kind="curriculum"
              rowId={review.id}
              arabic={currentWord.word_arabic}
              english={currentWord.word_english}
              dialect={currentWord.dialect_module ?? activeDialect}
              mnemonic={review.mnemonic ?? null}
              invalidateKeys={[["due-words"]]}
            />
          )}
        </div>

        {/* Rating waits for the reveal. Grading before checking the answer is
            a judgment-of-learning, which runs overconfident — every inflated
            "Good" writes a too-long interval. The keyboard path has always
            gated this way (flip first, then rate); now the buttons match. */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
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
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          await supabase
            .from("vocabulary_words")
            .update({ image_url: imageUrl })
            .eq("id", wordId);
          refetch();
        }}
      />
    </AppShell>
  );
};

export default Review;
