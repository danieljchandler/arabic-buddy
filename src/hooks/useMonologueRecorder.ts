/**
 * useMonologueRecorder — MediaRecorder wrapper for long-form speaking takes.
 *
 * The existing useShadowRecorder is built for two-to-six-second shadowing
 * clips: it auto-stops on 600ms of trailing silence, which is exactly the
 * behaviour a monologue must not have — a thinking pause is data for the
 * fluency metrics, not the end of the take. This recorder stops only when the
 * learner says so or the task's hard cap lands, and reports elapsed time so
 * the page can show how far into the target the learner is.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type MonologueStopReason = "manual" | "timeout" | "no-audio";

interface StartOptions {
  /** Hard cap in ms — the task's ceiling, not a target. */
  maxDurationMs: number;
  /** Called exactly once when recording ends. Null blob means nothing usable was captured. */
  onComplete: (blob: Blob | null, reason: MonologueStopReason, durationMs: number) => void;
}

/** RMS above this counts as the learner having actually spoken. */
const SPEECH_THRESHOLD = 0.02;

/** A take smaller than this can't contain speech worth transcribing. */
const MIN_BLOB_BYTES = 4096;

/** How often the elapsed clock updates. Coarse on purpose — it drives a timer display. */
const ELAPSED_TICK_MS = 250;

export function useMonologueRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechSeenRef = useRef(false);
  const startedAtRef = useRef(0);
  const stopReasonRef = useRef<MonologueStopReason>("manual");
  const onCompleteRef = useRef<StartOptions["onComplete"] | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = null;
    if (hardCapRef.current) clearTimeout(hardCapRef.current);
    hardCapRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback((reason: MonologueStopReason = "manual") => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      stopReasonRef.current = reason;
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(
    async ({ maxDurationMs, onComplete }: StartOptions) => {
      setError(null);
      setElapsedMs(0);
      speechSeenRef.current = false;
      stopReasonRef.current = "manual";
      chunksRef.current = [];
      onCompleteRef.current = onComplete;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        setPermissionDenied(false);

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const durationMs = Math.round(performance.now() - startedAtRef.current);
          const reason = stopReasonRef.current;
          const empty = !speechSeenRef.current || blob.size < MIN_BLOB_BYTES;
          cleanup();
          setIsRecording(false);
          onCompleteRef.current?.(empty ? null : blob, empty ? "no-audio" : reason, durationMs);
        };

        // Live RMS for the level meter, and for knowing speech happened at all.
        const Ctx: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyserRef.current = analyser;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        const meter = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 6));
          if (rms > SPEECH_THRESHOLD) speechSeenRef.current = true;
          rafRef.current = requestAnimationFrame(meter);
        };
        rafRef.current = requestAnimationFrame(meter);

        startedAtRef.current = performance.now();
        tickerRef.current = setInterval(() => {
          setElapsedMs(Math.round(performance.now() - startedAtRef.current));
        }, ELAPSED_TICK_MS);

        hardCapRef.current = setTimeout(() => stop("timeout"), maxDurationMs);

        // A timeslice so a minutes-long take is flushed as it goes rather than
        // held as one growing in-memory chunk.
        recorder.start(1000);
        setIsRecording(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const denied = /denied|permission|NotAllowed/i.test(msg);
        setPermissionDenied(denied);
        setError(denied ? "Microphone access denied" : msg);
        cleanup();
        setIsRecording(false);
      }
    },
    [cleanup, stop],
  );

  // Unmount is not a normal stop: drop the completion callback FIRST, so the
  // recorder's onstop cannot fire scoring calls for a page that no longer
  // exists (same hazard useShadowRecorder documents).
  useEffect(
    () => () => {
      onCompleteRef.current = null;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      cleanup();
    },
    [cleanup],
  );

  return { start, stop, isRecording, elapsedMs, level, error, permissionDenied };
}
