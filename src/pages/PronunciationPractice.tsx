import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

import { useAzurePronunciation, scoreBand, type PronunciationResult, type WordResult } from "@/hooks/useAzurePronunciation";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, MicOff, RotateCcw, Loader2, ChevronRight, ChevronLeft, Volume2, Trophy, Target, ArrowRight, Languages } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRef } from "react";

const MAX_DURATION_MS = 5000;

const DIALECT_MAP: Record<string, string> = {
  Saudi: "ar-SA",
  Kuwaiti: "ar-KW",
  UAE: "ar-AE",
  Bahraini: "ar-BH",
  Qatari: "ar-QA",
  Omani: "ar-OM",
  Egyptian: "ar-EG",
  Levantine: "ar-JO",
  Gulf: "ar-SA",
  MSA: "ar-SA",
};

interface VocabWord {
  id: string;
  word_arabic: string;
  word_english: string;
  word_audio_url?: string | null;
  sentence_text?: string | null;
  sentence_english?: string | null;
}

const PronunciationPractice = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();

  const [words, setWords] = useState<VocabWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [mode, setMode] = useState<"word" | "sentence">("word");
  const [sessionScores, setSessionScores] = useState<number[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch user vocabulary words
  useEffect(() => {
    if (!user) return;

    const fetchWords = async () => {
      setWordsLoading(true);
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select("id, word_arabic, word_english, word_audio_url, sentence_text, sentence_english")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (data && !error) {
        setWords(data);
      }
      setWordsLoading(false);
    };

    fetchWords();
  }, [user]);

  const currentWord = words[currentIndex];
  const referenceText = mode === "sentence" && currentWord?.sentence_text
    ? currentWord.sentence_text
    : currentWord?.word_arabic || "";

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    clearTimeout(timerRef.current);
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    reset();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          const res = await assess(blob, referenceText, "ar-SA");
          if (res) {
            setSessionScores((prev) => [...prev, res.overall]);
          }
        }
      };

      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, MAX_DURATION_MS);
    } catch {
      console.error("Microphone access denied");
    }
  }, [referenceText, assess, reset]);

  const goToNext = () => {
    reset();
    setCurrentIndex((prev) => Math.min(prev + 1, words.length - 1));
  };

  const goToPrev = () => {
    reset();
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const playNativeAudio = () => {
    if (currentWord?.word_audio_url) {
      const audio = new Audio(currentWord.word_audio_url);
      audio.play();
    }
  };

  const sessionAverage =
    sessionScores.length > 0
      ? Math.round(sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length)
      : 0;

  const band = result ? scoreBand(result.overall) : null;

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Pronunciation Practice</h1>
          <p className="text-muted-foreground mb-6">Sign in to practice your Arabic pronunciation</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  if (wordsLoading) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (words.length === 0) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Pronunciation Practice</h1>
          <p className="text-muted-foreground mb-6">
            Add some words to your vocabulary first, then come back to practice!
          </p>
          <Button onClick={() => navigate("/my-words")}>Go to My Words</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6"><HomeButton /></div>

      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold font-heading mb-1">Pronunciation Practice</h1>
          <p className="text-sm text-muted-foreground">
            Word {currentIndex + 1} of {words.length}
          </p>
        </div>

        {/* Session stats bar */}
        {sessionScores.length > 0 && (
          <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-2 mb-6">
            <div className="flex items-center gap-2 text-sm">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Session avg:</span>
              <span className={cn("font-bold", scoreBand(sessionAverage).color)}>
                {sessionAverage}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4" />
              {sessionScores.length} attempts
            </div>
          </div>
        )}

        {/* Progress */}
        <Progress value={((currentIndex + 1) / words.length) * 100} className="mb-6 h-1.5" />

        {/* Mode toggle */}
        <div className="flex justify-center gap-2 mb-6">
          <Button
            variant={mode === "word" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("word"); reset(); }}
          >
            Word
          </Button>
          <Button
            variant={mode === "sentence" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("sentence"); reset(); }}
            disabled={!currentWord?.sentence_text}
          >
            Sentence
          </Button>
        </div>

        {/* Word card */}
        <div className="bg-card border-2 border-border rounded-2xl p-8 text-center mb-6">
          {/* Arabic text */}
          <p className="text-4xl font-bold mb-3 leading-relaxed" dir="rtl">
            {mode === "sentence" && currentWord?.sentence_text
              ? currentWord.sentence_text
              : currentWord?.word_arabic}
          </p>

          {/* English translation */}
          <p className="text-muted-foreground text-lg mb-4">
            {mode === "sentence" && currentWord?.sentence_english
              ? currentWord.sentence_english
              : currentWord?.word_english}
          </p>

          {/* Listen button */}
          {currentWord?.word_audio_url && mode === "word" && (
            <Button variant="ghost" size="sm" onClick={playNativeAudio} className="gap-2">
              <Volume2 className="h-4 w-4" />
              Listen first
            </Button>
          )}
        </div>

        {/* Recording area */}
        <div className="flex flex-col items-center gap-4 mb-6">
          {!result && !isLoading && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200",
                isRecording
                  ? "bg-destructive text-destructive-foreground animate-pulse scale-110 shadow-lg shadow-destructive/30"
                  : "bg-primary text-primary-foreground hover:scale-105 shadow-lg shadow-primary/30"
              )}
            >
              {isRecording ? (
                <MicOff className="h-8 w-8" />
              ) : (
                <Mic className="h-8 w-8" />
              )}
            </button>
          )}

          {!result && !isLoading && (
            <p className="text-sm text-muted-foreground">
              {isRecording ? "Tap to stop recording" : "Tap to record your pronunciation"}
            </p>
          )}

          {isLoading && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing pronunciation…</p>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive text-center">
              {error}
              <Button variant="ghost" size="sm" onClick={reset} className="ml-2">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        {result && band && (
          <div className="bg-card border-2 border-border rounded-2xl p-6 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Score circle */}
            <div className="text-center mb-4">
              <div className={cn(
                "inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-2",
                result.overall >= 90 ? "border-green-500" :
                result.overall >= 75 ? "border-blue-500" :
                result.overall >= 60 ? "border-yellow-500" : "border-red-500"
              )}>
                <span className={cn("text-3xl font-bold", band.color)}>
                  {Math.round(result.overall)}
                </span>
              </div>
              <p className={cn("text-lg font-semibold", band.color)}>{band.label}</p>
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Accuracy", value: result.accuracy },
                { label: "Fluency", value: result.fluency },
                { label: "Completeness", value: result.completeness },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-xl font-bold text-foreground">{Math.round(value)}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Per-word breakdown */}
            {result.words.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Word Breakdown
                </p>
                <div className="flex flex-wrap justify-center gap-2" dir="rtl">
                  {result.words.map((w: WordResult, i: number) => {
                    const wb = scoreBand(w.accuracy);
                    return (
                      <div
                        key={i}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-sm font-medium bg-muted border border-border",
                          wb.color
                        )}
                      >
                        <span>{w.word}</span>
                        <span className="text-xs ml-1 opacity-70">{Math.round(w.accuracy)}</span>
                        {w.errorType !== "None" && (
                          <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">
                            {w.errorType}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-1.5" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Try Again
              </Button>
              {currentIndex < words.length - 1 && (
                <Button className="flex-1 gap-1.5" onClick={goToNext}>
                  Next Word
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        {!result && (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToNext}
              disabled={currentIndex === words.length - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default PronunciationPractice;
