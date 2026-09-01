import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { PageCorner } from "@/components/shell/PageCorner";
import { useAuth } from "@/hooks/useAuth";
import { gradeDictation, type DictationWord } from "@/lib/dictation";
import { useAddXP } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { useUserLevel } from "@/hooks/useUserLevel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { Switch } from "@/components/ui/switch";
import type { Database } from "@/integrations/supabase/types";

type ListeningExercise = Database['public']['Tables']['listening_exercises']['Row'];
import {
  Headphones,
  Play,
  Volume2,
  Check,
  X,
  RotateCcw,
  Zap,
  BookOpen,
  PenLine,
  Loader2,
  ChevronRight,
  Languages,
} from "lucide-react";

type Mode = "dictation" | "comprehension" | "speed";

interface Question {
  type: Mode;
  audioText: string;
  audioTextTransliteration?: string;
  audioTextEnglish: string;
  options?: { text: string; textArabic: string; correct: boolean }[];
  hint?: string;
}

const SPEED_RATES = [
  { value: 0.7, label: "0.7x", xp: 5 },
  { value: 1.0, label: "1x", xp: 10 },
  { value: 1.25, label: "1.25x", xp: 15 },
  { value: 1.5, label: "1.5x", xp: 20 },
];

const ListeningPractice = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { difficulty: userDifficulty } = useUserLevel();
  const addXP = useAddXP();

  // Restore persisted session
  const [savedSession] = useState<{ mode: Mode; questions: Question[]; currentIndex: number; speedRate: number; score: number; totalAnswered: number } | null>(() => {
    try {
      const raw = localStorage.getItem('session_listening_practice');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_listening_practice');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [mode, setMode] = useState<Mode | null>(savedSession?.mode ?? null);
  const [questions, setQuestions] = useState<Question[]>(savedSession?.questions ?? []);
  const [currentIndex, setCurrentIndex] = useState(savedSession?.currentIndex ?? 0);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  // Per-word marks from the last dictation grade, for the result panel.
  const [dictationWords, setDictationWords] = useState<DictationWord[] | null>(null);
  const [speedRate, setSpeedRate] = useState(savedSession?.speedRate ?? 1.0);
  const [score, setScore] = useState(savedSession?.score ?? 0);
  const [totalAnswered, setTotalAnswered] = useState(savedSession?.totalAnswered ?? 0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);

  // Persist session state
  useEffect(() => {
    if (questions.length === 0) return;
    try {
      const entry = {
        data: { mode, questions, currentIndex, speedRate, score, totalAnswered },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_listening_practice', JSON.stringify(entry));
    } catch { /* persist is best-effort — no action needed on failure */ }
  }, [mode, questions, currentIndex, speedRate, score, totalAnswered]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentQuestion = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;

  usePageAiContext(
    useMemo(
      () =>
        currentQuestion
          ? {
              kind: "drill" as const,
              title: "Listening practice",
              summary: `A ${mode ?? "listening"} exercise: the learner hears spoken ${activeDialect} Arabic and types or picks what it means.`,
              // Only meaningful once the answer is on screen; before that the
              // assistant would be handing over the answer.
              content: showResult
                ? `Audio line: ${currentQuestion.audioText}${
                    currentQuestion.audioTextEnglish
                      ? ` — ${currentQuestion.audioTextEnglish}`
                      : ""
                  }`
                : undefined,
              position: { index: currentIndex + 1, total: questions.length },
              meta: {
                dialect: activeDialect,
                notes: showResult
                  ? undefined
                  : ["The learner has not answered this one yet — do not give away what the audio says."],
              },
            }
          : null,
      [currentQuestion, mode, showResult, activeDialect, currentIndex, questions.length],
    ),
  );

  const startSession = async (selectedMode: Mode) => {
    setMode(selectedMode);
    setLoading(true);
    setCurrentIndex(0);
    setScore(0);
    setTotalAnswered(0);
    setShowResult(false);
    setAnswer("");

    try {
      // Try pre-approved content first — scoped to the active dialect. This
      // is the highest-quality path, and unfiltered it was the one that could
      // hand a Yemeni learner Egyptian audio; a thin pool falls through to
      // AI generation below, which already targets the dialect.
      const { data: approved } = await supabase
        .from("listening_exercises")
        .select("*")
        .eq("status", "published")
        .eq("mode", selectedMode)
        .eq("dialect", activeDialect)
        .limit(10);

      if (approved && approved.length >= 3) {
        const shuffled = (approved as ListeningExercise[]).sort(() => Math.random() - 0.5).slice(0, 5);
        setQuestions(shuffled.map((ex) => ({
          type: selectedMode,
          audioText: ex.audio_text,
          audioTextEnglish: ex.audio_text_english,
          options: ex.questions as Question['options'],
          hint: ex.hint ?? undefined,
        })));
        return;
      }

      // Fallback to live AI generation. The learner's vocabulary is assembled
      // server-side from real SRS state — the client used to send 30 shuffled
      // curriculum words labelled "words the student knows", which was
      // misinformation, not personalisation.
      const { data, error } = await supabase.functions.invoke("listening-quiz", {
        body: {
          mode: selectedMode,
          count: 5,
          dialect: activeDialect,
          difficulty: userDifficulty,
        },
      });

      if (error) throw error;

      if (data.questions && data.questions.length > 0) {
        setQuestions(data.questions);
      } else {
        throw new Error("No questions generated");
      }
    } catch (e) {
      console.error("Failed to load questions:", e);
      toast.error("Failed to load questions. Please try again.");
      setMode(null);
    } finally {
      setLoading(false);
    }
  };

  const playAudio = useCallback(async () => {
    if (!currentQuestion || audioPlaying) return;

    setAudioPlaying(true);

    try {
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      // The session token, not the anon key. The daily cap resolves a *user*
      // from this header and the anon key has none, so every call here answered
      // 401 — a listening exercise that could not play its audio.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? anonKey;

      // Sends the dialect, so a Yemeni or Egyptian learner hears their own
      // dialect. Omitting it fell through to the Gulf default for everyone.
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tts-speak`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: currentQuestion.audioText,
            dialect: activeDialect,
          }),
        }
      );

      if (!response.ok) throw new Error(`tts-speak error: ${response.status}`);

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.playbackRate = speedRate;
      audioRef.current = audio;

      audio.onended = () => {
        setAudioPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setAudioPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      try {
        await audio.play();
      } catch (playErr) {
        console.warn("Audio play failed:", playErr);
        setAudioPlaying(false);
        URL.revokeObjectURL(audioUrl);
      }
    } catch (e) {
      console.error("Audio playback failed:", e);
      toast.error("Could not play audio");
      setAudioPlaying(false);
    }
  }, [currentQuestion, speedRate, audioPlaying, activeDialect]);

  const checkDictationAnswer = () => {
    if (!currentQuestion) return;

    // Graded on normalized Arabic (harakat, hamza carriers, ى/ة variants and
    // punctuation all compare equal) with per-word marking — a learner who
    // types بيت against بَيت is right, and a wrong answer shows which word
    // missed. See lib/dictation.ts.
    const grade = gradeDictation(answer, currentQuestion.audioText);
    const correct = grade.correct;
    setDictationWords(grade.words);
    setIsCorrect(correct);
    setShowResult(true);
    setTotalAnswered((prev) => prev + 1);

    if (correct) {
      setScore((prev) => prev + 1);
      const xpAmount = mode === "speed" ? SPEED_RATES.find((r) => r.value === speedRate)?.xp || 10 : 10;
      if (isAuthenticated) {
        addXP.mutate({ amount: xpAmount, reason: "listening" });
      }
    }
  };

  const checkComprehensionAnswer = (optionIndex: number) => {
    if (!currentQuestion?.options) return;

    const selected = currentQuestion.options[optionIndex];
    const correct = selected.correct;

    setIsCorrect(correct);
    setShowResult(true);
    setTotalAnswered((prev) => prev + 1);

    if (correct) {
      setScore((prev) => prev + 1);
      if (isAuthenticated) {
        addXP.mutate({ amount: 10, reason: "listening" });
      }
    }
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowResult(false);
      setAnswer("");
      setDictationWords(null);
    } else {
      // Session complete
      toast.success(`Session complete! Score: ${score}/${questions.length}`);
    }
  };

  const resetSession = () => {
    setMode(null);
    setQuestions([]);
    setCurrentIndex(0);
    setScore(0);
    setTotalAnswered(0);
    setShowResult(false);
    setAnswer("");
    setDictationWords(null);
  };

  // Mode selection screen
  if (!mode) {
    return (
      <AppShell>
        <PageCorner />
        <div className="py-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Headphones className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2 justify-center">Listening Practice <InfoHint {...PAGE_HINTS["listening-practice"]} size="md" /></h1>
            <p className="text-muted-foreground">Train your ear with Arabic audio exercises</p>
          </div>

          <div className="space-y-3">
            {/* Dictation Mode */}
            <button
              onClick={() => startSession("dictation")}
              disabled={loading}
              className={cn(
                "w-full p-4 rounded-xl text-left",
                "bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20",
                "flex items-center gap-4",
                "transition-all duration-200",
                "hover:border-blue-500/40 active:scale-[0.99]",
                "disabled:opacity-50"
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                <PenLine className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground">Dictation</p>
                <p className="text-sm text-muted-foreground">Listen and type what you hear</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>

            {/* Comprehension Mode */}
            <button
              onClick={() => startSession("comprehension")}
              disabled={loading}
              className={cn(
                "w-full p-4 rounded-xl text-left",
                "bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20",
                "flex items-center gap-4",
                "transition-all duration-200",
                "hover:border-purple-500/40 active:scale-[0.99]",
                "disabled:opacity-50"
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                <BookOpen className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground">Comprehension</p>
                <p className="text-sm text-muted-foreground">Answer questions about what you hear</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>

            {/* Speed Mode */}
            <button
              onClick={() => startSession("speed")}
              disabled={loading}
              className={cn(
                "w-full p-4 rounded-xl text-left",
                "bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/20",
                "flex items-center gap-4",
                "transition-all duration-200",
                "hover:border-orange-500/40 active:scale-[0.99]",
                "disabled:opacity-50"
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                <Zap className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground">Speed Drill</p>
                <p className="text-sm text-muted-foreground">Fast-paced listening at variable speeds</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
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
  if (loading || !currentQuestion) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  // Session complete
  if (currentIndex >= questions.length - 1 && showResult) {
    return (
      <AppShell>
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Session Complete!</h1>
          <div className="text-4xl font-bold text-primary">
            {score}/{questions.length}
          </div>
          <p className="text-muted-foreground">
            {score === questions.length
              ? "Perfect! You're a listening pro! 🎉"
              : score >= questions.length / 2
              ? "Great job! Keep practicing! 👍"
              : "Keep it up! Practice makes perfect! 💪"}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={resetSession}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button onClick={() => navigate("/")}>Done</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={resetSession}>
          <X className="h-4 w-4 mr-1" />
          Exit
        </Button>
        <Badge variant="secondary">
          {currentIndex + 1}/{questions.length}
        </Badge>
        <div className="flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">EN</span>
          <Switch checked={showEnglish} onCheckedChange={setShowEnglish} className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4" />
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={progress} className="h-2 mb-6" />

      {/* Speed selector for speed mode */}
      {mode === "speed" && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Playback Speed</span>
            <span className="font-medium text-primary">+{SPEED_RATES.find((r) => r.value === speedRate)?.xp} XP</span>
          </div>
          <div className="flex gap-2">
            {SPEED_RATES.map((rate) => (
              <button
                key={rate.value}
                onClick={() => setSpeedRate(rate.value)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
                  speedRate === rate.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {rate.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main question area */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
        {/* Play button */}
        <div className="flex justify-center">
          <button
            onClick={playAudio}
            disabled={audioPlaying}
            className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center transition-all",
              audioPlaying
                ? "bg-primary/20 animate-pulse"
                : "bg-primary hover:bg-primary/90 active:scale-[0.98]"
            )}
          >
            {audioPlaying ? (
              <Volume2 className="h-10 w-10 text-primary animate-pulse" />
            ) : (
              <Play className="h-10 w-10 text-primary-foreground ml-1" />
            )}
          </button>
        </div>

        <p className="text-center text-muted-foreground">
          {mode === "dictation"
            ? "Listen and type the Arabic text"
            : mode === "comprehension"
            ? "Listen and answer the question"
            : "Listen at increased speed and type what you hear"}
        </p>

        {/* Answer area */}
        {(mode === "dictation" || mode === "speed") && (
          <div className="space-y-4">
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="اكتب هنا..."
              className="text-2xl text-center h-16 font-arabic"
              dir="rtl"
              disabled={showResult}
            />

            {currentQuestion.hint && !showResult && (
              <p className="text-center text-sm text-muted-foreground">
                Hint: starts with "{currentQuestion.hint}"
              </p>
            )}

            {!showResult ? (
              <Button
                onClick={checkDictationAnswer}
                className="w-full"
                disabled={!answer.trim()}
              >
                Check Answer
              </Button>
            ) : (
              <div className="space-y-4">
                <div
                  className={cn(
                    "p-4 rounded-xl text-center",
                    isCorrect ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"
                  )}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {isCorrect ? (
                      <Check className="h-5 w-5 text-green-600" />
                    ) : (
                      <X className="h-5 w-5 text-red-600" />
                    )}
                    <span className={isCorrect ? "text-green-600" : "text-red-600"}>
                      {isCorrect ? "Correct!" : "Not quite"}
                    </span>
                  </div>
                  {/* On a miss, show which words matched and which didn't —
                      "Not quite" alone teaches nothing. Marks come from the
                      normalized grade, so a harakat-only difference is green. */}
                  <p className="text-2xl font-arabic mb-1" dir="rtl">
                    {!isCorrect && dictationWords
                      ? dictationWords.map((w, i) => (
                          <span key={i}>
                            {i > 0 && " "}
                            <span className={w.ok ? undefined : "text-red-600 underline decoration-red-400/60 underline-offset-4"}>
                              {w.word}
                            </span>
                          </span>
                        ))
                      : currentQuestion.audioText}
                  </p>
                  {currentQuestion.audioTextTransliteration && (
                    <p className="text-sm text-muted-foreground italic mb-1">
                      {currentQuestion.audioTextTransliteration}
                    </p>
                  )}
                  {showEnglish && (
                    <p className="text-sm text-muted-foreground animate-in fade-in duration-200">
                      {currentQuestion.audioTextEnglish}
                    </p>
                  )}
                  <div className="mt-2 flex justify-center">
                    <AskAISentence
                      arabic={currentQuestion.audioText}
                      english={currentQuestion.audioTextEnglish}
                      variant="chip"
                    />
                  </div>
                </div>

                <Button onClick={nextQuestion} className="w-full">
                  {currentIndex < questions.length - 1 ? "Next" : "Finish"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Comprehension options */}
        {mode === "comprehension" && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option, i) => (
              <button
                key={i}
                onClick={() => !showResult && checkComprehensionAnswer(i)}
                disabled={showResult}
                className={cn(
                  "w-full p-4 rounded-xl text-left transition-all",
                  "border-2",
                  showResult
                    ? option.correct
                      ? "border-green-500 bg-green-500/10"
                      : "border-border bg-muted/50"
                    : "border-border hover:border-primary/50 bg-card"
                )}
              >
                <p className="font-medium">{option.text}</p>
              </button>
            ))}

            {showResult && (
              <div className="pt-4">
                {showEnglish && (
                  <p className="text-center text-sm text-muted-foreground mb-2 animate-in fade-in duration-200">
                    "{currentQuestion.audioTextEnglish}"
                  </p>
                )}
                <div className="mb-3 flex justify-center">
                  <AskAISentence
                    arabic={currentQuestion.audioText}
                    english={currentQuestion.audioTextEnglish}
                    variant="chip"
                  />
                </div>
                <Button onClick={nextQuestion} className="w-full">
                  {currentIndex < questions.length - 1 ? "Next" : "Finish"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default ListeningPractice;
