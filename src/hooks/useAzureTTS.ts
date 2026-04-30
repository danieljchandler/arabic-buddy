import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type DialectHint = "Gulf" | "Egyptian" | "Yemeni" | string | null | undefined;

interface UseAzureTTSOptions {
  /** The Arabic text to synthesise. */
  text: string;
  /** Whether to skip generation (e.g. when a stored audio_url exists). */
  skip?: boolean;
  /**
   * Optional dialect hint. When set to "Gulf" (or any Gulf country —
   * Saudi/Kuwaiti/UAE/Bahraini/Qatari/Omani), playback is routed through
   * Munsit's Arabic-native voice instead of Azure for higher fidelity on
   * Khaleeji pronunciation. All other dialects continue to use Azure.
   */
  dialect?: DialectHint;
}

interface UseAzureTTSResult {
  /** Blob URL of the generated audio, or null while loading / on error. */
  ttsUrl: string | null;
  /** True while the TTS request is in flight. */
  isLoading: boolean;
  /** Re-trigger generation (e.g. after an error). */
  regenerate: () => void;
}

const GULF_DIALECT_LABELS = new Set([
  "gulf", "khaleeji",
  "saudi", "kuwaiti", "uae", "emirati", "bahraini", "qatari", "omani",
]);

function isGulf(dialect: DialectHint): boolean {
  if (!dialect) return false;
  return GULF_DIALECT_LABELS.has(String(dialect).toLowerCase());
}

/**
 * Hook that generates speech from Arabic text via the appropriate TTS edge
 * function: `munsit-tts` for Gulf words (Arabic-native voice), `azure-tts`
 * for everything else.
 *
 * Returns a stable blob URL that is automatically revoked on unmount or when
 * the text/dialect changes.  Skips the request when `skip` is true.
 */
export function useAzureTTS({ text, skip = false, dialect }: UseAzureTTSOptions): UseAzureTTSResult {
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const useMunsit = isGulf(dialect);

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

      const endpoint = useMunsit ? "munsit-tts" : "azure-tts";

      const tryFetch = (fnName: string) => fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify({ text }),
      });

      let response = await tryFetch(endpoint);

      // If Munsit fails (e.g. quota / cold-start), fall back to Azure transparently.
      if (!response.ok && useMunsit) {
        console.warn(`munsit-tts failed (${response.status}); falling back to azure-tts`);
        response = await tryFetch("azure-tts");
      }

      if (reqId !== requestIdRef.current) return;

      if (response.ok) {
        const blob = await response.blob();
        revokePreviousUrl();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setTtsUrl(url);
      }
    } catch (err) {
      console.error("TTS generation failed:", err);
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [text, useMunsit, revokePreviousUrl]);

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
  }, [text, skip, useMunsit]);

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

