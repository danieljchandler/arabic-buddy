import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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

// Hard ceiling on any single TTS request. Also the safety valve for the serial
// queue below — see tryFetch for why an unbounded request is dangerous.
const TTS_FETCH_TIMEOUT_MS = 12_000;

// Module-level serial queue. Munsit's plan caps concurrent requests (and we want
// to avoid 429s entirely), so every routed TTS fetch is funnelled through a
// single-slot mutex.
//
// This used to be applied only to dialects the client believed were Munsit-bound.
// The client no longer knows — and no longer should — so it applies to all of
// them. Every dialect routes to Munsit now anyway; on the rare Azure fallback the
// only cost is a little unnecessary serialization, never a wrong result.
let ttsChain: Promise<unknown> = Promise.resolve();
function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const next = ttsChain.then(task, task);
  ttsChain = next.catch(() => {});
  return next;
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
 */

// Both TTS functions answer 401 to a signed-out visitor. The speaker buttons
// used to fail silently; one notice per minute says what is needed.
let signInNoticeAt = 0;
function noteSignInNeeded() {
  const now = Date.now();
  if (now - signInNoticeAt < 60_000) return;
  signInNoticeAt = now;
  toast("Sign in to hear pronunciation", { description: "Native-speaker audio is generated per learner.", id: "tts-sign-in" });
}

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
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? anonKey;

      // Always bound the request. Calls are serialized through a single-slot
      // module mutex (runSerial); without a timeout a single hung fetch would
      // leave that chain pending forever and deadlock ALL TTS for the rest of
      // the session. The abort guarantees the task settles.
      const tryFetch = async (fnName: string, body: Record<string, unknown>) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);
        try {
          return await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: anonKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      let response = voice
        ? await tryFetch("azure-tts", { text, voice })
        : await runSerial(() => tryFetch("tts-speak", { text, dialect: effectiveDialect }));

      // A JSON body on a 200 is an error envelope, not audio. Also covers the
      // window before tts-speak is deployed, where the call 404s.
      const isAudio = (res: Response) =>
        res.ok && (res.headers.get("content-type") ?? "").startsWith("audio/");

      if (!isAudio(response) && !voice) {
        console.warn(`tts-speak unavailable (${response.status}); falling back to azure-tts`);
        response = await tryFetch("azure-tts", { text });
      }

      if (reqId !== requestIdRef.current) return;

      if (response.status === 401) noteSignInNeeded();

      if (isAudio(response)) {
        const blob = await response.blob();
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
