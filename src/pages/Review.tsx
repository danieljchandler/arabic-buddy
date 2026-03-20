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
import { ReviewImageQuizCard } from "@/components/review/ReviewImageQuizCard";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { useDialect } from "@/contexts/DialectContext";
import { Loader2, Trophy, Brain, Sparkles, LogIn, Shuffle } from "lucide-react";

const DIALECT_FLAGS: Record<string, string> = {
  Gulf: "🇦🇪",
  Egyptian: "🇪🇬",
};

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const [mixAll, setMixAll] = useState(false);

  const { data: dueWords, isLoading: wordsLoading, refetch } = useDueWords(mixAll);
  const { data: allWords } = useAllVocabularyWords(mixAll);
  const { data: stats } = useReviewStats(mixAll);
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

  const handleToggleMix = () => {
    setMixAll((prev) => !prev);
    setCurrentIndex(0);
    setSessionCount(0);
  };

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

  if (!dueWords || dueWords.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
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

        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground mb-3">All Caught Up</h1>
          <p className="text-muted-foreground mb-8">
            You've reviewed all your due {mixAll ? "" : `${activeDialect} `}words. Come back later for more practice.
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
  const isNewWord = !currentWord.review || currentWord.review.repetitions === 0;
  const isFirstQuiz = currentWord.review?.repetitions === 1;
  const topicWords = allWords?.filter((w) => w.topic_id === currentWord.topic_id) ?? [];
  const fallbackWords = allWords?.filter((w) => w.topic_id !== currentWord.topic_id) ?? [];

  const dialectFlag = DIALECT_FLAGS[currentWord.dialect_module || "Gulf"] || "";
  const dialectLabel = currentWord.dialect_module || "Gulf";

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
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
              {currentWord.topic.name}
            </span>
          </div>
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
          <div className="max-w-sm mx-auto">
            <div className="mb-3 text-center flex items-center justify-center gap-2">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                New word
              </span>
              {mixAll && (
                <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                  {dialectFlag} {dialectLabel}
                </span>
              )}
            </div>
            <ReviewCard
              word={currentWord}
              gradient={currentWord.topic.gradient}
              showAnswer={true}
              onReveal={() => {}}
            />
            <div className="mt-6 mb-4">
              <PronunciationButton word={currentWord.word_arabic} />
            </div>
            <div className="mt-4 text-center">
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
        ) : isFirstQuiz ? (
          <ReviewImageQuizCard
            word={currentWord}
            topicWords={topicWords}
            fallbackWords={fallbackWords}
            onAnswer={handleQuizAnswer}
            disabled={submitReview.isPending || answerPending}
          />
        ) : (
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
