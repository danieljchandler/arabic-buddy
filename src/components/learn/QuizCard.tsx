import { useState, useMemo, useRef, useEffect } from "react";
import { CheckCircle2, XCircle, Volume2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface QuizCardWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
}

interface QuizCardProps {
  word: QuizCardWord;
  otherWords: QuizCardWord[];
  gradient?: string;
  onAnswer: (isCorrect: boolean) => void;
  /** Topic label to display as a tag */
  topicLabel?: string;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * QuizCard - Learning quiz with multiple choice
 *
 * Shows the Arabic word with an audio button and asks the user to pick the
 * correct English translation from four options.
 */
export const QuizCard = ({ word, otherWords, onAnswer, topicLabel }: QuizCardProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  // Prevent double-click / race-condition from advancing the quiz twice
  const answeredRef = useRef(false);
  // Reuse the same Audio instance so we can pause/clean up properly
  const audioInstanceRef = useRef<HTMLAudioElement | null>(null);
  // Track blob URLs we created so we can revoke them on unmount
  const blobUrlRef = useRef<string | null>(null);

  // Generate options only once per word (word.id and word.word_english always
  // change together so listing word.id alone is intentional)
  const options = useMemo(
    () => {
      const wrongAnswers = shuffleArray(otherWords)
        .filter(w => w.id !== word.id)
        .slice(0, 3)
        .map(w => w.word_english);
      return shuffleArray([word.word_english, ...wrongAnswers]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [word.id],
  );

  const effectiveAudioUrl = word.audio_url ?? generatedAudioUrl;

  // Generate audio via ElevenLabs TTS when no stored audio_url is available
  useEffect(() => {
    if (word.audio_url) return; // already have stored audio

    let cancelled = false;
    setIsGeneratingAudio(true);

    const generate = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token ?? anonKey;

        const response = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-tts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: anonKey,
          },
          body: JSON.stringify({ text: word.word_arabic }),
        });

        if (!cancelled && response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setGeneratedAudioUrl(url);
        }
      } catch (err) {
        // Audio generation failed – word is still readable without audio
        console.error("ElevenLabs TTS generation failed:", err);
      } finally {
        if (!cancelled) setIsGeneratingAudio(false);
      }
    };

    generate();

    return () => {
      cancelled = true;
    };
  }, [word.id, word.audio_url, word.word_arabic]);

  // Cleanup audio instance and blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioInstanceRef.current) {
        audioInstanceRef.current.pause();
        audioInstanceRef.current.onended = null;
        audioInstanceRef.current.onerror = null;
        audioInstanceRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const playAudio = (url: string) => {
    if (isPlaying) return;
    // Stop any currently playing instance
    if (audioInstanceRef.current) {
      audioInstanceRef.current.pause();
      audioInstanceRef.current.onended = null;
      audioInstanceRef.current.onerror = null;
    }
    setIsPlaying(true);
    const audio = new Audio(url);
    audioInstanceRef.current = audio;
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  };

  // Auto-play when the card first appears (after a short delay)
  useEffect(() => {
    answeredRef.current = false;
    const url = word.audio_url; // only auto-play if we already have the URL on mount
    if (!url) return;
    const timer = setTimeout(() => playAudio(url), 300);
    return () => clearTimeout(timer);
  }, [word.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also auto-play once on-demand generation finishes
  useEffect(() => {
    if (generatedAudioUrl && !answeredRef.current) {
      playAudio(generatedAudioUrl);
    }
  }, [generatedAudioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (answer: string) => {
    if (showResult || answeredRef.current) return;
    answeredRef.current = true;

    setSelectedAnswer(answer);
    const correct = answer === word.word_english;
    setIsCorrect(correct);
    setShowResult(true);

    setTimeout(() => {
      onAnswer(correct);
    }, 1500);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Topic Label */}
      {topicLabel && (
        <div className="mb-3 flex justify-center">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {topicLabel}
          </span>
        </div>
      )}

      {/* Question prompt */}
      <div className="text-center mb-4">
        <p className="text-sm text-muted-foreground">What does this mean in English?</p>
      </div>

      {/* Arabic word + audio button */}
      <div className="flex items-center justify-center gap-4 mb-8 p-6 rounded-2xl bg-card border border-border">
        <p className="text-5xl font-bold font-arabic leading-relaxed" dir="rtl">
          {word.word_arabic}
        </p>
        <button
          onClick={() => effectiveAudioUrl && playAudio(effectiveAudioUrl)}
          aria-label="Play pronunciation"
          className={cn(
            "flex-shrink-0 p-3 rounded-full border transition-all duration-200",
            "focus:outline-none focus:ring-2 focus:ring-primary/30",
            effectiveAudioUrl
              ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:scale-110"
              : "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed",
            isPlaying && "bg-primary text-primary-foreground border-primary animate-pulse"
          )}
          disabled={!effectiveAudioUrl && !isGeneratingAudio}
        >
          {isGeneratingAudio ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Volume2 className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Multiple Choice Options */}
      <div className="grid grid-cols-2 gap-2">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = option === word.word_english;

          let buttonStyle = "bg-card border border-border hover:border-primary/30";

          if (showResult) {
            if (isCorrectAnswer) {
              buttonStyle = "bg-success/10 border border-success";
            } else if (isSelected && !isCorrectAnswer) {
              buttonStyle = "bg-destructive/10 border border-destructive";
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleSelect(option)}
              disabled={showResult}
              className={cn(
                "p-3 rounded-lg text-sm transition-all duration-200",
                "flex items-center justify-center gap-2",
                buttonStyle
              )}
            >
              {showResult && isCorrectAnswer && (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
              {showResult && isSelected && !isCorrectAnswer && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-foreground">{option}</span>
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-4 p-3 rounded-lg text-center text-sm font-medium",
          "animate-in fade-in zoom-in-95 duration-300",
          isCorrect
            ? "bg-success/10 text-success"
            : "bg-destructive/10 text-destructive"
        )}>
          {isCorrect ? "Correct! أحسنت" : "Not quite — keep practicing"}
        </div>
      )}
    </div>
  );
};
