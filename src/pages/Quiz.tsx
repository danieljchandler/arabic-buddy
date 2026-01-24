import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTopic, VocabularyWord } from "@/hooks/useTopic";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, RotateCcw, Trophy } from "lucide-react";
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-xl text-muted-foreground">Loading quiz...</p>
        </div>
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-6xl mb-4">😕</p>
          <p className="text-xl text-muted-foreground mb-4">Topic not found</p>
          <Button onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (topic.words.length < 4) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between p-4">
          <HomeButton />
          <div className={cn("px-6 py-3 rounded-2xl", `bg-gradient-to-br ${topic.gradient}`)}>
            <span className="text-2xl mr-2">{topic.icon}</span>
            <span className="text-xl font-bold text-white">{topic.name_arabic}</span>
          </div>
          <div className="w-14" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <p className="text-6xl mb-4">📝</p>
            <p className="text-xl text-muted-foreground mb-2">Need more words!</p>
            <p className="text-muted-foreground mb-6">
              Quiz requires at least 4 words. Add more vocabulary in the admin panel.
            </p>
            <Button onClick={() => navigate("/")}>Go Home</Button>
          </div>
        </div>
      </div>
    );
  }

  // Mode selection screen
  if (!mode) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between p-4">
          <HomeButton />
          <div className={cn("px-6 py-3 rounded-2xl", `bg-gradient-to-br ${topic.gradient}`)}>
            <span className="text-2xl mr-2">{topic.icon}</span>
            <span className="text-xl font-bold text-white">{topic.name_arabic}</span>
          </div>
          <div className="w-14" />
        </div>
        
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <h2 className="text-3xl font-bold mb-2">اختبار 🎯</h2>
            <p className="text-xl text-muted-foreground mb-8">Choose quiz mode</p>
            
            <div className="space-y-4">
              <button
                onClick={() => setMode("multiple-choice")}
                className={cn(
                  "w-full p-6 rounded-3xl text-left transition-all duration-300",
                  "bg-card shadow-card hover:shadow-lg hover:scale-[1.02]",
                  "border-4 border-transparent hover:border-primary"
                )}
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl">🔘</span>
                  <div>
                    <p className="text-xl font-bold">Multiple Choice</p>
                    <p className="text-muted-foreground">Pick the correct answer</p>
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => setMode("typing")}
                className={cn(
                  "w-full p-6 rounded-3xl text-left transition-all duration-300",
                  "bg-card shadow-card hover:shadow-lg hover:scale-[1.02]",
                  "border-4 border-transparent hover:border-primary"
                )}
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl">⌨️</span>
                  <div>
                    <p className="text-xl font-bold">Type Answer</p>
                    <p className="text-muted-foreground">Write the English word</p>
                  </div>
                </div>
              </button>
            </div>
            
            <p className="mt-8 text-muted-foreground">
              {shuffledWords.length} questions
            </p>
          </div>
        </div>
      </div>
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between p-4">
        <HomeButton />
        <div className={cn("px-6 py-3 rounded-2xl", `bg-gradient-to-br ${topic.gradient}`)}>
          <span className="text-2xl mr-2">{topic.icon}</span>
          <span className="text-xl font-bold text-white">{topic.name_arabic}</span>
        </div>
        <div className="w-14" />
      </div>

      {/* Progress bar */}
      <div className="px-4 mb-4">
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all duration-500", `bg-gradient-to-r ${topic.gradient}`)}
            style={{ width: `${((quizState.currentIndex) / shuffledWords.length) * 100}%` }}
          />
        </div>
        <p className="text-center mt-2 text-muted-foreground font-semibold">
          {quizState.currentIndex + 1} / {shuffledWords.length}
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-8">
        <QuizQuestion
          mode={mode}
          currentWord={currentWord}
          otherWords={otherWords}
          gradient={topic.gradient}
          onAnswer={handleAnswer}
        />
      </div>
    </div>
  );
};

export default Quiz;
