import { useState, useEffect, useRef, useCallback } from "react";
import { fetchSpeechBlob } from "@/lib/speakArabic";
import { useDialect } from "@/contexts/DialectContext";

type DialectHint = "Gulf" | "Egyptian" | "Yemeni" | string | null | undefined;

interface UseAzureTTSOptions {
  /** The Arabic text to synthesise. */
  text: string;
  /** Whether to skip generation (e.g. when a stored audio_url exists). */
  skip?: boolean;
  /**
   * Optional dialect hint. Falls back to the global active dialect. The server
   * decides which provider and voice serve that dialect — this is only the
   * question, never the answer.
   */
  dialect?: DialectHint;
  /**
   * Optional explicit Azure voice name (e.g. "ar-SA-HamedNeural").
   *
   * An escape hatch for the rare caller that needs one specific voice rather
   * than "whatever this dialect sounds like". Setting it bypasses dialect
   * routing entirely and calls `azure-tts` directly.
   */
  voice?: string;
  /**
   * Optional callback invoked once per successful generation with the raw
   * audio blob. Call sites use this to upload the blob to storage and
   * persist a URL on the flashcard so we never re-synthesize the same text.
   * Errors thrown by the callback are caught and logged.
   */
  persist?: (blob: Blob) => Promise<void> | void;
}

interface UseAzureTTSResult {
  /** Blob URL of the generated audio, or null while loading / on error. */
  ttsUrl: string | null;
  /** True while the TTS request is in flight. */
  isLoading: boolean;
  /** Re-trigger generation (e.g. after an error). */
  regenerate: () => void;
}

/**
 * Hook that generates speech from Arabic text.
 *
 * Posts `{ text, dialect }` to `tts-speak`, which resolves the provider and
 * voice server-side — so a dialect's voice can be changed with a secret rather
 * than a frontend deploy, and the six call sites that used to each carry their
 * own dialect→voice table can no longer disagree.
 *
 * Returns a stable blob URL that is automatically revoked on unmount or when
 * the text/dialect changes. Skips the request when `skip` is true.
 *
 * The request itself belongs to `src/lib/speakArabic.ts`, which is also where
 * the serial queue lives. For a passage read one line at a time — where the
 * text to say is chosen by a tap rather than known on mount — `useLineAudio`
 * is the hook, over the same door.
 */

export function useAzureTTS({ text, skip = false, dialect, voice, persist }: UseAzureTTSOptions): UseAzureTTSResult {
  const { activeDialect } = useDialect();
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  // Latest persist callback — read inside generate() so we don't restart on
  // identity changes of the function passed in by the caller.
  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; }, [persist]);

  // Explicit `dialect` prop wins; otherwise the global active dialect.
  const effectiveDialect = dialect ?? activeDialect;

  const revokePreviousUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const generate = useCallback(async (reqId: number) => {
    setIsLoading(true);
    try {
      const blob = await fetchSpeechBlob({
        text,
        dialect: voice ? undefined : effectiveDialect,
        voice,
      });

      if (reqId !== requestIdRef.current) return;

      if (blob) {
        revokePreviousUrl();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setTtsUrl(url);
        // Persist to storage so we never resynthesize this text again.
        const cb = persistRef.current;
        if (cb) {
          Promise.resolve()
            .then(() => cb(blob))
            .catch((err) => console.error("TTS persist failed:", err));
        }
      }
    } catch (err) {
      console.error("TTS generation failed:", err);
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [text, effectiveDialect, voice, revokePreviousUrl]);

  useEffect(() => {
    if (skip || !text) {
      revokePreviousUrl();
      setTtsUrl(null);
      return;
    }

    const reqId = ++requestIdRef.current;
    generate(reqId);

    return () => {
      requestIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, skip, effectiveDialect, voice]);

  useEffect(() => {
    return () => {
      revokePreviousUrl();
    };
  }, [revokePreviousUrl]);

  const regenerate = useCallback(() => {
    const reqId = ++requestIdRef.current;
    generate(reqId);
  }, [generate]);

  return { ttsUrl, isLoading, regenerate };
}
