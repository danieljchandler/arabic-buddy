import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTopic } from "@/hooks/useTopic";
import { useAllWords } from "@/hooks/useAllWords";
import {
  advance,
  currentWordIndex,
  resumeAt,
  startBlock,
  wordsCompleted,
  type LessonFlowState,
} from "@/lib/lessonFlow";
import { useAuth } from "@/hooks/useAuth";
import { useSubmitReview, type WordReview } from "@/hooks/useReview";
import { toast } from "@/hooks/use-toast";
import { IntroCard } from "@/components/learn/IntroCard";
import { QuizCard } from "@/components/learn/QuizCard";
import { ProgressDots } from "@/components/ProgressDots";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";
import { Loader2, Trophy, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SaduMark } from "@/components/brand/SaduMark";
import { recordContinue, clearContinue } from "@/lib/continueProgress";
import { useDialect } from "@/contexts/DialectContext";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { SoundSpotlight } from "@/components/learn/SoundSpotlight";
import { LessonPlanSection } from "@/components/learn/LessonPlanSection";
import { useLessonProgressFor, useUpsertLessonProgress } from "@/hooks/useLessonProgress";
import { ListChecks, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";

type Phase = "intro" | "quiz";

const BATCH_SIZE = 5;

const Learn = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const submitReview = useSubmitReview();
  const { activeDialect } = useDialect();

  // Mixed mode: no lessonId, fetch all words shuffled
  const isMixedMode = !lessonId;
  const { data: topic, isLoading: topicLoading, error: topicError } = useTopic(lessonId);
  const { data: allWords, isLoading: allWordsLoading, error: allWordsError } = useAllWords(true);

  const isLoading = isMixedMode ? allWordsLoading : topicLoading;
  const error = isMixedMode ? allWordsError : topicError;

  // In mixed mode, take a batch of words
  const words = useMemo(() => {
    if (isMixedMode) {
      return (allWords || []).slice(0, BATCH_SIZE);
    }
    return topic?.words || [];
  }, [isMixedMode, allWords, topic?.words]);

  // Build topic label map for mixed mode
  const topicLabelMap = useMemo(() => {
    if (!isMixedMode || !allWords) return new Map<string, string>();
    return new Map(allWords.map(w => [w.id, w.topic_name]));
  }, [isMixedMode, allWords]);
  
  // Words are met in blocks and then tested as a block, in a different order —
  // see lib/lessonFlow for why one-word-at-a-time was not retrieval practice.
  // `flow` is the whole position; the word on screen and the phase derive from
  // it, so the two can never disagree.
  const [flow, setFlow] = useState<LessonFlowState>(() => startBlock(0, 0));
  const currentIndex = currentWordIndex(flow, words.length);
  const phase: Phase = flow.phase;
  /** Words actually answered — what progress is saved and drawn from. */
  const completed = wordsCompleted(flow, words.length);
  const [sessionResults, setSessionResults] = useState({ correct: 0, total: 0 });
  const [isComplete, setIsComplete] = useState(false);

  usePageAiContext(
    useMemo(() => {
      const word = words[currentIndex];
      if (!word) return null;
      return {
        kind: "word" as const,
        title: isMixedMode ? "Mixed review lesson" : (topic?.name ?? "Lesson"),
        summary: `Learning ${activeDialect} Arabic vocabulary — each word is introduced, then quizzed.`,
        content: `Current word: ${word.word_arabic} — ${word.word_english}`,
      };
    }, [words, currentIndex, isMixedMode, topic?.name, activeDialect]),
  );

  const {
    data: savedProgress,
    isSuccess: progressLoaded,
    isFetching: progressFetching,
  } = useLessonProgressFor(isMixedMode ? undefined : lessonId);
  // Settled *and* successful. isFetched would also be true after an error and
  // for a stale cached value mid-refetch, which would let the resume lock in on
  // the wrong position and then ignore the real one.
  const progressSettled = progressLoaded && !progressFetching;
  const upsertProgress = useUpsertLessonProgress();
  // Resume once per lesson, not on every progress refetch — otherwise saving
  // progress would immediately yank the learner back to the saved index.
  const [hasResumed, setHasResumed] = useState(false);
  // Full review rows, not a narrow snapshot. A narrow select here (no
  // `lapses`, `difficulty`, `production_next_review_at`) fed buildReviewUpdate
  // defaults for fields the row really had: a wrong quiz answer overwrote a
  // real lapse count with 1 (un-flagging leeches), difficulty reset to 5.0,
  // and every good/easy answer yanked a scheduled production review to "due
  // now" because the unlock check saw undefined.
  const [userReviews, setUserReviews] = useState<Map<string, WordReview>>(new Map());

  // Fetch existing reviews for SRS integration
  useEffect(() => {
    if (user && words.length > 0) {
      const fetchReviews = async () => {
        const wordIds = words.map(w => w.id);
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('*')
          .eq('user_id', user.id)
          .in('word_id', wordIds);
        if (reviews) {
          setUserReviews(new Map(reviews.map(r => [r.word_id, r as unknown as WordReview])));
        }
      };
      fetchReviews();
    }
  }, [user, words]);

  // Reset when topic changes
  useEffect(() => {
    setFlow(startBlock(0, words.length));
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
    setHasResumed(false);
    // Deliberately keyed on the lesson only: re-running this when the word
    // list settles would reshuffle the block out from under the learner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // The flow is built from the word count, which is 0 until the lesson loads —
  // so open the first block properly once the words arrive (this is also the
  // only initialisation mixed mode gets, having no saved progress to resume).
  useEffect(() => {
    if (words.length === 0) return;
    setFlow((prev) => (prev.quizOrder.length === 0 ? startBlock(0, words.length) : prev));
  }, [words.length]);

  // Pick up where the learner left off, on whatever device they left off on.
  //
  // Gated on the query having settled rather than on `savedProgress` being
  // truthy. A learner starting a lesson fresh has no row, so a truthiness guard
  // would leave this armed — and the first save's refetch would then fire it
  // and yank them back to the saved index mid-session.
  useEffect(() => {
    if (hasResumed || isMixedMode || words.length === 0 || !progressSettled) return;
    setHasResumed(true);
    if (!savedProgress || savedProgress.status === "completed") return;
    // Snapped back to the start of that word's block: resuming mid-block would
    // quiz the learner on words this sitting never introduced.
    const resumed = resumeAt(savedProgress.last_word_index, words.length);
    if (resumed.blockStart > 0) setFlow(resumed);
  }, [hasResumed, isMixedMode, progressSettled, savedProgress, words.length]);

  // Record "continue where you left off". localStorage stays as the fast local
  // path (it works signed-out and makes the Home card instant); lesson_progress
  // below is the durable one that survives a device change.
  useEffect(() => {
    if (isMixedMode || !lessonId || !topic || words.length === 0) return;
    if (isComplete) {
      clearContinue();
      return;
    }
    recordContinue({
      kind: "lesson",
      route: `/learn/${lessonId}`,
      title: topic.name || "Lesson",
      subtitle: `Word ${Math.min(completed + 1, words.length)} of ${words.length}`,
      dialect: activeDialect,
    });
  }, [isMixedMode, lessonId, topic, words.length, completed, isComplete, activeDialect]);

  // Server-side progress: how far through, and whether it's finished. Mixed mode
  // isn't a lesson, so it has nothing to record against.
  useEffect(() => {
    if (isMixedMode || !lessonId || !user || words.length === 0 || isComplete) return;
    // Never write before the resume attempt has run for THIS lesson. On mount
    // the flow starts at 0, so an early write would persist 0 and destroy the
    // saved position the learner was about to be restored to. `hasResumed` is
    // reset on every lessonId change, so it's a per-lesson readiness token.
    if (!hasResumed) return;
    // Answered words, not the word on screen: during a block's quiz the
    // pointer jumps around the block, and saving it would resume the learner
    // mid-block — past introductions they would then be quizzed on.
    upsertProgress.mutate({
      lessonId,
      lastWordIndex: completed,
      wordsSeen: completed,
      wordsTotal: words.length,
    });
    // Deliberately keyed on the count only: this should fire once per answered
    // word, not on every render or mutation-identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMixedMode, lessonId, user?.id, completed, words.length, isComplete]);

  /** Next step: the rest of the block's introductions, then its quiz. */
  const handleIntroContinue = () => {
    const next = advance(flow, words.length);
    if (next) setFlow(next);
  };

  const handleQuizAnswer = async (isCorrect: boolean) => {
    const currentWord = words[currentIndex];

    setSessionResults(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1
    }));

    if (isAuthenticated && user) {
      const existingReview = userReviews.get(currentWord.id);
      try {
        const { review } = await submitReview.mutateAsync({
          wordId: currentWord.id,
          rating: isCorrect ? "good" : "again",
          currentReview: existingReview ?? null,
        });
        // Keep the session snapshot current. Without this, a word first rated
        // this session ("Practice Again" replays included) still looked
        // review-less, took the INSERT branch again, and died on the
        // (user_id, word_id) unique constraint — every replay rating was
        // silently discarded into the console.
        if (review) {
          setUserReviews(prev => new Map(prev).set(currentWord.id, review));
        }
      } catch (err) {
        console.error("Failed to submit review:", err);
        toast({
          title: "Rating not saved",
          description: "This answer couldn't be recorded — it won't count toward the word's schedule.",
          variant: "destructive",
        });
      }
    }

    setTimeout(() => {
      const next = advance(flow, words.length);
      if (next) {
        setFlow(next);
      } else {
        setIsComplete(true);
        // Score from the freshly-updated tallies, not from `sessionResults`,
        // which this render still sees at its pre-answer value.
        if (!isMixedMode && lessonId && user) {
          const correct = sessionResults.correct + (isCorrect ? 1 : 0);
          const total = sessionResults.total + 1;
          upsertProgress.mutate({
            lessonId,
            completed: true,
            wordsSeen: words.length,
            wordsTotal: words.length,
            score: total > 0 ? Math.round((correct / total) * 100) : 0,
          });
        }
      }
    }, 500);
  };

  const handleRestartSession = () => {
    setFlow(startBlock(0, words.length));
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
    // Already resumed once this visit; a deliberate restart starts at the top.
    setHasResumed(true);
  };

  if (isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || (!isMixedMode && !topic)) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-4">
              {isMixedMode ? "Error loading words" : "Topic not found"}
            </p>
            <Button onClick={() => navigate("/")}>Go Home</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (words.length === 0) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <PageCorner />
        </div>
        {/* Two different absences, so two different plates: having seen every
            word there is is the reward state, and a lesson that carries no
            vocabulary is a dead end you leave by picking another. */}
        <EmptyState
          art={isMixedMode ? "caught-up" : "no-lessons"}
          title={isMixedMode ? "No new words" : "No words yet"}
          body={
            isMixedMode
              ? "You've seen all available words. Try reviewing!"
              // Learners have no admin panel — this lesson simply has no
              // vocabulary yet, and the path forward is another lesson.
              : "This lesson has no vocabulary yet — pick another from the curriculum."
          }
          action={
            <Button onClick={() => navigate(isMixedMode ? "/review" : "/curriculum")}>
              {isMixedMode ? "Review your words" : "Browse the curriculum"}
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Session complete screen
  if (isComplete) {
    const percentage = Math.round((sessionResults.correct / sessionResults.total) * 100);
    const isGreatScore = percentage >= 80;

    return (
      <AppShell compact>
        <div className="mb-6">
          <PageCorner />
        </div>

        <div className="text-center max-w-sm mx-auto py-8">
          <Trophy className={cn(
            "h-16 w-16 mx-auto mb-6",
            isGreatScore ? "text-primary" : "text-muted-foreground"
          )} />

          <h1 className="text-2xl font-bold text-foreground mb-2">
            {isGreatScore ? "Excellent work!" : "Good effort"}
          </h1>
          <p className="text-muted-foreground mb-8">
            {isGreatScore ? "أحسنت — You're making great progress" : "Keep practicing to improve"}
          </p>

          <div className="p-6 rounded-xl mb-8 bg-card border border-border">
            <span className="text-4xl font-bold text-foreground">{percentage}%</span>
            <p className="text-muted-foreground mt-2">
              {sessionResults.correct} / {sessionResults.total} correct
            </p>
          </div>

          {/* Authored "take it outside the app" tasks. Renders only when the
              lesson was imported with a real-world prompts sheet. */}
          {!isMixedMode && (topic?.realWorldPrompts?.length ?? 0) > 0 && (
            <div className="mb-8 text-left">
              <LessonPlanSection
                title="Try this today"
                icon={Sparkles}
                rows={topic!.realWorldPrompts}
                defaultOpen
                blurb="Use what you just learned somewhere real."
              />
            </div>
          )}

          <div className="space-y-3">
            <Button onClick={handleRestartSession} className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              {isMixedMode ? "Learn More Words" : "Practice Again"}
            </Button>
            {!isMixedMode && (
              <Button variant="outline" onClick={() => navigate("/curriculum")} className="w-full">
                Back to Curriculum
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/")} className="w-full">
              Back Home
            </Button>
          </div>

          {!isAuthenticated && (
            <p className="mt-6 text-sm text-muted-foreground">
              <Link to="/auth" className="text-primary hover:underline">Login</Link> to save your progress
            </p>
          )}
        </div>
      </AppShell>
    );
  }

  const currentWord = words[currentIndex];
  const otherWords = words.filter(w => w.id !== currentWord.id);
  const topicLabel = isMixedMode ? topicLabelMap.get(currentWord.id) : undefined;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        
        <Link to="/" className="flex items-center">
          <SaduMark title="Hakiya" variant="clear" className="h-8 w-8" />
        </Link>
        
        <div className="w-11" />
      </div>

      {/* Phase indicator */}
      <div className="flex justify-center gap-2 mb-6">
        <div className={cn(
          "px-3 py-1 rounded-full text-xs font-medium transition-all",
          phase === "intro" 
            ? "bg-primary/10 text-primary" 
            : "text-muted-foreground"
        )}>
          Learn
        </div>
        <div className={cn(
          "px-3 py-1 rounded-full text-xs font-medium transition-all",
          phase === "quiz" 
            ? "bg-primary/10 text-primary" 
            : "text-muted-foreground"
        )}>
          Quiz
        </div>
      </div>

      {/* The authored lesson plan. Both sections were parsed by the importer,
          dropped at insert, and rendered nowhere until now; they're empty for
          lessons imported before that was fixed, and empty sections render
          nothing. Shown on the first card only, so they introduce the lesson
          rather than interrupting it. */}
      {!isMixedMode && currentIndex === 0 && phase === "intro" && (
        <div className="mb-4 space-y-3">
          <SoundSpotlight entries={topic?.soundSpotlight ?? []} />
          <LessonPlanSection
            title="What's in this lesson"
            icon={ListChecks}
            rows={topic?.lessonSequence ?? []}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="py-4">
        {/* Keyed by word: a block now shows several introductions (and then
            several quiz cards) back to back without an unmount in between, so
            without this the next card would inherit the previous one's state —
            an already-revealed Arabic, or a spent quiz still showing its
            result with its options disabled. */}
        {phase === "intro" ? (
          <IntroCard 
            key={currentWord.id}
            word={currentWord} 
            gradient={isMixedMode ? undefined : topic?.gradient} 
            onContinue={handleIntroContinue}
            nextIsQuiz={advance(flow, words.length)?.phase === "quiz"}
            topicLabel={topicLabel}
          />
        ) : (
          <QuizCard 
            key={currentWord.id}
            word={currentWord} 
            otherWords={otherWords} 
            gradient={isMixedMode ? undefined : topic?.gradient} 
            onAnswer={handleQuizAnswer}
            topicLabel={topicLabel}
          />
        )}
      </div>

      {/* Progress */}
      <div className="mt-8">
        {/* Progress is words *answered*, so it only ever moves forward. The
            card pointer jumps around inside a block during its quiz, and dots
            that jumped back with it would read as a bug. */}
        <ProgressDots 
          total={words.length} 
          current={Math.min(completed, Math.max(0, words.length - 1))} 
          gradient={isMixedMode ? undefined : topic?.gradient} 
        />
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {completed} / {words.length} learned
        </p>
      </div>
    </AppShell>
  );
};

export default Learn;
