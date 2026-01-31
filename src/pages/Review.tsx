import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDueWords, useReviewStats, useSubmitReview } from "@/hooks/useReview";
import { ReviewCard } from "@/components/review/ReviewCard";
import { RatingButtons } from "@/components/review/RatingButtons";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, Brain, Sparkles, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
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

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      // Don't redirect, show login prompt
    }
  }, [authLoading, isAuthenticated]);

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

    // Move to next card or refetch if at end
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Session complete - refetch to see if there are more due words
      await refetch();
      setCurrentIndex(0);
    }
  };

  // Loading state
  if (authLoading || wordsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-xl text-muted-foreground">Loading your reviews...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center p-4">
          <HomeButton />
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-6 opacity-50">🔐</div>
            <h1 className="text-2xl font-bold text-foreground mb-4">
              Login Required
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Sign in to track your progress with spaced repetition. Your learning data will be saved across all your devices.
            </p>
            <Button
              onClick={() => navigate("/auth")}
              className="h-12 px-8 text-base font-semibold rounded-xl bg-primary"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Login to Review
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // No due words
  if (!dueWords || dueWords.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between p-4">
          <HomeButton />
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-card shadow-card">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">{sessionCount} reviewed</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <Trophy className="h-16 w-16 mx-auto mb-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground mb-4">
              All Caught Up
            </h1>
            <p className="text-lg text-muted-foreground mb-6">
              You've reviewed all your due words. Great job! Come back later for more practice.
            </p>
            
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-card rounded-xl p-4 shadow-card">
                  <Brain className="h-8 w-8 text-primary mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.learnedCount}</p>
                  <p className="text-sm text-muted-foreground">Learning</p>
                </div>
                <div className="bg-card rounded-xl p-4 shadow-card">
                  <Sparkles className="h-8 w-8 text-accent mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.masteredCount}</p>
                  <p className="text-sm text-muted-foreground">Mastered</p>
                </div>
              </div>
            )}
            
            <Button
              onClick={() => navigate("/")}
              className="h-12 px-8 text-base font-semibold rounded-xl bg-primary"
            >
              Back to Topics
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const currentWord = dueWords[currentIndex];
  const progress = ((currentIndex + 1) / dueWords.length) * 100;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <HomeButton />
        <div className="flex items-center gap-4">
          {/* Topic badge */}
          <div className={cn(
            "px-4 py-2 rounded-full",
            `bg-gradient-to-br ${currentWord.topic.gradient}`,
            "shadow-lg"
          )}>
            <span className="text-lg mr-2">{currentWord.topic.icon}</span>
            <span className="text-sm font-semibold text-white">{currentWord.topic.name}</span>
          </div>
          {/* Session count */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-card shadow-card">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center text-muted-foreground text-sm mt-2 font-medium">
          {currentIndex + 1} / {dueWords.length} due
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        {/* Review Card */}
        <div className="w-full max-w-md mb-12">
          <ReviewCard
            word={currentWord}
            gradient={currentWord.topic.gradient}
            showAnswer={showAnswer}
            onReveal={handleReveal}
          />
        </div>

        {/* Rating Buttons */}
        {showAnswer && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 w-full">
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
    </div>
  );
};

export default Review;
