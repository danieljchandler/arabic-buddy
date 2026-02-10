import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDueWords, useReviewStats, useSubmitReview } from "@/hooks/useReview";
import { ReviewCard } from "@/components/review/ReviewCard";
import { RatingButtons } from "@/components/review/RatingButtons";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, Brain, Sparkles, LogIn } from "lucide-react";
import { Rating } from "@/lib/spacedRepetition";

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: dueWords, isLoading: wordsLoading, refetch } = useDueWords();
  const { data: stats } = useReviewStats();
  const submitReview = useSubmitReview();
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  const handleReveal = () => {
    setShowAnswer(true);
  };

  const handleRate = async (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;

    const word = dueWords[currentIndex];
    
    await submitReview.mutateAsync({
      wordId: word.id,
      rating,
      currentReview: word.review,
    });

    setSessionCount(prev => prev + 1);
    setShowAnswer(false);

    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  // Loading state
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

  // Not logged in
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

  // No due words - all caught up
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
          <h1 className="text-xl font-bold text-foreground mb-3">
            All Caught Up
          </h1>
          <p className="text-muted-foreground mb-8">
            You've reviewed all your due words. Come back later for more practice.
          </p>
          
          {/* Stats */}
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
          
          <Button onClick={() => navigate("/")}>
            Back to Topics
          </Button>
        </div>
      </AppShell>
    );
  }

  const currentWord = dueWords[currentIndex];
  const progress = ((currentIndex + 1) / dueWords.length) * 100;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-3">
          {/* Topic badge - minimal */}
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">{currentWord.topic.name}</span>
          </div>
          {/* Session count */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress bar - subtle */}
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
        <div className="max-w-sm mx-auto">
          <ReviewCard
            word={currentWord}
            gradient={currentWord.topic.gradient}
            showAnswer={showAnswer}
            onReveal={handleReveal}
          />
        </div>

        {/* Rating Buttons */}
        {showAnswer && (
          <div className="mt-10 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <RatingButtons
              onRate={handleRate}
              easeFactor={currentWord.review?.ease_factor || 2.5}
              intervalDays={currentWord.review?.interval_days || 0}
              repetitions={currentWord.review?.repetitions || 0}
              disabled={submitReview.isPending}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Review;
