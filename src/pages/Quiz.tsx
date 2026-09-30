import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTopic, VocabularyWord } from "@/hooks/useTopic";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";
import { QuizCard } from "@/components/learn/QuizCard";
import { QuizResults } from "@/components/quiz/QuizResults";
import { usePageAiContext } from "@/contexts/AiAssistantContext";

interface QuizState {
  currentIndex: number;
  score: number;
  answers: { word: VocabularyWord; correct: boolean }[];
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
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { data: topic, isLoading, error } = useTopic(lessonId);
  
  // Bumped on restart so the memo below reshuffles.
  const [round, setRound] = useState(0);
  const [quizState, setQuizState] = useState<QuizState>({
    currentIndex: 0,
    score: 0,
    answers: [],
    isComplete: false,
  });

  // Derived, not synced. This used to be state filled by an effect after the
  // topic arrived, which left the first render of every lesson with an empty
  // list: `currentWord` was undefined and the page crashed reading `.id` off
  // it (QA sweep 2026-09-29, Broken #2). Short lessons never got that far
  // because the "need more words" guard ran first, which is why it looked
  // like every *real* lesson was broken and the fixtures were fine.
  const shuffledWords = useMemo<VocabularyWord[]>(
    () => (topic?.words ? shuffleArray(topic.words) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `round` is the reshuffle trigger
    [topic, round],
  );

  usePageAiContext(
    useMemo(() => {
      const word = shuffledWords[quizState.currentIndex];
      if (!word) return null;
      return {
        kind: "word" as const,
        title: topic?.name ? `Quiz — ${topic.name}` : "Vocabulary quiz",
        summary: "A multiple-choice vocabulary quiz over the words in this lesson.",
        content: `Current word: ${word.word_arabic} — ${word.word_english}`,
      };
    }, [shuffledWords, quizState.currentIndex, topic?.name]),
  );

  const resetQuiz = useCallback(() => {
    setRound((r) => r + 1);
    setQuizState({
      currentIndex: 0,
      score: 0,
      answers: [],
      isComplete: false,
    });
  }, []);

  const handleAnswer = (isCorrect: boolean) => {
    const currentWord = shuffledWords[quizState.currentIndex];
    const newAnswers = [...quizState.answers, { word: currentWord, correct: isCorrect }];
    const newScore = isCorrect ? quizState.score + 1 : quizState.score;
    const isLastQuestion = quizState.currentIndex >= shuffledWords.length - 1;

    setQuizState({
      currentIndex: isLastQuestion ? quizState.currentIndex : quizState.currentIndex + 1,
      score: newScore,
      answers: newAnswers,
      isComplete: isLastQuestion,
    });
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
          <PageCorner />
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
  if (!currentWord) {
    // Cannot happen with the memo above (the list is never shorter than the
    // topic's words), but a crash is the wrong answer if it ever does.
    return (
      <AppShell compact>
        <div className="mb-6">
          <PageCorner />
        </div>
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground mb-6">Nothing left to quiz.</p>
          <Button onClick={resetQuiz}>Start again</Button>
        </div>
      </AppShell>
    );
  }
  const otherWords = shuffledWords.filter((_, i) => i !== quizState.currentIndex);
  const progress = (quizState.currentIndex / shuffledWords.length) * 100;

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
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
        <QuizCard
          key={currentWord.id}
          word={currentWord}
          otherWords={otherWords}
          gradient={topic.gradient}
          onAnswer={handleAnswer}
        />
      </div>
    </AppShell>
  );
};

export default Quiz;
