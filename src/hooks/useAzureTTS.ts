import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseAzureTTSOptions {
  /** The Arabic text to synthesise. */
  text: string;
  /** Whether to skip generation (e.g. when a stored audio_url exists). */
  skip?: boolean;
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
 * Hook that generates speech from Arabic text via the azure-tts edge function.
 *
 * Returns a stable blob URL that is automatically revoked on unmount or when
 * the text changes.  Skips the request when `skip` is true (e.g. when the
 * word already has a stored audio_url).
 *
 * Usage:
 *   const { ttsUrl, isLoading } = useAzureTTS({
 *     text: word.word_arabic,
 *     skip: Boolean(word.audio_url),
 *   });
 *   const effectiveUrl = word.audio_url ?? ttsUrl;
 */
export function useAzureTTS({ text, skip = false }: UseAzureTTSOptions): UseAzureTTSResult {
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  // Monotonically increasing request id to guard against stale responses
  const requestIdRef = useRef(0);

  const revokePreviousUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const generate = useCallback(async (reqId: number) => {
    setIsLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? anonKey;

      const response = await fetch(`${supabaseUrl}/functions/v1/azure-tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify({ text }),
      });

      // Guard against stale responses when text changed while in flight
      if (reqId !== requestIdRef.current) return;

      if (response.ok) {
        const blob = await response.blob();
        revokePreviousUrl();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setTtsUrl(url);
      }
    } catch (err) {
      console.error("Azure TTS generation failed:", err);
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [text, revokePreviousUrl]);

  useEffect(() => {
    if (skip || !text) {
      revokePreviousUrl();
      setTtsUrl(null);
      return;
    }

    const reqId = ++requestIdRef.current;
    generate(reqId);

    return () => {
      // Bump the id so any in-flight request becomes stale
      requestIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, skip]);

  // Revoke blob URL on unmount
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
