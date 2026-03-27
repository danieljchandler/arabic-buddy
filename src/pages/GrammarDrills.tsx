import { useState, useEffect } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BookOpen,
  Check,
  ChevronRight,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

interface Choice {
  text_arabic: string;
  text_english: string;
}

interface DrillQuestion {
  question_arabic: string;
  question_english: string;
  grammar_point: string;
  choices: Choice[];
  correct_index: number;
  explanation: string;
}

const CATEGORIES = [
  { id: "verb-conjugation", label: "Verb Conjugation", labelAr: "تصريف الأفعال", icon: "🔄" },
  { id: "pronouns", label: "Pronouns", labelAr: "الضمائر", icon: "👤" },
  { id: "negation", label: "Negation", labelAr: "النفي", icon: "🚫" },
  { id: "possessives", label: "Possessives", labelAr: "الملكية", icon: "🏠" },
  { id: "questions", label: "Question Forms", labelAr: "الأسئلة", icon: "❓" },
  { id: "sentence-structure", label: "Sentence Structure", labelAr: "بنية الجملة", icon: "📝" },
];

const DIFFICULTIES = [
  { id: "beginner", label: "Beginner", color: "text-green-600 dark:text-green-400" },
  { id: "intermediate", label: "Intermediate", color: "text-yellow-600 dark:text-yellow-400" },
  { id: "advanced", label: "Advanced", color: "text-red-600 dark:text-red-400" },
];

const GrammarDrills = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  // Restore persisted session
  const [savedSession] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('session_grammar_drills');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_grammar_drills');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [category, setCategory] = useState<string | null>(savedSession?.category ?? null);
  const [difficulty, setDifficulty] = useState(savedSession?.difficulty ?? "beginner");
  const [questions, setQuestions] = useState<DrillQuestion[]>(savedSession?.questions ?? []);
  const [currentIndex, setCurrentIndex] = useState(savedSession?.currentIndex ?? 0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(savedSession?.score ?? 0);
  const [isLoading, setIsLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);

  // Persist session state
  useEffect(() => {
    if (questions.length === 0) return;
    try {
      const entry = {
        data: { category, difficulty, questions, currentIndex, score },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_grammar_drills', JSON.stringify(entry));
    } catch {}
  }, [category, difficulty, questions, currentIndex, score]);

  const fetchDrill = async (cat: string) => {
    setIsLoading(true);
    setCategory(cat);
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setShowResult(false);

    try {
      // Try pre-approved content first
      const { data: approved } = await supabase
        .from("grammar_exercises" as any)
        .select("*")
        .eq("status", "published")
        .eq("category", cat)
        .eq("difficulty", difficulty)
        .limit(10);

      if (approved && approved.length >= 3) {
        const shuffled = (approved as any[]).sort(() => Math.random() - 0.5).slice(0, 5);
        setQuestions(shuffled.map((q: any) => ({
          question_arabic: q.question_arabic,
          question_english: q.question_english,
          grammar_point: q.grammar_point,
          choices: q.choices as Choice[],
          correct_index: q.correct_index,
          explanation: q.explanation,
        })));
        return;
      }

      // Fallback to live AI generation
      const { data, error } = await supabase.functions.invoke("grammar-drill", {
        body: { category: cat, difficulty, dialect: activeDialect },
      });
      if (error) throw error;
      if (data?.questions) {
        setQuestions(data.questions);
      } else {
        throw new Error("No questions returned");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to generate drill");
      setCategory(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = (index: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(index);
    if (index === questions[currentIndex].correct_index) {
      setScore((s) => s + 1);
    }
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
    } else {
      setShowResult(true);
    }
  };

  const resetDrill = () => {
    setCategory(null);
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setShowResult(false);
  };

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center space-y-4">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Sign in to practice grammar drills</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  // Results screen
  if (showResult) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <AppShell>
        <HomeButton />
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Drill Complete!</h1>
          <p className="text-4xl font-bold text-primary">{pct}%</p>
          <p className="text-muted-foreground">
            {score} / {questions.length} correct
          </p>
          {pct >= 80 && <p className="text-sm text-green-600 dark:text-green-400">Excellent! 🎉</p>}
          {pct >= 50 && pct < 80 && <p className="text-sm text-yellow-600 dark:text-yellow-400">Good effort! Keep practicing 💪</p>}
          {pct < 50 && <p className="text-sm text-red-600 dark:text-red-400">Keep going — practice makes perfect! 📚</p>}
          <div className="flex gap-3 justify-center pt-4">
            <Button variant="outline" onClick={resetDrill}>
              <RotateCcw className="h-4 w-4 mr-2" /> New Drill
            </Button>
            <Button onClick={() => fetchDrill(category!)}>
              <Sparkles className="h-4 w-4 mr-2" /> Retry
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Active question
  if (questions.length > 0 && !isLoading) {
    const q = questions[currentIndex];
    return (
      <AppShell>
        <HomeButton />
        <div className="py-4 space-y-5">
          {/* Progress */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span className="text-sm font-medium text-primary">{score} correct</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + (selectedAnswer !== null ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>

          {/* Grammar point badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {q.grammar_point}
            </span>
          </div>

          {/* Question */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-2">
            <p className="text-xl font-bold text-foreground text-right leading-relaxed" dir="rtl">
              {q.question_arabic}
            </p>
            <p className="text-sm text-muted-foreground">{q.question_english}</p>
          </div>

          {/* Choices */}
          <div className="space-y-2">
            {q.choices.map((choice, i) => {
              const isCorrect = i === q.correct_index;
              const isSelected = i === selectedAnswer;
              const answered = selectedAnswer !== null;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={answered}
                  className={cn(
                    "w-full p-4 rounded-xl border text-right",
                    "flex items-center gap-3 transition-all duration-200",
                    !answered && "hover:border-primary/40 active:scale-[0.99] cursor-pointer",
                    !answered && "bg-card border-border",
                    answered && isCorrect && "bg-green-500/10 border-green-500/40",
                    answered && isSelected && !isCorrect && "bg-red-500/10 border-red-500/40",
                    answered && !isSelected && !isCorrect && "opacity-50"
                  )}
                >
                  <div className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0">
                    {answered && isCorrect && <Check className="h-4 w-4 text-green-600 dark:text-green-400" />}
                    {answered && isSelected && !isCorrect && <X className="h-4 w-4 text-red-600 dark:text-red-400" />}
                    {!answered && <span className="text-xs text-muted-foreground">{String.fromCharCode(65 + i)}</span>}
                  </div>
                  <div className="flex-1 text-right" dir="rtl">
                    <p className="font-semibold text-foreground">{choice.text_arabic}</p>
                    <p className="text-xs text-muted-foreground">{choice.text_english}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Explanation + Next */}
          {selectedAnswer !== null && (
            <div className="space-y-3">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                <p className="text-sm text-foreground">{q.explanation}</p>
              </div>
              <Button onClick={nextQuestion} className="w-full">
                {currentIndex < questions.length - 1 ? (
                  <>Next <ChevronRight className="h-4 w-4 ml-1" /></>
                ) : (
                  "See Results"
                )}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // Category selection
  return (
    <AppShell>
      <HomeButton />
      <div className="py-4 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Grammar Drills</h1>
            <p className="text-sm text-muted-foreground">Practice {activeDialect === 'Egyptian' ? 'Egyptian' : 'Gulf'} Arabic grammar</p>
          </div>
        </div>

        {/* Difficulty selector */}
        <div className="flex gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              onClick={() => setDifficulty(d.id)}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all",
                difficulty === d.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:border-primary/30"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Category grid */}
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating grammar drill...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => fetchDrill(cat.id)}
                className={cn(
                  "p-4 rounded-xl bg-card border border-border",
                  "flex flex-col items-center gap-2 text-center",
                  "transition-all duration-200",
                  "hover:border-primary/30 active:scale-[0.97]"
                )}
              >
                <span className="text-2xl">{cat.icon}</span>
                <p className="font-semibold text-foreground text-sm">{cat.label}</p>
                <p className="text-xs text-muted-foreground" dir="rtl">{cat.labelAr}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default GrammarDrills;
