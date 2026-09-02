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
import { isVoiceErrorCaptureEnabled } from "@/lib/uiPrefs";
import type { PageContextPayload } from "../../supabase/functions/_shared/pageContextCore";

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
  /**
   * What the learner is looking at, for assistant mode. Structured rather than
   * pre-serialized: the server owns the rendering and the budget, so a page
   * publishing a whole transcript can't inflate a session's instructions.
   */
  pageContext?: PageContextPayload;
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
  /** Monthly minute budget, in seconds. null = unmetered (admins). */
  voice_remaining_seconds?: number | null;
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
  // Seconds left in the monthly voice budget, from the server. null until a
  // call has been attempted, and null for unmetered (admin) accounts.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // The model's own voice, surfaced so the UI can react to it. Kept as state
  // rather than a ref because a visualiser has to re-render when it arrives.
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const dialectRef = useRef<string>("Gulf");
  const endingRef = useRef(false);
  // The learner's most recent finished utterance, as Whisper heard it. Paired
  // with the assistant's next turn for the mistake-drill feed (below).
  const lastUserTextRef = useRef<string>("");
  const modeRef = useRef<"practice" | "assistant">("practice");
  // The context the call was started with, kept so a tool call can be resolved
  // against it server-side. The browser relays tool requests; it never decides
  // what they are allowed to reach.
  const pageContextRef = useRef<PageContextPayload | undefined>(undefined);
  // Set when the data channel opens; consumed (and cleared) by reportUsage so
  // a call is billed exactly once, and never billed if it failed to go live.
  const liveSinceRef = useRef<number | null>(null);
  // Access token cached at mint time so the pagehide usage report can be sent
  // without awaiting getSession() — during unload only a synchronous keepalive
  // fetch reliably leaves the page.
  const accessTokenRef = useRef<string | null>(null);
  // call_id -> tool name, learned from the conversation item that announces
  // the call. The GA arguments-done event names the tool itself; older shapes
  // only name it on the item, and a call we cannot name is a call we cannot
  // answer — which strands the model waiting mid-conversation.
  const toolNamesRef = useRef<Map<string, string>>(new Map());

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

    // Feed the mistake drill from voice — opt-in only. A dialect transcript
    // is an unreliable witness (60%+ word error rate, research §5), so the
    // lane is off by default and, when on, the server keeps only what the
    // tutor itself corrected. Fire-and-forget: nothing here can delay or fail
    // the call. Practice mode only — the assistant mode is a study aid, not a
    // conversation the learner is being corrected in.
    if (role === "user") {
      lastUserTextRef.current = finalText.trim();
    } else if (
      finalText.trim() &&
      lastUserTextRef.current &&
      modeRef.current === "practice" &&
      isVoiceErrorCaptureEnabled()
    ) {
      const userText = lastUserTextRef.current;
      lastUserTextRef.current = "";
      void supabase.functions.invoke("extract-learner-errors", {
        body: {
          source: "voice",
          dialect: dialectRef.current,
          userText,
          assistantText: finalText,
          asrProvider: "openai-realtime",
        },
      }).catch(() => { /* best-effort */ });
    }
  }, [opts]);

  // Report the finished call's duration so the server can meter monthly voice
  // minutes. Fire-and-forget with keepalive: this often runs during teardown
  // (panel closed, navigation away) and must not block it — and losing a
  // report costs the app one usage row, not the learner their session.
  const reportUsage = useCallback(() => {
    const startedAt = liveSinceRef.current;
    liveSinceRef.current = null;
    if (startedAt == null) return;
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    if (seconds < 1) return;
    const mode = modeRef.current;
    // The token cached at mint time lets this fire the keepalive fetch
    // synchronously — required on pagehide, where an awaited getSession()
    // continuation may never run before the page is gone.
    const cachedToken = accessTokenRef.current;
    const send = (token: string) => {
      try {
        const p = fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-session-token`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Authorization": `Bearer ${token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "report", mode, seconds }),
        });
        void p.then(async (resp) => {
          if (!resp.ok) return;
          const payload = (await resp.json().catch(() => null)) as ClientSecretResponse | null;
          if (payload && typeof payload.voice_remaining_seconds === "number") {
            setRemainingSeconds(payload.voice_remaining_seconds);
          }
        }).catch(() => {
          /* usage reporting must never break teardown */
        });
      } catch {
        /* usage reporting must never break teardown */
      }
    };
    if (cachedToken) {
      send(cachedToken);
      return;
    }
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        send(session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
      } catch {
        /* usage reporting must never break teardown */
      }
    })();
  }, []);

  // Closing the tab or navigating away entirely never runs React cleanup, so
  // without this the whole session went unmetered — the normal way to end a
  // call recorded zero seconds. pagehide + keepalive is the reliable pair for
  // an unload-time send.
  useEffect(() => {
    const onPageHide = () => reportUsage();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [reportUsage]);

  const cleanup = useCallback(() => {
    reportUsage();
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
    setRemoteStream(null);
    micSenderRef.current = null;
    userBufRef.current.clear();
    assistantBufRef.current.clear();
  }, [reportUsage]);

  const stop = useCallback(() => {
    endingRef.current = true;
    setStatus("ending");
    cleanup();
    setStatus("idle");
    endingRef.current = false;
  }, [cleanup]);

  const send = useCallback((payload: unknown): boolean => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn("[realtime] send failed", e);
      return false;
    }
  }, []);

  /**
   * Run a tool the model asked for and hand the result back to the call.
   *
   * The browser is a relay here, nothing more: it forwards the name and
   * arguments, and `assistant-tools` decides — from the caller's own JWT and
   * the page context the call was started with — what that is allowed to
   * touch. In particular the model naming a URL does not make it readable.
   *
   * A failure still returns output. A function call left unanswered leaves the
   * model waiting mid-conversation, which to the learner is a tutor that
   * stopped talking.
   */
  const runToolCall = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      let output = "That lookup failed.";
      try {
        let args: Record<string, unknown> = {};
        try {
          args = rawArgs ? JSON.parse(rawArgs) : {};
        } catch {
          args = {};
        }
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-tools`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name,
              args,
              dialect: dialectRef.current,
              pageContext: pageContextRef.current,
            }),
          },
        );
        const payload = await resp.json().catch(() => null);
        if (typeof payload?.text === "string" && payload.text) output = payload.text;
      } catch (e) {
        console.warn("[realtime] tool call failed", name, e);
      }

      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output },
      });
      // The model is waiting on this result to carry on speaking, so unlike a
      // screen update this one does ask for a response.
      send({ type: "response.create" });
    },
    [send],
  );

  const handleEvent = useCallback((evt: RealtimeEvent) => {
    const type = typeof evt.type === "string" ? evt.type : "";

    // A function call is announced as a conversation item before its
    // arguments finish streaming. Remember the name against its call_id so
    // the arguments-done event can be answered even when it carries no name
    // of its own.
    if (type === "response.output_item.added" || type === "conversation.item.created") {
      const item = (evt.item ?? {}) as Record<string, unknown>;
      if (item.type === "function_call") {
        const id = typeof item.call_id === "string" ? item.call_id : "";
        const named = typeof item.name === "string" ? item.name : "";
        if (id && named) toolNamesRef.current.set(id, named);
      }
      return;
    }

    // Tool call. The GA event carries the name on the event itself; older
    // shapes only name it on the conversation item, so fall back to that.
    if (type === "response.function_call_arguments.done") {
      const callId = typeof evt.call_id === "string" ? evt.call_id : "";
      const name = typeof evt.name === "string" && evt.name
        ? evt.name
        : toolNamesRef.current.get(callId) ?? "";
      const args = typeof evt.arguments === "string" ? evt.arguments : "";
      if (callId && name) {
        toolNamesRef.current.delete(callId);
        void runToolCall(callId, name, args);
      } else {
        // Nothing to run and nothing to answer with. Say so — silence here
        // looks identical to a tutor that simply stopped talking.
        console.warn("[realtime] unnamed tool call, ignoring", { callId, type });
      }
      return;
    }

    // User speech transcripts (Whisper).
    if (type === "conversation.item.input_audio_transcription.delta") {
      const id = typeof evt.item_id === "string" ? evt.item_id : "user-current";
      const prev = userBufRef.current.get(id) ?? "";
      const next = prev + (typeof evt.delta === "string" ? evt.delta : "");
      userBufRef.current.set(id, next);
      upsertTurn("user", id, next, true);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const id = typeof evt.item_id === "string" ? evt.item_id : "user-current";
      const finalText = typeof evt.transcript === "string" ? evt.transcript : userBufRef.current.get(id) ?? "";
      userBufRef.current.delete(id);
      finalizeTurn("user", id, finalText);
      return;
    }

    // Assistant audio transcript (what the model is saying). Handle both GA
    // output_audio_transcript events and legacy audio_transcript names.
    if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
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
  }, [finalizeTurn, upsertTurn, runToolCall]);

  /**
   * Tell a call in progress that the screen moved on.
   *
   * The session's instructions are minted once, server-side, and carry the
   * dialect rulebook and the learner profile — so they are deliberately not
   * rebuilt from the browser. Instead the change is added to the conversation
   * as a note, which the model reads before its next turn. That costs no round
   * trip and keeps prompt construction where it belongs.
   *
   * Sent without a `response.create`: the learner scrolling to the next
   * subtitle is not a request to be talked at.
   *
   * Returns false when there is no open channel to send on, so callers can
   * tell "not delivered" from "delivered".
   */
  const updateContext = useCallback(
    (note: string, pageContext?: PageContextPayload): boolean => {
      // Keep the stored context current too: a learner who moves to another
      // video mid-call should be able to ask about *that* video's source, and
      // the allow-list is derived from whatever is stored here.
      if (pageContext) pageContextRef.current = pageContext;
      const text = note.trim();
      if (!text) return false;
      return send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          // Marked, because it arrives on the same channel as the learner's
          // own speech and the model would otherwise answer it as if spoken.
          content: [{ type: "input_text", text: `[Screen update — not spoken aloud]\n${text}` }],
        },
      });
    },
    [send],
  );

  const start = useCallback(async ({ dialect, difficulty, topicHint, mode, pageContext }: StartArgs) => {
    if (status === "connecting" || status === "live") return;
    dialectRef.current = dialect || "Gulf";
    modeRef.current = mode === "assistant" ? "assistant" : "practice";
    pageContextRef.current = pageContext;
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
        setRemoteStream(e.streams[0] ?? null);
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
        liveSinceRef.current = Date.now();
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
      accessTokenRef.current = token;
      const tokenResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-session-token`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dialect, difficulty, topicHint, mode, pageContext }),
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
      const tokenPayload = (await tokenResp.json()) as ClientSecretResponse;
      if (typeof tokenPayload.voice_remaining_seconds === "number") {
        setRemainingSeconds(tokenPayload.voice_remaining_seconds);
      }
      const clientSecret = extractClientSecret(tokenPayload);
      if (!clientSecret) {
        throw new Error("Voice token response was missing a client secret.");
      }

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

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, error, turns, muted, setMuted, start, stop, updateContext, remainingSeconds, remoteStream };
}
