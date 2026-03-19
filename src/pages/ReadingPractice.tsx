import { useState, useCallback } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { HomeButton } from "@/components/HomeButton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useAllWords } from "@/hooks/useAllWords";
import { useAddXP } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Check,
  X,
  RotateCcw,
  Loader2,
  ChevronRight,
  Volume2,
  Sparkles,
} from "lucide-react";

type Difficulty = "beginner" | "intermediate" | "advanced";

interface VocabItem {
  arabic: string;
  english: string;
  inContext: string;
}

interface Question {
  question: string;
  questionEnglish: string;
  options: { text: string; textEnglish: string; correct: boolean }[];
}

interface Passage {
  title: string;
  titleEnglish: string;
  passage: string;
  passageEnglish: string;
  difficulty: Difficulty;
  vocabulary: VocabItem[];
  questions: Question[];
}

const DIFFICULTY_CONFIG = {
  beginner: { label: "Beginner", color: "bg-green-500/20 text-green-700 dark:text-green-400", xp: 10 },
  intermediate: { label: "Intermediate", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", xp: 15 },
  advanced: { label: "Advanced", color: "bg-red-500/20 text-red-700 dark:text-red-400", xp: 20 },
};

const ReadingPractice = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { data: allWords } = useAllWords();
  const addXP = useAddXP();

  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [quizStarted, setQuizStarted] = useState(false);

  const loadPassage = async (selectedDifficulty: Difficulty) => {
    setDifficulty(selectedDifficulty);
    setLoading(true);
    setPassage(null);
    setQuizStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setShowResults(false);
    setShowTranslation(false);

    try {
      // Try pre-approved content first
      const { data: approved } = await supabase
        .from("reading_passages" as any)
        .select("*")
        .eq("status", "published")
        .eq("difficulty", selectedDifficulty)
        .limit(10);

      if (approved && approved.length > 0) {
        const picked = (approved as any[])[Math.floor(Math.random() * approved.length)];
        const p: Passage = {
          title: picked.title,
          titleEnglish: picked.title_english,
          passage: picked.passage,
          passageEnglish: picked.passage_english,
          difficulty: selectedDifficulty,
          vocabulary: picked.vocabulary as VocabItem[],
          questions: picked.questions as Question[],
        };
        setPassage(p);
        setAnswers(new Array(p.questions.length).fill(null));
        return;
      }

      // Fallback to live AI generation
      const wordsToUse = allWords?.slice(0, 20) || [];

      const { data, error } = await supabase.functions.invoke("reading-passage", {
        body: {
          difficulty: selectedDifficulty,
          userVocab: wordsToUse.map((w) => ({
            word_arabic: w.word_arabic,
            word_english: w.word_english,
          })),
        },
      });

      if (error) throw error;

      if (data.passage) {
        setPassage(data.passage);
        setAnswers(new Array(data.passage.questions.length).fill(null));
      } else {
        throw new Error("No passage generated");
      }
    } catch (e) {
      console.error("Failed to load passage:", e);
      toast.error("Failed to load passage. Please try again.");
      setDifficulty(null);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (optionIndex: number) => {
    if (answers[currentQuestion] !== null) return;

    const newAnswers = [...answers];
    newAnswers[currentQuestion] = optionIndex;
    setAnswers(newAnswers);

    // Check if correct and award XP
    const question = passage?.questions[currentQuestion];
    if (question?.options[optionIndex]?.correct && isAuthenticated) {
      const xpAmount = DIFFICULTY_CONFIG[difficulty!].xp;
      addXP.mutate({ amount: xpAmount, reason: "reading" });
    }
  };

  const nextQuestion = () => {
    if (currentQuestion < (passage?.questions.length || 0) - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      setShowResults(true);
    }
  };

  const resetSession = () => {
    setDifficulty(null);
    setPassage(null);
    setQuizStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setShowResults(false);
    setShowTranslation(false);
  };

  const score = answers.reduce((acc, ans, idx) => {
    if (ans !== null && passage?.questions[idx]?.options[ans]?.correct) {
      return acc + 1;
    }
    return acc;
  }, 0);

  // Difficulty selection screen
  if (!difficulty) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Reading Practice</h1>
            <p className="text-muted-foreground">Read Arabic passages and test your comprehension</p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground text-center">Select difficulty</p>

            {(["beginner", "intermediate", "advanced"] as Difficulty[]).map((level) => (
              <button
                key={level}
                onClick={() => loadPassage(level)}
                disabled={loading}
                className={cn(
                  "w-full p-4 rounded-xl text-left",
                  "bg-card border border-border",
                  "flex items-center justify-between",
                  "transition-all duration-200",
                  "hover:border-primary/40 active:scale-[0.99]",
                  "disabled:opacity-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <Badge className={DIFFICULTY_CONFIG[level].color}>
                    {DIFFICULTY_CONFIG[level].label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    +{DIFFICULTY_CONFIG[level].xp} XP per question
                  </span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // Loading state
  if (loading || !passage) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Generating passage...</p>
        </div>
      </AppShell>
    );
  }

  // Results screen
  if (showResults) {
    return (
      <AppShell>
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reading Complete!</h1>
          <div className="text-4xl font-bold text-primary">
            {score}/{passage.questions.length}
          </div>
          <p className="text-muted-foreground">
            {score === passage.questions.length
              ? "Perfect comprehension! 🎉"
              : score >= passage.questions.length / 2
              ? "Great reading skills! 👍"
              : "Keep practicing! 💪"}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={resetSession}>
              <RotateCcw className="h-4 w-4 mr-2" />
              New Passage
            </Button>
            <Button onClick={() => navigate("/")}>Done</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Reading + Quiz view
  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={resetSession}>
          <X className="h-4 w-4 mr-1" />
          Exit
        </Button>
        <Badge className={DIFFICULTY_CONFIG[difficulty].color}>
          {DIFFICULTY_CONFIG[difficulty].label}
        </Badge>
      </div>

      {/* Passage Section */}
      {!quizStarted && (
        <div className="space-y-4">
          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground font-arabic" dir="rtl">
              {passage.title}
            </h2>
            <p className="text-sm text-muted-foreground">{passage.titleEnglish}</p>
          </div>

          {/* Passage Card */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <p
              className="text-xl leading-relaxed font-arabic text-foreground"
              dir="rtl"
            >
              {passage.passage.split(" ").map((word, i) => {
                const vocabMatch = passage.vocabulary.find(
                  (v) => word.includes(v.arabic) || v.arabic.includes(word.replace(/[،.؟!]/g, ""))
                );

                if (vocabMatch) {
                  return (
                    <Popover key={i}>
                      <PopoverTrigger asChild>
                        <span className="text-primary underline underline-offset-4 decoration-primary/30 cursor-pointer hover:decoration-primary">
                          {word}{" "}
                        </span>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3">
                        <div className="space-y-1">
                          <p className="font-bold text-foreground">{vocabMatch.arabic}</p>
                          <p className="text-sm text-muted-foreground">{vocabMatch.english}</p>
                          <p className="text-xs text-muted-foreground/70 italic">
                            {vocabMatch.inContext}
                          </p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  );
                }
                return <span key={i}>{word} </span>;
              })}
            </p>

            {showTranslation && (
              <div className="pt-3 border-t border-border">
                <p className="text-sm text-muted-foreground">{passage.passageEnglish}</p>
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTranslation(!showTranslation)}
              className="w-full"
            >
              {showTranslation ? "Hide" : "Show"} Translation
            </Button>
          </div>

          {/* Vocabulary Preview */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              Key Vocabulary
            </p>
            <div className="flex flex-wrap gap-2">
              {passage.vocabulary.map((v, i) => (
                <Badge key={i} variant="secondary" className="text-sm">
                  {v.arabic} — {v.english}
                </Badge>
              ))}
            </div>
          </div>

          {/* Start Quiz Button */}
          <Button onClick={() => setQuizStarted(true)} className="w-full" size="lg">
            Start Comprehension Quiz
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Quiz Section */}
      {quizStarted && (
        <div className="space-y-6">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Question {currentQuestion + 1} of {passage.questions.length}
              </span>
              <span className="font-medium text-primary">Score: {score}</span>
            </div>
            <Progress
              value={((currentQuestion + 1) / passage.questions.length) * 100}
              className="h-2"
            />
          </div>

          {/* Question */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="text-center">
              <p className="text-lg font-arabic text-foreground" dir="rtl">
                {passage.questions[currentQuestion].question}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {passage.questions[currentQuestion].questionEnglish}
              </p>
            </div>

            {/* Options */}
            <div className="space-y-2">
              {passage.questions[currentQuestion].options.map((option, i) => {
                const isSelected = answers[currentQuestion] === i;
                const isAnswered = answers[currentQuestion] !== null;
                const isCorrect = option.correct;

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    disabled={isAnswered}
                    className={cn(
                      "w-full p-4 rounded-xl text-right transition-all",
                      "border-2",
                      isAnswered
                        ? isCorrect
                          ? "border-green-500 bg-green-500/10"
                          : isSelected
                          ? "border-red-500 bg-red-500/10"
                          : "border-border bg-muted/50"
                        : "border-border hover:border-primary/50 bg-card"
                    )}
                  >
                    <p className="font-arabic text-foreground" dir="rtl">
                      {option.text}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{option.textEnglish}</p>
                  </button>
                );
              })}
            </div>

            {/* Next Button */}
            {answers[currentQuestion] !== null && (
              <Button onClick={nextQuestion} className="w-full">
                {currentQuestion < passage.questions.length - 1 ? "Next Question" : "See Results"}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default ReadingPractice;
