import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAzurePronunciation,
  scoreBand,
  type WordResult,
} from "@/hooks/useAzurePronunciation";

interface PronunciationButtonProps {
  /** Arabic word/phrase the learner should say */
  word: string;
  /** BCP-47 locale, default ar-SA */
  locale?: string;
}

const MAX_DURATION_MS = 5000;

export const PronunciationButton = ({
  word,
  locale = "ar-SA",
}: PronunciationButtonProps) => {
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

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
          await assess(blob, word, locale);
        }
      };

      recorder.start();
      setIsRecording(true);

      // Auto-stop after MAX_DURATION_MS
      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, MAX_DURATION_MS);
    } catch {
      console.error("Microphone access denied");
    }
  }, [word, locale, assess, reset]);

  const handleTryAgain = () => {
    reset();
  };

  const band = result ? scoreBand(result.overall) : null;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Mic button */}
      {!result && !isLoading && (
        <Button
          variant="outline"
          size="sm"
          onClick={isRecording ? stopRecording : startRecording}
          className={`gap-2 ${isRecording ? "border-destructive text-destructive animate-pulse" : ""}`}
        >
          {isRecording ? (
            <>
              <MicOff className="h-4 w-4" />
              Stop
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              Say it 🎤
            </>
          )}
        </Button>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking pronunciation…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive text-center">
          {error}
          <Button variant="ghost" size="sm" onClick={handleTryAgain} className="ml-2">
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Retry
          </Button>
        </div>
      )}

      {/* Results */}
      {result && band && (
        <div className="w-full max-w-xs rounded-xl bg-card border border-border p-4 text-center animate-in fade-in duration-300">
          {/* Overall score */}
          <div className="mb-3">
            <span className={`text-3xl font-bold ${band.color}`}>
              {Math.round(result.overall)}
            </span>
            <span className="text-sm text-muted-foreground ml-1">/ 100</span>
          </div>
          <p className={`text-sm font-medium mb-3 ${band.color}`}>{band.label}</p>

          {/* Sub-scores */}
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-4">
            <div>
              <p className="font-medium text-foreground">{Math.round(result.accuracy)}</p>
              <p>Accuracy</p>
            </div>
            <div>
              <p className="font-medium text-foreground">{Math.round(result.fluency)}</p>
              <p>Fluency</p>
            </div>
            <div>
              <p className="font-medium text-foreground">{Math.round(result.completeness)}</p>
              <p>Complete</p>
            </div>
          </div>

          {/* Per-word breakdown */}
          {result.words.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mb-4" dir="rtl">
              {result.words.map((w: WordResult, i: number) => {
                const wb = scoreBand(w.accuracy);
                return (
                  <span
                    key={i}
                    className={`px-2 py-0.5 rounded-md text-sm font-medium bg-muted ${wb.color}`}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={handleTryAgain} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
};
