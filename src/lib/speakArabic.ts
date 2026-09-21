import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * One place that turns Arabic text into audio bytes.
 *
 * Every speaker button in the app ultimately arrives here. It exists as a
 * module rather than living inside `useAzureTTS` because the serial queue below
 * only works if there is exactly one of it: a second copy in a second hook
 * would quietly raise our concurrency against Munsit from one to two, which is
 * the thing the queue was written to prevent.
 *
 * Callers name a *dialect*, never a voice — `tts-speak` resolves the provider
 * and the voice server-side. `voice` is the escape hatch for the rare caller
 * that needs one specific Azure voice, and it bypasses that routing.
 */

// Hard ceiling on any single TTS request. Also the safety valve for the serial
// queue below — see `runSerial` for why an unbounded request is dangerous.
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

// Both TTS functions answer 401 to a signed-out visitor. The speaker buttons
// used to fail silently; one notice per minute says what is needed.
let signInNoticeAt = 0;
function noteSignInNeeded() {
  const now = Date.now();
  if (now - signInNoticeAt < 60_000) return;
  signInNoticeAt = now;
  toast("Sign in to hear pronunciation", {
    description: "Native-speaker audio is generated per learner.",
    id: "tts-sign-in",
  });
}

export interface SpeechRequest {
  /** The Arabic to synthesise. */
  text: string;
  /** Which dialect should be speaking. The server picks the voice. */
  dialect?: string | null;
  /** Explicit Azure voice name; set it and dialect routing is bypassed. */
  voice?: string;
  /** Aborts the request from the caller's side (navigation, a newer request). */
  signal?: AbortSignal;
}

/**
 * Synthesize `text` and return the audio, or null when the server answered
 * with something that is not audio (an error envelope, a 401, an undeployed
 * function). Network-level failures reject, as does an abort.
 */
export async function fetchSpeechBlob({
  text,
  dialect,
  voice,
  signal,
}: SpeechRequest): Promise<Blob | null> {
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
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    const timer = setTimeout(abort, TTS_FETCH_TIMEOUT_MS);
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
      signal?.removeEventListener("abort", abort);
    }
  };

  let response = voice
    ? await tryFetch("azure-tts", { text, voice })
    : await runSerial(() => tryFetch("tts-speak", { text, dialect }));

  // A JSON body on a 200 is an error envelope, not audio. Also covers the
  // window before tts-speak is deployed, where the call 404s.
  const isAudio = (res: Response) =>
    res.ok && (res.headers.get("content-type") ?? "").startsWith("audio/");

  if (!isAudio(response) && !voice) {
    console.warn(`tts-speak unavailable (${response.status}); falling back to azure-tts`);
    response = await tryFetch("azure-tts", { text });
  }

  if (response.status === 401) noteSignInNeeded();

  return isAudio(response) ? await response.blob() : null;
}
