import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useDueWords,
  useReviewStats,
  useSubmitReview,
  useAllVocabularyWords,
} from "@/hooks/useReview";
import { ReviewCard } from "@/components/review/ReviewCard";
import { ReviewQuizCard } from "@/components/review/ReviewQuizCard";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, Brain, Sparkles, LogIn } from "lucide-react";

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: dueWords, isLoading: wordsLoading, refetch } = useDueWords();
  const { data: allWords } = useAllVocabularyWords();
  const { data: stats } = useReviewStats();
  const submitReview = useSubmitReview();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [answerPending, setAnswerPending] = useState(false);

  const goToNext = async () => {
    if (!dueWords) return;
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  /** First-time learn: user taps "Got it" → record as 'good' and advance.
   *  Always counts as a session point since the user has engaged with the word. */
  const handleLearnContinue = async () => {
    if (!dueWords || !dueWords[currentIndex]) return;
    const word = dueWords[currentIndex];
    await submitReview.mutateAsync({
      wordId: word.id,
      rating: "good",
      currentReview: word.review,
    });
    setSessionCount((prev) => prev + 1);
    goToNext();
  };

  /** Quiz answer: correct → 'good', wrong → 'again'.
   *  Session count only increments for correct answers in quiz mode. */
  const handleQuizAnswer = (correct: boolean) => {
    if (!dueWords || !dueWords[currentIndex] || answerPending) return;
    setAnswerPending(true);
    const word = dueWords[currentIndex];
    setTimeout(async () => {
      await submitReview.mutateAsync({
        wordId: word.id,
        rating: correct ? "good" : "again",
        currentReview: word.review,
      });
      if (correct) setSessionCount((prev) => prev + 1);
      setAnswerPending(false);
      goToNext();
    }, 1500);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authLoading || wordsLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your reviews...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Not logged in ────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mx-auto mb-6">
            <LogIn className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-3">
            Login Required
          </h1>
          <p className="text-muted-foreground mb-8">
            Sign in to track your progress with spaced repetition.
          </p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" />
            Login to Review
          </Button>
        </div>
      </AppShell>
    );
  }

  // ── All caught up ────────────────────────────────────────────────────────
  if (!dueWords || dueWords.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          {sessionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{sessionCount}</span>
            </div>
          )}
        </div>

        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground mb-3">All Caught Up</h1>
          <p className="text-muted-foreground mb-8">
            You've reviewed all your due words. Come back later for more practice.
          </p>

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

          <Button onClick={() => navigate("/")}>Back to Topics</Button>
        </div>
      </AppShell>
    );
  }

  const currentWord = dueWords[currentIndex];
  const progress = ((currentIndex + 1) / dueWords.length) * 100;

  // A word is "new" (learn mode) when it has never been successfully reviewed.
  const isNewWord = !currentWord.review || currentWord.review.repetitions === 0;

  // Words from the same topic used as multiple-choice distractors.
  const topicWords =
    allWords?.filter((w) => w.topic_id === currentWord.topic_id) ?? [];

  // Words from other topics used as distractor fallback when the topic is small.
  const fallbackWords =
    allWords?.filter((w) => w.topic_id !== currentWord.topic_id) ?? [];

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">
              {currentWord.topic.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {currentIndex + 1} / {dueWords.length} due
        </p>
      </div>

      {/* Main Content */}
      <div className="py-4">
        {isNewWord ? (
          /* ── LEARN MODE: first introduction ──────────────────────────── */
          <div className="max-w-sm mx-auto">
            <div className="mb-3 text-center">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                New word
              </span>
            </div>
            <ReviewCard
              word={currentWord}
              gradient={currentWord.topic.gradient}
              showAnswer={true}
              onReveal={() => {}}
            />
            <div className="mt-8 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Take a moment to learn this word, then continue.
              </p>
              <Button
                onClick={handleLearnContinue}
                disabled={submitReview.isPending}
                className="w-full max-w-xs"
              >
                Got it — continue →
              </Button>
            </div>
          </div>
        ) : (
          /* ── QUIZ MODE: multiple-choice review ───────────────────────── */
          <ReviewQuizCard
            word={currentWord}
            topicWords={topicWords}
            fallbackWords={fallbackWords}
            onAnswer={handleQuizAnswer}
            disabled={submitReview.isPending || answerPending}
          />
        )}
      </div>
    </AppShell>
  );
};

export default Review;
