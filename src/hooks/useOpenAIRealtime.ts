// useOpenAIRealtime — manages an OpenAI Realtime API voice session via WebRTC.
// Flow:
//   1. Build a WebRTC SDP offer in the browser.
//   2. Create RTCPeerConnection, add mic track, attach <audio> sink for model voice,
//      open a data channel for JSON events.
//   3. Fetch a short-lived Realtime client secret from our edge function.
//   4. POST the raw SDP offer directly to OpenAI's /v1/realtime/calls with
//      the ephemeral key and apply the returned SDP answer.
//   5. Stream user + assistant transcripts from data-channel events.
//
// Drop-in replacement for useGeminiLive: same exported shape.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveStatus = "idle" | "connecting" | "live" | "ending" | "error";

interface LiveTurn {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
  hasDialectDrift?: boolean;
}

interface StartArgs {
  dialect: string;
  difficulty: string;
  topicHint?: string;
  /** "practice" (default) is the free conversation partner; "assistant" is the subscribers-only Ask AI voice. */
  mode?: "practice" | "assistant";
  /** Serialized page context for assistant mode, appended to the session instructions server-side. */
  context?: string;
}

interface Options {
  onTurnFinalized?: (turn: LiveTurn) => void;
  onDialectDrift?: (leaks: string[]) => void;
}

interface InternalLiveTurn extends LiveTurn {
  _id: string;
}

type RealtimeEvent = Record<string, unknown>;

interface ClientSecretResponse {
  value?: string;
  client_secret?: string | { value?: string };
  session_tracking_id?: string;
  max_session_minutes?: number;
  idle_timeout_minutes?: number;
}

const CLIENT_MSA_TOKENS: Record<string, string[]> = {
  Gulf: ['الآن', 'لماذا', 'أين', 'ماذا', 'سوف', 'ليس', 'يريد', 'أريد', 'كيف', 'إزيك', 'دلوقتي', 'عايز'],
  Egyptian: ['الآن', 'لماذا', 'أين', 'ماذا', 'سوف', 'ليس', 'يريد', 'أريد', 'كيف', 'شلونك', 'هالحين', 'يبي'],
  Yemeni: ['الآن', 'لماذا', 'أين', 'ماذا', 'سوف', 'ليس', 'يريد', 'أريد', 'إزيك', 'دلوقتي', 'هالحين', 'يبي'],
};

function detectLiveLeaks(text: string, dialect: string): string[] {
  if (!text) return [];
  const tokens = CLIENT_MSA_TOKENS[dialect] ?? CLIENT_MSA_TOKENS.Gulf;
  return tokens.filter((t) => text.includes(t));
}

function extractClientSecret(payload: ClientSecretResponse): string {
  if (typeof payload.value === "string") return payload.value;
  if (typeof payload.client_secret === "string") return payload.client_secret;
  if (typeof payload.client_secret?.value === "string") return payload.client_secret.value;
  return "";
}

export function useOpenAIRealtime(opts: Options = {}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<InternalLiveTurn[]>([]);
  const [muted, setMuted] = useState(false);
  /** Elapsed time in seconds; displayed as mm:ss countdown timer. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dialectRef = useRef<string>("Gulf");
  const endingRef = useRef(false);
  const sessionStartRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Session config: hard max 60 min, idle timeout 15 min.
  const SESSION_MAX_MINUTES = 60;
  const IDLE_TIMEOUT_MINUTES = 15;

  // Buffers per item_id so deltas concat cleanly.
  const userBufRef = useRef<Map<string, string>>(new Map());
  const assistantBufRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (micSenderRef.current?.track) {
      micSenderRef.current.track.enabled = !muted;
    }
  }, [muted]);

  const upsertTurn = useCallback((role: "user" | "assistant", id: string, text: string, partial: boolean) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t._id === id);
      const next: InternalLiveTurn = { role, text, partial, _id: id };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...next };
        return copy;
      }
      return [...prev, next];
    });
  }, []);

  const finalizeTurn = useCallback((role: "user" | "assistant", id: string, finalText: string) => {
    let drift = false;
    if (role === "assistant" && finalText) {
      const leaks = detectLiveLeaks(finalText, dialectRef.current);
      if (leaks.length > 0) {
        drift = true;
        opts.onDialectDrift?.(leaks);
      }
    }
    setTurns((prev) =>
      prev.map((t) =>
        t._id === id
          ? { ...t, text: finalText, partial: false, hasDialectDrift: drift }
          : t,
      ),
    );
    if (finalText.trim()) {
      opts.onTurnFinalized?.({ role, text: finalText, hasDialectDrift: drift });
    }
  }, [opts]);

  /** Reset idle timeout whenever activity is detected (user or assistant speaks). */
  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    // Idle timeout will be re-armed after stop() is called.
  }, []);

  const cleanup = useCallback(() => {
    // Stop timers first.
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    sessionStartRef.current = null;
    sessionIdRef.current = null;
    setElapsedSeconds(0);

    try { dcRef.current?.close(); } catch { /* noop */ }
    dcRef.current = null;
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    localStreamRef.current = null;
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
      } catch { /* noop */ }
      audioElRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* noop */ }
      audioCtxRef.current = null;
    }
    micSenderRef.current = null;
    userBufRef.current.clear();
    assistantBufRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    endingRef.current = true;
    setStatus("ending");

    // Log session end if we have a tracking ID and session duration.
    if (sessionIdRef.current && sessionStartRef.current) {
      const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      const trackingId = sessionIdRef.current;
      // Fire and forget — don't block on logging.
      const apiUrl = new URL(import.meta.env.VITE_SUPABASE_URL);
      fetch(`${apiUrl.protocol}//${apiUrl.host}/functions/v1/voice-session-end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          session_id: trackingId,
          duration_seconds: durationSeconds,
          close_reason: error ? "error" : "user_disconnected",
        }),
      }).catch((e) => {
        console.warn("[realtime] failed to log session end:", e);
      });
    }

    cleanup();
    setStatus("idle");
    endingRef.current = false;
  }, [cleanup, error]);

  const handleEvent = useCallback((evt: RealtimeEvent) => {
    const type = typeof evt.type === "string" ? evt.type : "";

    // User speech transcripts (Whisper).
    if (type === "conversation.item.input_audio_transcription.delta") {
      resetIdleTimer();
      const id = typeof evt.item_id === "string" ? evt.item_id : "user-current";
      const prev = userBufRef.current.get(id) ?? "";
      const next = prev + (typeof evt.delta === "string" ? evt.delta : "");
      userBufRef.current.set(id, next);
      upsertTurn("user", id, next, true);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      resetIdleTimer();
      const id = typeof evt.item_id === "string" ? evt.item_id : "user-current";
      const finalText = typeof evt.transcript === "string" ? evt.transcript : userBufRef.current.get(id) ?? "";
      userBufRef.current.delete(id);
      finalizeTurn("user", id, finalText);
      return;
    }

    // Assistant audio transcript (what the model is saying). Handle both GA
    // output_audio_transcript events and legacy audio_transcript names.
    if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
      resetIdleTimer();
      const id = typeof evt.item_id === "string"
        ? evt.item_id
        : typeof evt.response_id === "string"
        ? evt.response_id
        : "assistant-current";
      const prev = assistantBufRef.current.get(id) ?? "";
      const next = prev + (typeof evt.delta === "string" ? evt.delta : "");
      assistantBufRef.current.set(id, next);
      upsertTurn("assistant", id, next, true);
      return;
    }
    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      resetIdleTimer();
      const id = typeof evt.item_id === "string"
        ? evt.item_id
        : typeof evt.response_id === "string"
        ? evt.response_id
        : "assistant-current";
      const finalText = typeof evt.transcript === "string" ? evt.transcript : assistantBufRef.current.get(id) ?? "";
      assistantBufRef.current.delete(id);
      finalizeTurn("assistant", id, finalText);
      return;
    }

    if (type === "error") {
      console.error("[realtime] server error", evt);
      const err = evt.error as { message?: unknown } | undefined;
      setError(typeof err?.message === "string" ? err.message : "Realtime server error");
    }
  }, [finalizeTurn, upsertTurn, resetIdleTimer]);

  const start = useCallback(async ({ dialect, difficulty, topicHint, mode, context }: StartArgs) => {
    if (status === "connecting" || status === "live") return;
    dialectRef.current = dialect || "Gulf";
    setError(null);
    setStatus("connecting");
    setTurns([]);
    userBufRef.current.clear();
    assistantBufRef.current.clear();

    try {
      // 1. Set up peer connection.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Remote audio sink — model voice. Must be in the DOM for some browsers
      // to actually route audio, and we call .play() explicitly because the
      // mic-gesture context is lost after our async awaits.
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      (audioEl as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audioEl.setAttribute("playsinline", "");
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;

      // Unlock playback inside the user gesture by playing a silent muted
      // stream synchronously. Once unlocked, swapping srcObject later in
      // ontrack will play audibly without an autoplay-policy block.
      try {
        // Close any context left over from a prior start before creating a new
        // one — browsers cap concurrent AudioContexts (~6) and a leak here would
        // eventually break voice practice after repeated start/stop cycles.
        try { await audioCtxRef.current?.close(); } catch { /* noop */ }
        const unlockCtx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioCtxRef.current = unlockCtx;
        const dst = unlockCtx.createMediaStreamDestination();
        const osc = unlockCtx.createOscillator();
        const gain = unlockCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(dst);
        osc.start();
        audioEl.srcObject = dst.stream;
        await audioEl.play().catch(() => {});
      } catch (e) {
        console.warn("[realtime] audio unlock failed", e);
      }

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        audioEl.play().catch((err) => {
          console.warn("[realtime] audio autoplay blocked", err);
        });
      };

      // Explicitly request a receive transceiver so the SDP offer advertises
      // we want the model's audio track (some browsers won't add recv otherwise).
      pc.addTransceiver("audio", { direction: "recvonly" });

      // Local mic.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      micSenderRef.current = pc.addTrack(track, stream);

      // Data channel for JSON events.
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (ev) => {
        try {
          handleEvent(JSON.parse(ev.data));
        } catch (e) {
          console.warn("[realtime] bad event", e, ev.data);
        }
      };
      dc.onopen = () => {
        setStatus("live");
      };
      dc.onerror = (e) => {
        console.error("[realtime] dc error", e);
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === "failed" || st === "disconnected" || st === "closed") {
          if (!endingRef.current) {
            setError(`Voice connection ${st}`);
            setStatus("error");
            cleanup();
          }
        }
      };

      // 2. Get a short-lived OpenAI Realtime client secret from our edge
      // function. The long-lived OpenAI key stays server-side.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const tokenResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-session-token`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dialect, difficulty, topicHint, mode, context }),
      });
      if (!tokenResp.ok) {
        const t = await tokenResp.text();
        let message = t;
        try {
          const parsed = JSON.parse(t);
          message = parsed?.details || parsed?.message || parsed?.error || t;
        } catch { /* noop */ }
        throw new Error(`Voice token failed (${tokenResp.status}): ${String(message).slice(0, 300)}`);
      }
      const tokenData = await tokenResp.json();
      const clientSecret = extractClientSecret(tokenData);
      if (!clientSecret) {
        throw new Error("Voice token response was missing a client secret.");
      }

      // Extract session tracking info from server response.
      sessionIdRef.current = tokenData.session_tracking_id || null;
      // Server can override defaults if needed in the future.
      const configMaxMinutes = tokenData.max_session_minutes ?? SESSION_MAX_MINUTES;
      const configIdleMinutes = tokenData.idle_timeout_minutes ?? IDLE_TIMEOUT_MINUTES;

      // 3. SDP exchange directly with OpenAI using the ephemeral key. Sending
      // raw application/sdp avoids edge-runtime multipart serialization issues.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const offerSdp = pc.localDescription?.sdp || offer.sdp;
      if (!offerSdp) {
        throw new Error("Browser did not generate a voice connection offer. Try Chrome or Edge in a new window.");
      }

      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offerSdp,
      });
      if (!sdpResp.ok) {
        const t = await sdpResp.text();
        let message = t;
        try {
          const parsed = JSON.parse(t);
          message = parsed?.details || parsed?.message || parsed?.error || t;
        } catch { /* noop */ }
        throw new Error(`Voice setup failed (${sdpResp.status}): ${String(message).slice(0, 300)}`);
      }
      const answerSdp = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // status flips to "live" when data channel opens.
    } catch (e) {
      console.error("[realtime] start error", e);
      setError(e instanceof Error ? e.message : "Failed to start voice session");
      setStatus("error");
      cleanup();
    }
  }, [cleanup, handleEvent, status]);

  // Session duration timer: tracks elapsed time and enforces max session duration.
  useEffect(() => {
    if (status !== "live") return;

    if (!sessionStartRef.current) {
      sessionStartRef.current = Date.now();
      lastActivityRef.current = Date.now();
      // Arm idle timeout for the first time.
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        console.warn("[realtime] idle timeout reached after 15 min of silence — disconnecting");
        const errorMsg = "Disconnected due to inactivity (15 minutes of silence)";
        setError(errorMsg);
        const idleDuration = Math.floor((Date.now() - (sessionStartRef.current || Date.now())) / 1000);
        endingRef.current = true;
        setStatus("ending");

        // Log session end with idle_timeout reason.
        if (sessionIdRef.current) {
          const trackingId = sessionIdRef.current;
          fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-session-end`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({
                session_id: trackingId,
                duration_seconds: idleDuration,
                close_reason: "idle_timeout",
              }),
            },
          ).catch((e) => {
            console.warn("[realtime] failed to log idle timeout", e);
          });
        }

        cleanup();
        setStatus("idle");
        endingRef.current = false;
      }, IDLE_TIMEOUT_MINUTES * 60 * 1000);
    }

    const intervalId = setInterval(() => {
      const elapsedMs = Date.now() - (sessionStartRef.current || Date.now());
      const elapsedSec = Math.floor(elapsedMs / 1000);
      setElapsedSeconds(elapsedSec);

      // Hard max: 60 minutes.
      if (elapsedSec >= SESSION_MAX_MINUTES * 60) {
        console.warn(`[realtime] session duration exceeded ${SESSION_MAX_MINUTES} minutes — disconnecting`);
        const errorMsg = `Session duration limit reached (${SESSION_MAX_MINUTES} minutes)`;
        setError(errorMsg);
        endingRef.current = true;
        setStatus("ending");

        // Log session end with duration_limit reason.
        if (sessionIdRef.current) {
          const trackingId = sessionIdRef.current;
          fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-session-end`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({
                session_id: trackingId,
                duration_seconds: SESSION_MAX_MINUTES * 60,
                close_reason: "duration_limit",
              }),
            },
          ).catch((e) => {
            console.warn("[realtime] failed to log duration limit", e);
          });
        }

        cleanup();
        setStatus("idle");
        endingRef.current = false;
        clearInterval(intervalId);
      }
    }, 1000);

    durationTimerRef.current = intervalId;
    return () => {
      clearInterval(intervalId);
    };
  }, [status, cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, error, turns, muted, setMuted, start, stop, elapsedSeconds };
}
