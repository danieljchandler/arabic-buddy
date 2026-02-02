import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTopic, VocabularyWord } from "@/hooks/useTopic";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { QuizQuestion } from "@/components/quiz/QuizQuestion";
import { QuizResults } from "@/components/quiz/QuizResults";

export type QuizMode = "multiple-choice" | "typing";

interface QuizState {
  currentIndex: number;
  score: number;
  answers: { word: VocabularyWord; correct: boolean; userAnswer: string }[];
  isComplete: boolean;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const Quiz = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const { data: topic, isLoading, error } = useTopic(topicId);
  
  const [mode, setMode] = useState<QuizMode | null>(null);
  const [shuffledWords, setShuffledWords] = useState<VocabularyWord[]>([]);
  const [quizState, setQuizState] = useState<QuizState>({
    currentIndex: 0,
    score: 0,
    answers: [],
    isComplete: false,
  });

  useEffect(() => {
    if (topic?.words && topic.words.length > 0) {
      setShuffledWords(shuffleArray(topic.words));
    }
  }, [topic]);

  const resetQuiz = useCallback(() => {
    if (topic?.words) {
      setShuffledWords(shuffleArray(topic.words));
      setQuizState({
        currentIndex: 0,
        score: 0,
        answers: [],
        isComplete: false,
      });
      setMode(null);
    }
  }, [topic]);

  const handleAnswer = (isCorrect: boolean, userAnswer: string) => {
    const currentWord = shuffledWords[quizState.currentIndex];
    const newAnswers = [...quizState.answers, { word: currentWord, correct: isCorrect, userAnswer }];
    const newScore = isCorrect ? quizState.score + 1 : quizState.score;
    const isLastQuestion = quizState.currentIndex >= shuffledWords.length - 1;

    setTimeout(() => {
      setQuizState({
        currentIndex: isLastQuestion ? quizState.currentIndex : quizState.currentIndex + 1,
        score: newScore,
        answers: newAnswers,
        isComplete: isLastQuestion,
      });
    }, 1500);
  };

  if (isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading quiz...</p>
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

  if (topic.words.length < 4) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground mb-2">Need more words</p>
          <p className="text-sm text-muted-foreground mb-6">
            Quiz requires at least 4 words.
          </p>
          <Button onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </AppShell>
    );
  }

  // Mode selection screen
  if (!mode) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-8">
          <HomeButton />
          <div className="px-4 py-2 rounded-lg bg-card border border-border">
            <span className="text-sm font-semibold text-foreground font-arabic">
              {topic.name_arabic}
            </span>
          </div>
          <div className="w-11" />
        </div>
        
        <div className="max-w-sm mx-auto text-center py-8">
          <h2 className="text-xl font-bold text-foreground mb-2 font-arabic">اختبار</h2>
          <p className="text-muted-foreground mb-8">Choose quiz mode</p>
          
          <div className="space-y-3">
            <button
              onClick={() => setMode("multiple-choice")}
              className={cn(
                "w-full p-5 rounded-xl text-left",
                "bg-card border border-border",
                "transition-all duration-200",
                "hover:border-primary/30"
              )}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg">
                  ○
                </div>
                <div>
                  <p className="font-semibold text-foreground">Multiple Choice</p>
                  <p className="text-sm text-muted-foreground">Pick the correct answer</p>
                </div>
              </div>
            </button>
            
            <button
              onClick={() => setMode("typing")}
              className={cn(
                "w-full p-5 rounded-xl text-left",
                "bg-card border border-border",
                "transition-all duration-200",
                "hover:border-primary/30"
              )}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg">
                  ⌨
                </div>
                <div>
                  <p className="font-semibold text-foreground">Type Answer</p>
                  <p className="text-sm text-muted-foreground">Write the English word</p>
                </div>
              </div>
            </button>
          </div>
          
          <p className="mt-8 text-sm text-muted-foreground">
            {shuffledWords.length} questions
          </p>
        </div>
      </AppShell>
    );
  }

  // Quiz complete - show results
  if (quizState.isComplete) {
    return (
      <QuizResults
        topic={topic}
        quizState={quizState}
        onRestart={resetQuiz}
        onHome={() => navigate("/")}
      />
    );
  }

  // Active quiz
  const currentWord = shuffledWords[quizState.currentIndex];
  const otherWords = shuffledWords.filter((_, i) => i !== quizState.currentIndex);
  const progress = (quizState.currentIndex / shuffledWords.length) * 100;

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="px-4 py-2 rounded-lg bg-card border border-border">
          <span className="text-sm font-semibold text-foreground font-arabic">
            {topic.name_arabic}
          </span>
        </div>
        <div className="w-11" />
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-500 bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center mt-2 text-xs text-muted-foreground">
          {quizState.currentIndex + 1} / {shuffledWords.length}
        </p>
      </div>

      <div className="py-4">
        <QuizQuestion
          mode={mode}
          currentWord={currentWord}
          otherWords={otherWords}
          gradient={topic.gradient}
          onAnswer={handleAnswer}
        />
      </div>
    </AppShell>
  );
};

export default Quiz;
