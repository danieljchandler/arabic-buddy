import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { DIALECT_LABELS } from "@/config";
import { AppShell } from "@/components/layout/AppShell";
import { CaravanMedallion } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isCappedError, toInvokeFailureError } from "@/lib/invokeError";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import {
  Loader2,
  Languages,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowRight,
  Brain,
  BookOpen,
  Mic,
  PenTool,
  Headphones,
  Play,
} from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";

type Choice = { text: string; text_arabic: string };
type Question = {
  question_arabic: string;
  question_english: string;
  skill_type: string;
  difficulty: string;
  choices: Choice[];
  correct_index: number;
};
type AnswerRecord = { correct: boolean; difficulty: string; skill_type: string };

const SKILL_ICONS: Record<string, typeof Brain> = {
  vocabulary: BookOpen,
  grammar: PenTool,
  reading: Brain,
  translation: Mic,
  listening: Headphones,
};

/**
 * A listening item is spoken, never shown.
 *
 * The placement test used to have no listening item at all, in an app whose
 * whole premise is spoken dialect — so it placed on the eye alone and
 * over-placed anyone whose reading runs ahead of their ear. Printing the line
 * next to the audio would put that back: it would be a reading question with
 * a sound effect.
 */
const isListening = (skillType: string) => skillType === "listening";

/** The spoken prompt for a listening item: a play button and nothing to read. */
function ListeningPrompt({ text, dialect }: { text: string; dialect: string }) {
  const { ttsUrl, isLoading } = useAzureTTS({ text, dialect });
  const playedRef = useRef(false);

  const play = () => {
    if (ttsUrl) void new Audio(ttsUrl).play().catch(() => {});
  };

  // Speak it once as soon as it is ready — the item *is* the audio, and
  // making the learner press play to receive the question is a step that
  // teaches nothing. The button is then a replay. Guarded by a ref rather
  // than the url alone so a re-render never speaks over itself.
  useEffect(() => {
    if (!ttsUrl || playedRef.current) return;
    playedRef.current = true;
    play();
     
  }, [ttsUrl]);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <button
        type="button"
        onClick={play}
        disabled={!ttsUrl || isLoading}
        aria-label="Play the line again"
        className={cn(
          "h-16 w-16 rounded-full flex items-center justify-center",
          "bg-primary text-primary-foreground shadow-elegant",
          "transition-all hover:scale-105 active:scale-[0.98]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {isLoading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Play className="h-7 w-7 ml-0.5" />}
      </button>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {isLoading ? "Preparing the audio…" : "Listen, then choose the meaning"}
      </p>
    </div>
  );
}

const CEFR_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  A1: { label: "Beginner", desc: "You can understand and use basic everyday expressions and simple phrases." },
  A2: { label: "Elementary", desc: "You can communicate in simple, routine tasks and describe your background." },
  B1: { label: "Intermediate", desc: "You can deal with most situations while traveling and describe experiences." },
  B2: { label: "Upper Intermediate", desc: "You can interact fluently with native speakers and understand complex texts." },
  C1: { label: "Advanced", desc: "You can express yourself fluently and use language flexibly for social and academic purposes." },
  C2: { label: "Mastery", desc: "You can understand virtually everything and express yourself spontaneously with precision." },
};

const TOTAL_QUESTIONS = 20;
const BATCH_SIZE = 5;

export default function PlacementQuiz() {
  const navigate = useNavigate();
  // The onboarding wizard's level step links here; finishing goes back to the
  // wizard instead of dropping the learner on the feed half-onboarded.
  const [searchParams] = useSearchParams();
  const fromOnboarding = searchParams.get("from") === "onboarding";
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  const [phase, setPhase] = useState<"intro" | "quiz" | "results">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [results, setResults] = useState<{
    cefr_level: string;
    confidence: number;
    strengths: string[];
    weaknesses: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchBatch = useCallback(
    async (questionNumber: number, history: AnswerRecord[]) => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("placement-quiz", {
          body: {
            action: "generate",
            current_difficulty: history.length > 0 ? undefined : "B1",
            question_number: questionNumber,
            history,
            dialect: activeDialect,
          },
        });
        if (error || data?.error) {
          throw await toInvokeFailureError(error, data, "Please try again.");
        }
        if (!data?.questions?.length) throw new Error("No questions received");
        return data.questions as Question[];
      } catch (e: any) {
        console.error("Failed to fetch questions:", e);
        if (!isCappedError(e)) {
          toast.error("Failed to load questions", { description: e.message || "Please try again." });
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [activeDialect]
  );

  const startQuiz = async () => {
    const batch = await fetchBatch(0, []);
    if (batch) {
      setQuestions(batch);
      setCurrentIndex(0);
      setAnswers([]);
      setPhase("quiz");
    }
  };

  const handleAnswer = async (choiceIdx: number) => {
    if (showFeedback || selectedChoice !== null) return;
    const q = questions[currentIndex];
    const isCorrect = choiceIdx === q.correct_index;
    setSelectedChoice(choiceIdx);
    setShowFeedback(true);

    const newAnswer: AnswerRecord = {
      correct: isCorrect,
      difficulty: q.difficulty,
      skill_type: q.skill_type,
    };
    const updatedAnswers = [...answers, newAnswer];
    setAnswers(updatedAnswers);

    // After feedback delay, advance
    setTimeout(async () => {
      const nextGlobalIdx = updatedAnswers.length;
      setShowFeedback(false);
      setSelectedChoice(null);

      if (nextGlobalIdx >= TOTAL_QUESTIONS) {
        // Quiz complete — score it
        setLoading(true);
        try {
          const { data, error } = await supabase.functions.invoke("placement-quiz", {
            // dialect: the server appends this run to placement_history (C4).
            body: { action: "score", history: updatedAnswers, dialect: activeDialect },
          });
          if (error) throw error;
          setResults(data);
          setPhase("results");
        } catch (e: any) {
          toast.error("Failed to calculate results");
          // Fallback client-side scoring
          setResults({
            cefr_level: "B1",
            confidence: 50,
            strengths: ["general_comprehension"],
            weaknesses: [],
          });
          setPhase("results");
        } finally {
          setLoading(false);
        }
        return;
      }

      // Need next batch?
      if (nextGlobalIdx % BATCH_SIZE === 0) {
        const nextBatch = await fetchBatch(nextGlobalIdx, updatedAnswers);
        if (nextBatch) {
          setQuestions(nextBatch);
          setCurrentIndex(0);
        } else {
          // The spent batch must go: leaving it made the last answered
          // question reappear, answerable again, appending duplicate history
          // forever. With no current question the stalled panel offers the
          // retry instead.
          setQuestions([]);
          setCurrentIndex(0);
        }
      } else {
        setCurrentIndex((i) => i + 1);
      }
    }, 1500);
  };

  const saveAndContinue = async () => {
    if (!results) {
      navigate("/");
      return;
    }
    if (!user) {
      // Twenty questions of signal used to be dropped on the floor here with
      // no explanation. The level can only be kept on an account.
      toast.info(`Sign up free to keep your ${results.cefr_level} level`, {
        description: "Your placement is saved to your account the moment you have one.",
      });
      navigate("/auth");
      return;
    }
    setSaving(true);
    try {
      const dialectKey = activeDialect.toLowerCase(); // gulf | egyptian | yemeni
      const nowIso = new Date().toISOString();
      const updates: Record<string, unknown> = {
        // Per-dialect placement
        [`placement_level_${dialectKey}`]: results.cefr_level,
        [`placement_taken_at_${dialectKey}`]: nowIso,
        // Keep legacy fields in sync for backwards-compat with older code paths
        placement_level: results.cefr_level,
        placement_taken_at: nowIso,
        proficiency_level: results.cefr_level === "A1" ? "beginner"
          : results.cefr_level === "A2" ? "elementary"
          : results.cefr_level === "B1" ? "intermediate"
          : "advanced",
      };
      const { error } = await supabase
        .from("profiles")
        .update(updates as any)
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success(`${DIALECT_LABELS[activeDialect]} level set to ${results.cefr_level}!`);
      navigate(fromOnboarding ? "/onboarding" : "/");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save results");
    } finally {
      setSaving(false);
    }
  };

  const globalQuestionNum = answers.length + 1;
  const currentQuestion = questions[currentIndex];
  const SkillIcon = currentQuestion ? (SKILL_ICONS[currentQuestion.skill_type] || Brain) : Brain;

  usePageAiContext(
    useMemo(
      () => ({
        kind: "drill" as const,
        title: "Placement quiz",
        summary:
          "An adaptive quiz that estimates the learner's CEFR level. Do not give away answers to a question that hasn't been answered yet.",
        content:
          showFeedback && currentQuestion
            ? `Question just answered: ${currentQuestion.question_arabic}${
                currentQuestion.question_english ? ` — ${currentQuestion.question_english}` : ""
              }`
            : undefined,
      }),
      [showFeedback, currentQuestion],
    ),
  );

  return (
    <AppShell>
      <div className="max-w-lg mx-auto px-4 py-6 min-h-[80vh] flex flex-col">
        {/* ─── INTRO ─── */}
        {phase === "intro" && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
            {/* The caravan: this screen is the one about where you are on the road. */}
            <CaravanMedallion className="max-w-[200px] sm:max-w-[240px]" />
            <div>
              <h1 className="text-3xl font-bold font-heading text-foreground mb-3">
                {DIALECT_LABELS[activeDialect]} Placement
              </h1>
              <p className="text-muted-foreground leading-relaxed max-w-sm">
                No matter where you are in your Arabic journey, we'll get you to the right test to show you exactly where you stand right now.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mt-3">
                Answer 20 adaptive questions in <span className="font-semibold">{DIALECT_LABELS[activeDialect]}</span> to find your CEFR level for this dialect. Your placement is tracked separately for each dialect.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-primary">20</p>
                <p className="text-xs text-muted-foreground">Questions</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-primary">~5 min</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 w-full">
              <Button onClick={startQuiz} disabled={loading} className="w-full h-12 text-base">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Start Quiz"}
              </Button>
              <Button variant="ghost" onClick={() => navigate(-1)} className="text-muted-foreground">
                Go Back
              </Button>
            </div>
          </div>
        )}

        {/* ─── QUIZ ─── */}
        {phase === "quiz" && (
          <div className="flex-1 flex flex-col animate-in fade-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Question {globalQuestionNum} / {TOTAL_QUESTIONS}
              </p>
              {/* English is feedback, not a hint: it appears only after the
                  answer is in. Mid-question it would let the learner answer
                  from the translations, and an English-assisted placement
                  over-places — the level this quiz writes anchors content
                  selection everywhere. */}
              <div className="flex items-center gap-2" title="Show English after answering">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <Switch
                  checked={showEnglish}
                  onCheckedChange={setShowEnglish}
                  aria-label="Show English after answering"
                />
              </div>
            </div>
            <Progress value={(answers.length / TOTAL_QUESTIONS) * 100} className="h-2 mb-6" />

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                  <p className="text-sm text-muted-foreground">Loading next questions…</p>
                </div>
              </div>
            ) : currentQuestion ? (
              <div className="flex-1 flex flex-col" key={`${answers.length}-${currentIndex}`}>
                {/* Skill badge + difficulty */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1 rounded-full capitalize">
                    <SkillIcon className="h-3.5 w-3.5" />
                    {currentQuestion.skill_type}
                  </span>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
                    {currentQuestion.difficulty}
                  </span>
                </div>

                {/* Question */}
                <div className="bg-card border border-border rounded-2xl p-5 mb-6">
                  {isListening(currentQuestion.skill_type) && !showFeedback ? (
                    <ListeningPrompt
                      text={currentQuestion.question_arabic}
                      dialect={activeDialect}
                    />
                  ) : (
                    <p className="text-xl font-semibold text-foreground leading-relaxed" dir="rtl">
                      {currentQuestion.question_arabic}
                    </p>
                  )}
                  {showEnglish && showFeedback && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {currentQuestion.question_english}
                    </p>
                  )}
                  {/* Held back until the answer is in — this is a placement
                      test, and an explainer mid-question would skew the level. */}
                  {showFeedback && (
                    <div className="mt-3">
                      <AskAISentence
                        arabic={currentQuestion.question_arabic}
                        english={currentQuestion.question_english}
                        variant="chip"
                      />
                    </div>
                  )}
                </div>

                {/* Choices */}
                <div className="space-y-3 flex-1">
                  {currentQuestion.choices.map((choice, idx) => {
                    const isSelected = selectedChoice === idx;
                    const isCorrect = idx === currentQuestion.correct_index;
                    let borderClass = "border-border bg-card hover:border-primary/40";
                    if (showFeedback) {
                      if (isCorrect) borderClass = "border-green-500 bg-green-50 dark:bg-green-950/30";
                      else if (isSelected && !isCorrect) borderClass = "border-destructive bg-red-50 dark:bg-red-950/30";
                      else borderClass = "border-border bg-card opacity-50";
                    } else if (isSelected) {
                      borderClass = "border-primary bg-primary/5";
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(idx)}
                        disabled={showFeedback || selectedChoice !== null}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 text-left",
                          borderClass
                        )}
                      >
                        <span className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground" dir="rtl">
                            {choice.text_arabic}
                          </p>
                          {showEnglish && showFeedback && (
                            <p className="text-sm text-muted-foreground">{choice.text}</p>
                          )}
                        </div>
                        {showFeedback && isCorrect && (
                          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                        )}
                        {showFeedback && isSelected && !isCorrect && (
                          <XCircle className="h-5 w-5 text-destructive shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              // A batch fetch failed mid-run: without this the learner sat on
              // a blank pane with their 20-question run half done.
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <p className="font-medium text-foreground">Couldn&apos;t load the next questions</p>
                  <p className="text-sm text-muted-foreground">Your answers so far are safe.</p>
                  <Button
                    onClick={async () => {
                      const batch = await fetchBatch(answers.length, answers);
                      if (batch) {
                        setQuestions(batch);
                        setCurrentIndex(0);
                      }
                    }}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── RESULTS ─── */}
        {phase === "results" && results && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
            <div className="bg-primary/10 rounded-full p-6">
              <CheckCircle2 className="h-12 w-12 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Your level is</p>
              <h1 className="text-5xl font-bold font-heading text-primary mb-2">
                {results.cefr_level}
              </h1>
              <p className="text-lg font-semibold text-foreground">
                {CEFR_DESCRIPTIONS[results.cefr_level]?.label || results.cefr_level}
              </p>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                {CEFR_DESCRIPTIONS[results.cefr_level]?.desc}
              </p>
            </div>

            {/* Score breakdown */}
            <div className="w-full max-w-sm space-y-3">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Confidence</p>
                <Progress value={results.confidence} className="h-2 mb-1" />
                <p className="text-xs text-muted-foreground text-right">{results.confidence}%</p>
              </div>

              {results.strengths.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-foreground mb-2">💪 Strengths</p>
                  <div className="flex flex-wrap gap-2">
                    {results.strengths.map((s) => (
                      <span
                        key={s}
                        className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs px-2.5 py-1 rounded-full capitalize"
                      >
                        {s.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {results.weaknesses.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-foreground mb-2">📈 Areas to improve</p>
                  <div className="flex flex-wrap gap-2">
                    {results.weaknesses.map((w) => (
                      <span
                        key={w}
                        className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs px-2.5 py-1 rounded-full capitalize"
                      >
                        {w.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 w-full max-w-sm">
              <Button onClick={saveAndContinue} disabled={saving} className="w-full h-12 text-base">
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Start Learning <ArrowRight className="h-5 w-5 ml-1" />
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPhase("intro");
                  setResults(null);
                  setAnswers([]);
                  setQuestions([]);
                }}
                className="text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Retake Quiz
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
