import { useCallback, useEffect, useRef, useState } from "react";

/** Whether this device can record a take at all. */
export function recordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface TakeRecorderOptions {
  /** A recorder left running is a microphone left open; the take stops itself here. */
  maxDurationMs?: number;
  /** Called once per take with the recorded audio. Empty takes are dropped. */
  onTake: (blob: Blob) => void | Promise<void>;
}

/**
 * One short take from the microphone.
 *
 * The MediaRecorder dance — ask for the mic, pick a container the browser can
 * write, collect chunks, stop the tracks so the recording light goes off, cap
 * the duration — was inlined in `PronunciationButton` and is needed again by
 * the quiz's speaking cards. The hook owns the recorder and reports two
 * things the card renders: whether it is listening, and why it could not.
 */
export function useTakeRecorder({ maxDurationMs = 5000, onTake }: TakeRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onTakeRef = useRef(onTake);
  onTakeRef.current = onTake;

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
    setIsRecording(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    chunksRef.current = [];
    if (!recordingSupported()) {
      setError("Recording isn't available on this device.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = "audio/webm;codecs=opus";
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(preferred)
          ? preferred
          : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) void onTakeRef.current(blob);
      };

      recorder.start();
      setIsRecording(true);
      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, maxDurationMs);
      return true;
    } catch {
      setError("Microphone access was refused.");
      setIsRecording(false);
      return false;
    }
  }, [maxDurationMs]);

  // Leaving the card mid-take must not leave the microphone open.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") recorder.stop();
    },
    [],
  );

  return { isRecording, start, stop, error, supported: recordingSupported() };
}
