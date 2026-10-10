import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useDueUserPhrases, useUpdateUserPhraseReview, useDeleteUserPhrase } from "@/hooks/useUserPhrases";
import { useReviewSession } from "@/hooks/useReviewSession";
import { SessionHandoff } from "@/components/review/SessionHandoff";
import { SessionProgress } from "@/components/review/SessionProgress";
import { PageCorner } from "@/components/shell/PageCorner";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Rating, calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { useFsrsCalibration } from "@/hooks/useFsrsCalibration";
import { useFsrsWeights } from "@/hooks/useFsrsWeights";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useReviewStyle } from "@/hooks/useReviewStyle";
import { useSavedPhrasePool } from "@/hooks/useQuizPool";
import { useAddXP, useIncrementReviews, REVIEW_XP } from "@/hooks/useGamification";
import { QuizCardFrame, type QuizGraded, type QuizItem } from "@/components/review/QuizCardFrame";
import { ReviewStyleSwitch } from "@/components/review/ReviewStyleSwitch";
import { QuizSessionSummary } from "@/components/review/QuizSessionSummary";
import { LightningRound } from "@/components/review/LightningRound";
import { addLightningWord, lightningWordFor, type LightningWord } from "@/lib/lightningRound";
import { EMPTY_QUIZ_SESSION, comboBonus, recordQuizAnswer, type QuizSessionStats } from "@/lib/quizSession";
import { phraseDirection, rungForMemory } from "@/lib/quizLadder";
import { isBossTurn } from "@/lib/bossCard";
import { Loader2, Trophy, LogIn, Eye, Volume2, Trash2, MessageCircleQuestion, Music, Play, RefreshCw, Undo2, MessageSquarePlus } from "lucide-react";
import { SentencePracticeSheet } from "@/components/practice/SentencePracticeSheet";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl } from "@/lib/jingleAudio";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";


const MyPhrasesReview = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const desiredRetention = useDesiredRetention();
  const stabilityMultiplier = useFsrsCalibration();
  const { weights } = useFsrsWeights();
  const { activeDialect } = useDialect();
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  // How the learner wants to be asked. A saved phrase keeps one schedule, so
  // the ladder's direction is read off its stability: a new phrase is asked
  // for its meaning, a settled one is asked to be said.
  const { style: reviewStyle } = useReviewStyle();
  const quiz = reviewStyle === "quiz";
  // The quiz opens on the boss: the leech asked for its meaning with the
  // most lapses goes first (src/lib/bossCard.ts), while leeches are tracked.
  const { data: duePhrases, isLoading, refetch } = useDueUserPhrases(false, { bossFirst: quiz && leechTrackingEnabled });
  const session = useReviewSession();
  const updateReview = useUpdateUserPhraseReview();
  const deletePhrase = useDeleteUserPhrase();
  const { data: phrasePool, isLoading: poolLoading } = useSavedPhrasePool(activeDialect, false, quiz);
  const addXP = useAddXP();
  const incrementReviews = useIncrementReviews();
  const [quizStats, setQuizStats] = useState<QuizSessionStats>(EMPTY_QUIZ_SESSION);
  // Today's right answers at the first four steps, for the lightning round.
  const [lightningWords, setLightningWords] = useState<LightningWord<QuizItem>[]>([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [jingleLoading, setJingleLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lastAction, setLastAction] = useState<null | {
    phraseId: string;
    prevIndex: number;
    snapshot: Record<string, unknown>;
  }>(null);
  const [undoing, setUndoing] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const safeIndex =
    duePhrases && duePhrases.length > 0
      ? Math.min(currentIndex, duePhrases.length - 1)
      : 0;
  const current = duePhrases?.[safeIndex] ?? null;

  // Same contract as the word review: the Arabic stays out of the context
  // until the learner flips the card — they are mid-retrieval, and the tutor
  // handing them the phrase would grade the card for them.
  usePageAiContext(
    useMemo(() => {
      if (!current) return null;
      return {
        kind: "phrase" as const,
        title: "My Phrases review",
        summary: `Mid-review of their saved phrases (${activeDialect} dialect): the English is shown and they must produce the Arabic phrase.${
          showAnswer
            ? ""
            : " The Arabic is still hidden — coach with hints rather than volunteering it unless they ask outright."
        }`,
        content: showAnswer
          ? `${current.phrase_arabic} — ${current.phrase_english}`
          : current.phrase_english,
        meta: {
          dialect: activeDialect,
          notes:
            showAnswer && current.is_leech
              ? ["This phrase is a leech — repeatedly failed; a new angle would help."]
              : undefined,
        },
        position: { total: duePhrases?.length ?? undefined },
      };
    }, [current, showAnswer, activeDialect, duePhrases?.length]),
  );

  // Persist TTS audio on first generation so subsequent reviews reuse it
  // instead of calling the AI synthesis endpoint again.
  const persistPhraseAudio = current && user && !current.phrase_audio_url
    ? async (blob: Blob) => {
        const phraseId = current.id;
        const fileName = `tts/${user.id}/phrase-${phraseId}.mp3`;
        const { error: uploadError } = await supabase.storage
          .from("flashcard-audio")
          .upload(fileName, blob, { contentType: blob.type || "audio/mpeg", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
        const audioUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        const { error: updateError } = await (supabase.from("user_phrases") as any)
          .update({ phrase_audio_url: audioUrl })
          .eq("id", phraseId);
        if (updateError) throw updateError;
        current.phrase_audio_url = audioUrl;
      }
    : undefined;

  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: current?.phrase_arabic ?? "",
    skip: !current || Boolean(current?.phrase_audio_url),
    dialect: activeDialect,
    persist: persistPhraseAudio,
  });

  const playAudio = async (url: string, options?: { repairJingle?: boolean }) => {
    if (audioRef.current) audioRef.current.pause();
    if (options?.repairJingle) {
      try {
        const audioFile = await createPlayableJingleAudioFromUrl(url);
        const objectUrl = URL.createObjectURL(audioFile.blob);
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(objectUrl);
        audio.play().catch(() => {});
        return;
      } catch (err) {
        console.error("Jingle repair failed:", err);
        toast.error("This jingle is corrupted — tap Regenerate to replace it.");
        return;
      }
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
  };

  const generateJingle = async (regenerate = false) => {
    if (!current || !user) return;
    if (current.jingle_audio_url && !regenerate) {
      playAudio(current.jingle_audio_url, { repairJingle: true });
      return;
    }
    setJingleLoading(true);
    try {
      const response = await supabase.functions.invoke("generate-phrase-jingle", {
        body: {
          phrase_arabic: current.phrase_arabic,
          phrase_english: current.phrase_english,
          dialect: activeDialect,
        },
      });
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      const audioFile = await createPlayableJingleAudio(response.data);
      const fileName = `jingles/${user.id}/phrase-${current.id}-${Date.now()}.${audioFile.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const jingleUrl = urlData.publicUrl;
      const lyrics = (response.data as { lyrics?: string | null })?.lyrics ?? null;
      await (supabase.from("user_phrases") as any)
        .update({ jingle_audio_url: jingleUrl, jingle_lyrics: lyrics })
        .eq("id", current.id);
      current.jingle_audio_url = jingleUrl;
      current.jingle_lyrics = lyrics;
      toast.success("🎵 Jingle created — tap Play to listen.");
      setShowLyrics(true);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("429")) toast.error("Rate limited — try again shortly");
      else if (msg.includes("402")) toast.error("AI credits exhausted");
      else toast.error("Failed to generate jingle");
    } finally {
      setJingleLoading(false);
    }
  };


  // Reset reveal between cards
  useEffect(() => {
    setShowAnswer(false);
    setShowLyrics(false);
  }, [current?.id]);

  const handleRate = async (rating: Rating) => {
    if (!current || !duePhrases) return;
    const count = duePhrases.length;

    // Snapshot current SRS state so the learner can undo an accidental tap.
    const { data: snapshot } = await (supabase
      .from("user_phrases")
      .select("ease_factor, difficulty, interval_days, repetitions, next_review_at, last_reviewed_at, lapses, is_leech") as any)
      .eq("id", current.id)
      .maybeSingle();

    const result = calculateNextReview(
      rating,
      Number(current.ease_factor) || 0,
      Number(current.difficulty) || 5,
      current.interval_days,
      current.repetitions,
      elapsedDaysSince(current.last_reviewed_at),
      { desiredRetention, stabilityMultiplier, weights, fuzzSeed: current.id },
    );

    await updateReview.mutateAsync({
      phraseId: current.id,
      stability: result.stability,
      difficulty: result.difficulty,
      intervalDays: result.intervalDays,
      repetitions: result.repetitions,
      nextReviewAt: result.nextReviewAt,
      rating,
      currentLapses: current.lapses ?? 0,
    });

    const prevIndex = currentIndex;
    const newAction = snapshot
      ? {
          phraseId: current.id,
          prevIndex,
          snapshot: snapshot as Record<string, unknown>,
        }
      : null;
    if (newAction) {
      setLastAction(newAction);
    }

    setSessionCount((p) => p + 1);
    setShowAnswer(false);

    if (currentIndex < count - 1) {
      setCurrentIndex((p) => p + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }

  };

  /**
   * A quiz answer. The app rated it, so this records the session tally and
   * hands the rating down the same path a tap on the rating buttons takes.
   * A graded answer is a confirmed retrieval, so it earns the flat review XP
   * the curriculum deck pays, which this deck's flip cards never did.
   */
  const handleQuizGraded = async (graded: QuizGraded) => {
    if (!current) return;
    const result = calculateNextReview(
      graded.rating,
      Number(current.ease_factor) || 0,
      Number(current.difficulty) || 5,
      current.interval_days,
      current.repetitions,
      elapsedDaysSince(current.last_reviewed_at),
      { desiredRetention, stabilityMultiplier, weights, fuzzSeed: current.id },
    );
    const stepAfter = rungForMemory(
      { stability: result.stability, repetitions: result.repetitions },
      phraseDirection(result.stability),
    ).step;
    const next = recordQuizAnswer(quizStats, {
      correct: graded.correct,
      stepBefore: graded.step,
      stepAfter,
    });
    setQuizStats(next);
    const lightning = lightningWordFor(graded, graded.item);
    if (lightning) setLightningWords((prev) => addLightningWord(prev, lightning));
    try {
      await handleRate(graded.rating);
    } catch (err) {
      console.error("Failed to save review rating:", err);
      toast.error("Couldn't save your rating — it will come back around. Try again.");
      return;
    }
    addXP.mutate({ amount: REVIEW_XP, reason: "review" });
    incrementReviews.mutate();
    // A flourish, never a schedule: the combo pays XP and nothing else.
    const bonus = comboBonus(next.combo);
    if (bonus) addXP.mutate({ amount: bonus, reason: "quiz_combo" });
  };

  const handleUndo = async (action?: NonNullable<typeof lastAction>) => {
    const target = action ?? lastAction;
    if (!target || undoing) return;
    setUndoing(true);
    try {
      const { error } = await (supabase.from("user_phrases") as any)
        .update(target.snapshot)
        .eq("id", target.phraseId);
      if (error) throw error;
      setSessionCount((p) => Math.max(0, p - 1));
      setCurrentIndex(target.prevIndex);
      setShowAnswer(false);
      setLastAction(null);
      await refetch();
      toast.success("Rating undone");
    } catch (err) {
      console.error("Undo failed:", err);
      toast.error("Couldn't undo — try again");
    } finally {
      setUndoing(false);
    }
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false);
    if (!current) return;
    try {
      await deletePhrase.mutateAsync(current.id);
      toast.success("Phrase removed");
      await refetch();
      setCurrentIndex(0);
    } catch {
      toast.error("Failed to remove phrase");
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6"><PageCorner /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to review your saved phrases.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" /> Login
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!duePhrases || duePhrases.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <PageCorner />
          <div className="flex items-center gap-2">
            <ReviewStyleSwitch />
            {sessionCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{sessionCount}</span>
              </div>
            )}
          </div>
        </div>
        <SessionHandoff
          deckId="my-phrases"
          session={session}
          reviewed={sessionCount}
          message="No phrases due for review right now."
          fallbackLabel="Back to My Words"
          fallbackRoute="/my-words"
        >
          {quiz && <QuizSessionSummary stats={quizStats} />}
          {quiz && <LightningRound words={lightningWords} pool={phrasePool ?? []} />}
        </SessionHandoff>
      </AppShell>
    );
  }

  if (!current) return null;
  const effectiveAudio = current.phrase_audio_url || ttsUrl;

  // The flip card, as JSX the quiz frame can fall back to for a card the
  // ladder has no question for.
  const flashcard = (
          <div className="rounded-3xl bg-card border border-plum/15 p-7 text-center space-y-5 shadow-elegant">
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
              Say this in {activeDialect} Arabic
            </p>
            <p className="text-2xl font-semibold text-foreground leading-relaxed">
              {current.phrase_english}
            </p>

            {showAnswer ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4 pt-2">
                <p
                  className="text-4xl font-bold text-plum leading-snug"
                  style={{ fontFamily: "var(--font-naskh)" }}
                  dir="rtl"
                >
                  {current.phrase_arabic}
                </p>
                {current.transliteration && (
                  <p className="text-sm italic text-primary/80">{current.transliteration}</p>
                )}
                {current.notes && (
                  <p className="text-xs text-muted-foreground italic">{current.notes}</p>
                )}

                <div className="flex justify-center">
                  <AskAISentence
                    arabic={current.phrase_arabic}
                    english={current.phrase_english}
                    variant="chip"
                  />
                </div>


                {/* Circular play + secondary actions */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => effectiveAudio && playAudio(effectiveAudio)}
                    disabled={!effectiveAudio || ttsLoading}
                    aria-label="Play audio"
                    className="h-14 w-14 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-elegant transition-all hover:scale-105 active:scale-[0.98] disabled:opacity-50"
                  >
                    {ttsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <Volume2 className="h-6 w-6" />
                    )}
                  </button>

                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateJingle()}
                      disabled={jingleLoading}
                      className="gap-1.5 rounded-full"
                    >
                      {jingleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : current.jingle_audio_url ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Music className="h-4 w-4" />
                      )}
                      {jingleLoading ? "Creating..." : current.jingle_audio_url ? "Play jingle" : "Generate jingle"}
                    </Button>

                    {current.jingle_audio_url && !jingleLoading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => generateJingle(true)}
                        title="Regenerate jingle"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>

                {current.jingle_audio_url && current.jingle_lyrics && (
                  <div className="mt-2">
                    {showLyrics ? (
                      <div className="rounded-xl bg-muted/40 border border-border p-3 text-left animate-in fade-in duration-200">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Lyrics
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
                          className="text-sm leading-relaxed font-arabic space-y-1"
                          dir="rtl"
                          style={{ fontFamily: "var(--font-naskh)" }}
                        >
                          {current.jingle_lyrics.split(/\r?\n/).map((line, i) => (
                            line.trim() ? (
                              <TappableArabicText
                                key={i}
                                text={line}
                                source="jingle-lyrics"
                                sentenceContext={{ arabic: current.phrase_arabic, english: current.phrase_english }}
                              />
                            ) : (
                              <div key={i} className="h-2" />
                            )
                          ))}
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
              </div>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setShowAnswer(true);
                  if (effectiveAudio) playAudio(effectiveAudio);
                }}
                className="gap-2 w-full rounded-full border-2 border-primary/30 text-primary hover:bg-primary/8 hover:border-primary/50"
              >
                <Eye className="h-4 w-4" />
                Reveal Arabic
              </Button>
            )}
          </div>
  );

  // Self rating — waits for the reveal, same as the word decks: grading
  // before checking runs overconfident and writes too-long intervals off
  // inflated "Good"s.
  const ratingButtons = (
    <RatingButtons
      onRate={handleRate}
      stability={Number(current.ease_factor) || 0}
      difficulty={Number(current.difficulty) || 5}
      intervalDays={current.interval_days}
      repetitions={current.repetitions}
      elapsedDays={elapsedDaysSince(current.last_reviewed_at)}
      disabled={updateReview.isPending || !showAnswer}
      // A tap before the reveal shows the answer rather than reading as a
      // dead button.
      onBlocked={() => {
        if (!updateReview.isPending) setShowAnswer(true);
      }}
    />
  );

  const stability = Number(current.ease_factor) || 0;
  const quizItem: QuizItem = {
    id: current.id,
    arabic: current.phrase_arabic,
    english: current.phrase_english,
    transliteration: current.transliteration,
    audioUrl: effectiveAudio,
    dialect: current.dialect ?? activeDialect,
    direction: phraseDirection(stability),
    memory: { stability, repetitions: current.repetitions },
    // The session's first card, when it is the boss: asked as a first look
    // with its picture and its memory hook.
    boss: isBossTurn({
      answered: sessionCount,
      position: safeIndex,
      candidate: {
        isLeech: leechTrackingEnabled && !!current.is_leech,
        lapses: current.lapses ?? 0,
        direction: phraseDirection(stability),
      },
    })
      ? { lapses: current.lapses ?? 0, mnemonic: current.mnemonic ?? null, pictureUrl: current.mnemonic_image_url ?? null }
      : null,
  };
  const quizPool =
    phrasePool && phrasePool.length > 0
      ? phrasePool
      : duePhrases.map((p) => ({ arabic: p.phrase_arabic, english: p.phrase_english }));

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        <div className="flex items-center gap-2">
          <ReviewStyleSwitch />
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border flex items-center gap-1.5">
            <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium">Phrase</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <SessionProgress
        deckId="my-phrases"
        session={session}
        position={safeIndex + 1}
        total={duePhrases.length}
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
              renderFlashcard={() => (
                <>
                  {flashcard}
                  <div className="mt-8">{ratingButtons}</div>
                </>
              )}
            />
          ) : (
            flashcard
          )}


          {/* Not under the boss: the panel prints the memory hook, which the
              boss banner keeps behind a tap until the answer is in. */}
          {leechTrackingEnabled && current.is_leech && !(quiz && quizItem.boss) && (
            <LeechHelperPanel
              kind="phrase"
              rowId={current.id}
              arabic={current.phrase_arabic}
              english={current.phrase_english}
              transliteration={current.transliteration}
              dialect={activeDialect}
              mnemonic={current.mnemonic ?? null}
              mnemonicImageUrl={current.mnemonic_image_url ?? null}
              deckKeys={[["user-phrases-due"], ["user-phrases"]]}
            />
          )}

          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from list
            </Button>
          </div>
        </div>

        {/* In the quiz style the app has rated; the buttons only return when
            the ladder has no question for a card and the flip card stands in. */}
        <div className="mt-8">
          {!quiz && ratingButtons}
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPracticeOpen(true)}
              className="gap-1.5 text-muted-foreground"
              title="Practice using this phrase in a sentence"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Practice a sentence</span>
            </Button>
            {lastAction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUndo()}
                disabled={undoing}
                className="gap-1.5 text-muted-foreground"
                title="Undo last rating"
              >
                {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                <span className="text-xs font-medium">Undo</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <SentencePracticeSheet
        open={practiceOpen}
        onOpenChange={setPracticeOpen}
        targetArabic={current.phrase_arabic}
        targetEnglish={current.phrase_english}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this phrase?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the phrase from your saved list. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default MyPhrasesReview;
