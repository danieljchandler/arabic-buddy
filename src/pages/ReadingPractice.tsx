import { useState, useCallback, useEffect } from "react";
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
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
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
  Sparkles,
  BookmarkPlus,
  Eye,
  EyeOff,
} from "lucide-react";

type Difficulty = "beginner" | "intermediate" | "advanced";

interface VocabItem {
  arabic: string;
  english: string;
  inContext: string;
}

interface PassageLine {
  arabic: string;
  english: string;
}

interface Question {
  question: string;
  questionEnglish: string;
  options: { text: string; textEnglish: string; correct: boolean }[];
}

interface Passage {
  title: string;
  titleEnglish: string;
  lines: PassageLine[];
  passage?: string;
  passageEnglish?: string;
  difficulty: Difficulty;
  vocabulary: VocabItem[];
  questions: Question[];
}

const DIFFICULTY_CONFIG = {
  beginner: { label: "Beginner", color: "bg-green-500/20 text-green-700 dark:text-green-400", xp: 10 },
  intermediate: { label: "Intermediate", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", xp: 15 },
  advanced: { label: "Advanced", color: "bg-red-500/20 text-red-700 dark:text-red-400", xp: 20 },
};

interface WordEnrichment {
  root?: string;
  otherUses?: { arabic: string; english: string }[];
}

/** Fetch root + other uses for a word via AI */
const enrichWord = async (word: string, dialect: string): Promise<WordEnrichment> => {
  try {
    const { data, error } = await supabase.functions.invoke("word-enrichment", {
      body: { word, dialect },
    });
    if (error) throw error;
    return {
      root: data?.root || undefined,
      otherUses: Array.isArray(data?.uses) ? data.uses : [],
    };
  } catch {
    return {};
  }
};

const ReadingPractice = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { activeDialect } = useDialect();
  const { data: allWords } = useAllWords();
  const addXP = useAddXP();
  const addVocab = useAddUserVocabulary();

  // Session-persisted state
  const [savedSession, setSavedSession] = useState<{
    difficulty: Difficulty | null;
    passage: Passage | null;
    currentQuestion: number;
    answers: (number | null)[];
    showResults: boolean;
    quizStarted: boolean;
  } | null>(() => {
    try {
      const raw = localStorage.getItem('session_reading_practice');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_reading_practice');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [difficulty, setDifficulty] = useState<Difficulty | null>(savedSession?.difficulty ?? null);
  const [passage, setPassage] = useState<Passage | null>(savedSession?.passage ?? null);
  const [loading, setLoading] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [revealedLines, setRevealedLines] = useState<Set<number>>(new Set());
  const [currentQuestion, setCurrentQuestion] = useState(savedSession?.currentQuestion ?? 0);
  const [answers, setAnswers] = useState<(number | null)[]>(savedSession?.answers ?? []);
  const [showResults, setShowResults] = useState(savedSession?.showResults ?? false);
  const [quizStarted, setQuizStarted] = useState(savedSession?.quizStarted ?? false);

  // Word-level translation state
  const [wordTranslations, setWordTranslations] = useState<Record<string, { translation: string; lineEnglish: string; enrichment?: WordEnrichment; enriching?: boolean }>>({});

  // Persist important state to localStorage
  useEffect(() => {
    if (!passage) return; // don't persist empty state
    try {
      const entry = {
        data: { difficulty, passage, currentQuestion, answers, showResults, quizStarted },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_reading_practice', JSON.stringify(entry));
    } catch {}
  }, [difficulty, passage, currentQuestion, answers, showResults, quizStarted]);

  /** Normalize passage data — handle both old (passage/passageEnglish) and new (lines) format */
  const normalizePassage = (raw: any): Passage => {
    let lines: PassageLine[] = raw.lines || [];

    // Fallback: split paragraph into sentences if lines not provided
    if (lines.length === 0 && raw.passage) {
      const arabicSentences = raw.passage.split(/(?<=[.!؟،])\s+/).filter(Boolean);
      const englishSentences = (raw.passageEnglish || "").split(/(?<=[.!?])\s+/).filter(Boolean);
      lines = arabicSentences.map((s: string, i: number) => ({
        arabic: s.trim(),
        english: (englishSentences[i] || "").trim(),
      }));
    }

    return {
      title: raw.title,
      titleEnglish: raw.titleEnglish || raw.title_english || "",
      lines,
      difficulty: raw.difficulty,
      vocabulary: raw.vocabulary || [],
      questions: raw.questions || [],
    };
  };

  const loadPassage = async (selectedDifficulty: Difficulty) => {
    setDifficulty(selectedDifficulty);
    setLoading(true);
    setPassage(null);
    setQuizStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setShowResults(false);
    setRevealedLines(new Set());
    setWordTranslations({});

    try {
      const { data: approved } = await supabase
        .from("reading_passages" as any)
        .select("*")
        .eq("status", "published")
        .eq("difficulty", selectedDifficulty)
        .limit(10);

      if (approved && approved.length > 0) {
        const picked = (approved as any[])[Math.floor(Math.random() * approved.length)];
        const p = normalizePassage({
          title: picked.title,
          titleEnglish: picked.title_english,
          passage: picked.passage,
          passageEnglish: picked.passage_english,
          lines: picked.lines,
          difficulty: selectedDifficulty,
          vocabulary: picked.vocabulary,
          questions: picked.questions,
        });
        setPassage(p);
        setAnswers(new Array(p.questions.length).fill(null));
        return;
      }

      const wordsToUse = allWords?.slice(0, 20) || [];
      const { data, error } = await supabase.functions.invoke("reading-passage", {
        body: {
          difficulty: selectedDifficulty,
          topic: customTopic.trim() || undefined,
          userVocab: wordsToUse.map((w) => ({
            word_arabic: w.word_arabic,
            word_english: w.word_english,
          })),
          dialect: activeDialect,
        },
      });

      if (error) throw error;

      if (data.passage) {
        const p = normalizePassage(data.passage);
        setPassage(p);
        setAnswers(new Array(p.questions.length).fill(null));
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

  const toggleLineTranslation = (index: number) => {
    setRevealedLines((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleWordTap = async (word: string, lineIdx: number) => {
    const cleanWord = word.replace(/[،.؟!,]/g, "").trim();
    if (!cleanWord) return;

    // Already have data for this word
    if (wordTranslations[cleanWord]) return;

    // Build local translation from passage context
    const line = passage?.lines[lineIdx];
    const lineEnglish = line?.english || "";

    // Check vocabulary list for exact match
    const vocabMatch = passage?.vocabulary.find(
      (v) => cleanWord.includes(v.arabic) || v.arabic.includes(cleanWord)
    );
    const translation = vocabMatch?.english || "";

    // Set initial translation immediately (no network call)
    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation, lineEnglish, enriching: true },
    }));

    // Async enrichment for definition + root + other uses
    const enrichment = await enrichWord(cleanWord, activeDialect);
    const definition = enrichment?.definition || translation || `In context: "${lineEnglish}"`;
    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { ...prev[cleanWord], translation: definition, enrichment, enriching: false },
    }));
  };

  const saveAsFlashcard = (arabic: string, english: string, root?: string) => {
    if (!isAuthenticated) {
      toast.error("Sign in to save flashcards");
      return;
    }
    addVocab.mutate(
      { word_arabic: arabic, word_english: english, root: root || undefined, source: "reading-practice" },
      {
        onSuccess: () => toast.success("Saved to My Words!"),
        onError: () => toast.error("Failed to save"),
      }
    );
  };

  const handleAnswer = (optionIndex: number) => {
    if (answers[currentQuestion] !== null) return;
    const newAnswers = [...answers];
    newAnswers[currentQuestion] = optionIndex;
    setAnswers(newAnswers);

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
    setRevealedLines(new Set());
    setWordTranslations({});
  };

  const score = answers.reduce((acc, ans, idx) => {
    if (ans !== null && passage?.questions[idx]?.options[ans]?.correct) return acc + 1;
    return acc;
  }, 0);

  // ── Difficulty selection ──
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
          <div className="space-y-2">
            <label htmlFor="custom-topic" className="text-sm font-medium text-muted-foreground">
              Describe a scenario (optional)
            </label>
            <textarea
              id="custom-topic"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. ordering coffee at a café, visiting the doctor, shopping at the gold souk..."
              className="flex w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[72px]"
              maxLength={200}
            />
            {customTopic.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{customTopic.length}/200</p>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground text-center">Select difficulty</p>
            {(["beginner", "intermediate", "advanced"] as Difficulty[]).map((level) => (
              <button
                key={level}
                onClick={() => loadPassage(level)}
                disabled={loading}
                className={cn(
                  "w-full p-4 rounded-xl text-left bg-card border border-border",
                  "flex items-center justify-between transition-all duration-200",
                  "hover:border-primary/40 active:scale-[0.99] disabled:opacity-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <Badge className={DIFFICULTY_CONFIG[level].color}>{DIFFICULTY_CONFIG[level].label}</Badge>
                  <span className="text-sm text-muted-foreground">+{DIFFICULTY_CONFIG[level].xp} XP per question</span>
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

  // ── Loading ──
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

  // ── Results ──
  if (showResults) {
    return (
      <AppShell>
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reading Complete!</h1>
          <div className="text-4xl font-bold text-primary">{score}/{passage.questions.length}</div>
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

  // ── Reading + Quiz ──
  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={resetSession}>
          <X className="h-4 w-4 mr-1" />
          Exit
        </Button>
        <Badge className={DIFFICULTY_CONFIG[difficulty].color}>{DIFFICULTY_CONFIG[difficulty].label}</Badge>
      </div>

      {/* Passage Section */}
      {!quizStarted && (
        <div className="space-y-4">
          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground font-arabic" dir="rtl">{passage.title}</h2>
            <p className="text-sm text-muted-foreground">{passage.titleEnglish}</p>
          </div>

          {/* Line-by-line passage */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Tap any word for translation • Tap the eye icon for sentence meaning
            </p>

            {passage.lines.map((line, lineIdx) => (
              <div key={lineIdx} className="space-y-1">
                {/* Arabic line — every word is tappable */}
                <p className="text-lg leading-relaxed font-arabic text-foreground flex flex-wrap justify-end gap-1" dir="rtl">
                  {line.arabic.split(/\s+/).map((word, wIdx) => {
                    const cleanWord = word.replace(/[،.؟!,]/g, "").trim();
                    const wordData = wordTranslations[cleanWord];

                    return (
                      <Popover key={wIdx}>
                        <PopoverTrigger asChild>
                          <span
                            onClick={() => handleWordTap(word, lineIdx)}
                            className={cn(
                              "cursor-pointer rounded px-0.5 transition-colors",
                              wordData
                                ? "text-primary underline underline-offset-4 decoration-primary/30"
                                : "hover:bg-primary/10"
                            )}
                          >
                            {word}
                          </span>
                        </PopoverTrigger>
                        {wordData && (
                          <PopoverContent className="w-64 p-3" side="top">
                            <div className="space-y-2">
                              <p className="font-bold text-foreground font-arabic text-lg" dir="rtl">{cleanWord}</p>
                              <p className="text-sm text-muted-foreground">{wordData.translation}</p>

                              {/* Root */}
                              {wordData.enriching ? (
                                <div className="flex items-center gap-2 pt-1">
                                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">Loading root & uses…</span>
                                </div>
                              ) : wordData.enrichment?.root ? (
                                <div className="pt-1 border-t border-border">
                                  <p className="text-xs font-medium text-muted-foreground">Root</p>
                                  <p className="font-arabic text-sm text-foreground" dir="rtl">{wordData.enrichment.root}</p>
                                </div>
                              ) : null}

                              {/* Other uses */}
                              {wordData.enrichment?.otherUses && wordData.enrichment.otherUses.length > 0 && (
                                <div className="pt-1 border-t border-border">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Other forms</p>
                                  <div className="space-y-0.5">
                                    {wordData.enrichment.otherUses.map((u, i) => (
                                      <p key={i} className="text-xs">
                                        <span className="font-arabic" dir="rtl">{u.arabic}</span>
                                        <span className="text-muted-foreground"> — {u.english}</span>
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {isAuthenticated && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full text-xs mt-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveAsFlashcard(cleanWord, wordData.translation, wordData.enrichment?.root);
                                  }}
                                >
                                  <BookmarkPlus className="h-3 w-3 mr-1" />
                                  Save to My Words
                                </Button>
                              )}
                            </div>
                          </PopoverContent>
                        )}
                      </Popover>
                    );
                  })}
                </p>

                {/* Toggle line translation */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleLineTranslation(lineIdx)}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  >
                    {revealedLines.has(lineIdx) ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {revealedLines.has(lineIdx) && (
                    <p className="text-sm text-muted-foreground">{line.english}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vocabulary Preview */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              Key Vocabulary
            </p>
            <div className="flex flex-wrap gap-2">
              {passage.vocabulary.map((v, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-sm cursor-pointer hover:bg-secondary/80"
                  onClick={() => saveAsFlashcard(v.arabic, v.english)}
                >
                  {v.arabic} — {v.english}
                  {isAuthenticated && <BookmarkPlus className="h-3 w-3 ml-1.5 inline" />}
                </Badge>
              ))}
            </div>
          </div>

          {/* Start Quiz */}
          <Button onClick={() => setQuizStarted(true)} className="w-full" size="lg">
            Start Comprehension Quiz
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Quiz Section */}
      {quizStarted && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Question {currentQuestion + 1} of {passage.questions.length}</span>
              <span className="font-medium text-primary">Score: {score}</span>
            </div>
            <Progress value={((currentQuestion + 1) / passage.questions.length) * 100} className="h-2" />
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="text-center">
              <p className="text-lg font-arabic text-foreground" dir="rtl">{passage.questions[currentQuestion].question}</p>
              <p className="text-sm text-muted-foreground mt-1">{passage.questions[currentQuestion].questionEnglish}</p>
            </div>
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
                      "w-full p-4 rounded-xl text-right transition-all border-2",
                      isAnswered
                        ? isCorrect
                          ? "border-green-500 bg-green-500/10"
                          : isSelected
                          ? "border-red-500 bg-red-500/10"
                          : "border-border bg-muted/50"
                        : "border-border hover:border-primary/50 bg-card"
                    )}
                  >
                    <p className="font-arabic text-foreground" dir="rtl">{option.text}</p>
                    <p className="text-xs text-muted-foreground mt-1">{option.textEnglish}</p>
                  </button>
                );
              })}
            </div>
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
