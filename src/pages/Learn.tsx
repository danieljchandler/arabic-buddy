import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTopic } from "@/hooks/useTopic";
import { useAuth } from "@/hooks/useAuth";
import { useSubmitReview } from "@/hooks/useReview";
import { IntroCard } from "@/components/learn/IntroCard";
import { QuizCard } from "@/components/learn/QuizCard";
import { ProgressDots } from "@/components/ProgressDots";
import { HomeButton } from "@/components/HomeButton";
import { cn } from "@/lib/utils";
import { Loader2, Trophy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
type Phase = "intro" | "quiz";
interface WordProgress {
  wordId: string;
  phase: Phase;
  answered: boolean;
  wasCorrect: boolean | null;
}
const Learn = () => {
  const {
    topicId
  } = useParams<{
    topicId: string;
  }>();
  const navigate = useNavigate();
  const {
    user,
    isAuthenticated
  } = useAuth();
  const submitReview = useSubmitReview();
  const {
    data: topic,
    isLoading,
    error
  } = useTopic(topicId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionResults, setSessionResults] = useState<{
    correct: number;
    total: number;
  }>({
    correct: 0,
    total: 0
  });
  const [isComplete, setIsComplete] = useState(false);
  const [userReviews, setUserReviews] = useState<Map<string, {
    id: string;
  }>>(new Map());

  // Fetch existing reviews for SRS integration
  useEffect(() => {
    if (user && topic?.words) {
      const fetchReviews = async () => {
        const wordIds = topic.words.map(w => w.id);
        const {
          data: reviews
        } = await supabase.from('word_reviews').select('id, word_id').eq('user_id', user.id).in('word_id', wordIds);
        if (reviews) {
          const reviewMap = new Map(reviews.map(r => [r.word_id, {
            id: r.id
          }]));
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
    setSessionResults({
      correct: 0,
      total: 0
    });
    setIsComplete(false);
  }, [topicId]);
  const handleContinueToQuiz = () => {
    setPhase("quiz");
  };
  const handleQuizAnswer = async (isCorrect: boolean) => {
    if (!topic) return;
    const currentWord = topic.words[currentIndex];

    // Update session stats
    setSessionResults(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1
    }));

    // Submit to SRS if logged in
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

    // Move to next word or complete session
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
    setSessionResults({
      correct: 0,
      total: 0
    });
    setIsComplete(false);
  };
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }
  if (error || !topic) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4 opacity-50">📚</p>
          <p className="text-xl text-muted-foreground mb-4">Topic not found</p>
          <Button onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </div>
    );
  }
  if (topic.words.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between p-4">
          <HomeButton />
          <div className={cn("px-6 py-3 rounded-xl", `bg-gradient-to-br ${topic.gradient}`)}>
            <span className="text-2xl mr-2">{topic.icon}</span>
            <span className="text-xl font-bold text-white font-arabic">{topic.name_arabic}</span>
          </div>
          <div className="w-14" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-4xl mb-4 opacity-50">📝</p>
            <p className="text-xl text-muted-foreground mb-2">No words yet</p>
            <p className="text-muted-foreground mb-6">Add vocabulary in the admin panel.</p>
            <Button onClick={() => navigate("/")}>Go Home</Button>
          </div>
        </div>
      </div>
    );
  }

  // Session complete screen
  if (isComplete) {
    const percentage = Math.round(sessionResults.correct / sessionResults.total * 100);
    const isGreatScore = percentage >= 80;
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between p-4">
          <HomeButton />
          <div className={cn("px-6 py-3 rounded-xl", `bg-gradient-to-br ${topic.gradient}`)}>
            <span className="text-2xl mr-2">{topic.icon}</span>
            <span className="text-xl font-bold text-white font-arabic">{topic.name_arabic}</span>
          </div>
          <div className="w-14" />
        </div>

        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md w-full">
            {/* Trophy icon */}
            <div className="mb-6">
              <Trophy className={cn("h-20 w-20 mx-auto", isGreatScore ? "text-primary" : "text-muted-foreground")} />
            </div>

            {/* Score display */}
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isGreatScore ? "Excellent work!" : "Good effort"}
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              {isGreatScore ? "أحسنت — You're making great progress" : "Keep practicing to improve"}
            </p>

            {/* Stats card */}
            <div className="p-6 rounded-2xl mb-8 bg-card shadow-card border border-border">
              <div className="flex items-center justify-center gap-3 mb-4">
                <span className="text-5xl font-bold text-foreground">{percentage}%</span>
              </div>
              <p className="text-muted-foreground text-lg">
                {sessionResults.correct} / {sessionResults.total} correct
              </p>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <Button onClick={handleRestartSession} className="w-full h-12 text-base font-semibold rounded-xl bg-primary text-primary-foreground shadow-button">
                <RotateCcw className="h-5 w-5 mr-2" />
                Practice Again
              </Button>
              <Button variant="outline" onClick={() => navigate("/")} className="w-full h-11 text-base font-medium rounded-xl">
                Back to Topics
              </Button>
            </div>

            {/* SRS hint for non-logged in users */}
            {!isAuthenticated && (
              <p className="mt-6 text-sm text-muted-foreground">
                <Link to="/auth" className="text-primary underline">Login</Link> to save your progress with spaced repetition
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  const currentWord = topic.words[currentIndex];
  const otherWords = topic.words.filter(w => w.id !== currentWord.id);
  return <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <HomeButton />
        <div className={cn("px-6 py-3 rounded-xl", `bg-gradient-to-br ${topic.gradient}`)}>
          <span className="text-2xl mr-2">{topic.icon}</span>
          <span className="text-xl font-bold text-white font-arabic">{topic.name_arabic}</span>
        </div>
        <div className="w-14" />
      </div>

      {/* Phase indicator */}
      <div className="flex justify-center gap-2 mb-4">
        <div className={cn("px-4 py-1 rounded-full text-sm font-medium transition-all", phase === "intro" ? `bg-gradient-to-r ${topic.gradient} text-white` : "bg-muted text-muted-foreground")}>
          Learn
        </div>
        <div className={cn("px-4 py-1 rounded-full text-sm font-medium transition-all", phase === "quiz" ? `bg-gradient-to-r ${topic.gradient} text-white` : "bg-muted text-muted-foreground")}>
          Quiz
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        {phase === "intro" ? <IntroCard word={currentWord} gradient={topic.gradient} onContinue={handleContinueToQuiz} /> : <QuizCard word={currentWord} otherWords={otherWords} gradient={topic.gradient} onAnswer={handleQuizAnswer} />}
      </div>

      {/* Progress */}
      <div className="pb-6">
        <ProgressDots total={topic.words.length} current={currentIndex} gradient={topic.gradient} />
        <p className="mt-2 text-center text-muted-foreground font-medium">
          {currentIndex + 1} / {topic.words.length}
        </p>
      </div>
    </div>;
};
export default Learn;