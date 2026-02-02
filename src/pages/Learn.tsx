import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTopic } from "@/hooks/useTopic";
import { useAuth } from "@/hooks/useAuth";
import { useSubmitReview } from "@/hooks/useReview";
import { IntroCard } from "@/components/learn/IntroCard";
import { QuizCard } from "@/components/learn/QuizCard";
import { ProgressDots } from "@/components/ProgressDots";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";
import { Loader2, Trophy, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import lahjaLogo from "@/assets/lahja-logo.png";

type Phase = "intro" | "quiz";

const Learn = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const submitReview = useSubmitReview();
  const { data: topic, isLoading, error } = useTopic(topicId);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionResults, setSessionResults] = useState({ correct: 0, total: 0 });
  const [isComplete, setIsComplete] = useState(false);
  const [userReviews, setUserReviews] = useState<Map<string, { id: string }>>(new Map());

  // Fetch existing reviews for SRS integration
  useEffect(() => {
    if (user && topic?.words) {
      const fetchReviews = async () => {
        const wordIds = topic.words.map(w => w.id);
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('id, word_id')
          .eq('user_id', user.id)
          .in('word_id', wordIds);
        if (reviews) {
          const reviewMap = new Map(reviews.map(r => [r.word_id, { id: r.id }]));
          setUserReviews(reviewMap);
        }
      };
      fetchReviews();
    }
  }, [user, topic?.words]);

  // Reset when topic changes
  useEffect(() => {
    setCurrentIndex(0);
    setPhase("intro");
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
  }, [topicId]);

  const handleContinueToQuiz = () => {
    setPhase("quiz");
  };

  const handleQuizAnswer = async (isCorrect: boolean) => {
    if (!topic) return;
    const currentWord = topic.words[currentIndex];

    setSessionResults(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1
    }));

    if (isAuthenticated && user) {
      const existingReview = userReviews.get(currentWord.id);
      try {
        await submitReview.mutateAsync({
          wordId: currentWord.id,
          rating: isCorrect ? "good" : "again",
          currentReview: existingReview ? {
            id: existingReview.id,
            user_id: user.id,
            word_id: currentWord.id,
            ease_factor: 2.5,
            interval_days: 0,
            repetitions: 0,
            last_reviewed_at: null,
            next_review_at: new Date().toISOString()
          } : null
        });
      } catch (err) {
        console.error("Failed to submit review:", err);
      }
    }

    setTimeout(() => {
      if (currentIndex < topic.words.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setPhase("intro");
      } else {
        setIsComplete(true);
      }
    }, 500);
  };

  const handleRestartSession = () => {
    setCurrentIndex(0);
    setPhase("intro");
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
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

  if (error || !topic) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-4">Topic not found</p>
            <Button onClick={() => navigate("/")}>Go Home</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (topic.words.length === 0) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-2">No words yet</p>
            <p className="text-sm text-muted-foreground mb-6">Add vocabulary in the admin panel.</p>
            <Button onClick={() => navigate("/")}>Go Home</Button>
          </div>
        </div>
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
          <HomeButton />
        </div>

        <div className="text-center max-w-sm mx-auto py-8">
          {/* Trophy icon */}
          <Trophy className={cn(
            "h-16 w-16 mx-auto mb-6",
            isGreatScore ? "text-primary" : "text-muted-foreground"
          )} />

          {/* Score display */}
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {isGreatScore ? "Excellent work!" : "Good effort"}
          </h1>
          <p className="text-muted-foreground mb-8">
            {isGreatScore ? "أحسنت — You're making great progress" : "Keep practicing to improve"}
          </p>

          {/* Stats card */}
          <div className="p-6 rounded-xl mb-8 bg-card border border-border">
            <span className="text-4xl font-bold text-foreground">{percentage}%</span>
            <p className="text-muted-foreground mt-2">
              {sessionResults.correct} / {sessionResults.total} correct
            </p>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            <Button onClick={handleRestartSession} className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              Practice Again
            </Button>
            <Button variant="outline" onClick={() => navigate("/")} className="w-full">
              Back to Topics
            </Button>
          </div>

          {/* SRS hint for non-logged in users */}
          {!isAuthenticated && (
            <p className="mt-6 text-sm text-muted-foreground">
              <Link to="/auth" className="text-primary hover:underline">Login</Link> to save your progress
            </p>
          )}
        </div>
      </AppShell>
    );
  }

  const currentWord = topic.words[currentIndex];
  const otherWords = topic.words.filter(w => w.id !== currentWord.id);

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        
        {/* Lahja Logo */}
        <Link to="/" className="flex items-center">
          <img src={lahjaLogo} alt="Lahja" className="h-8" />
        </Link>
        
        <div className="w-11" /> {/* Spacer for balance */}
      </div>

      {/* Phase indicator - subtle */}
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

      {/* Main Content */}
      <div className="py-4">
        {phase === "intro" ? (
          <IntroCard 
            word={currentWord} 
            gradient={topic.gradient} 
            onContinue={handleContinueToQuiz} 
          />
        ) : (
          <QuizCard 
            word={currentWord} 
            otherWords={otherWords} 
            gradient={topic.gradient} 
            onAnswer={handleQuizAnswer} 
          />
        )}
      </div>

      {/* Progress - at bottom */}
      <div className="mt-8">
        <ProgressDots 
          total={topic.words.length} 
          current={currentIndex} 
          gradient={topic.gradient} 
        />
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {currentIndex + 1} / {topic.words.length}
        </p>
      </div>
    </AppShell>
  );
};

export default Learn;
