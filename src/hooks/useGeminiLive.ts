// useGeminiLive — manages a Gemini Live API voice session from the browser.
// Flow:
//   1. POST to /functions/v1/live-session-token to mint an ephemeral access token
//      (server holds GEMINI_API_KEY; token is single-use, ~60s to bind).
//   2. Open wss://generativelanguage.googleapis.com/ws/...BidiGenerateContent
//      with ?access_token=<token>. The setup message is already baked into the
//      token (model, voice, system instruction).
//   3. Capture mic at 16 kHz mono PCM via AudioWorklet, send as
//      realtimeInput.mediaChunks base64 frames every ~100ms.
//   4. Play back the model's 24 kHz PCM audio via an AudioContext queue.
//   5. Surface input/output transcripts as live text for the chat panel.
//
// This bypasses Lovable AI Gateway by design — Live API is a Google-only
// protocol that requires direct WebSocket + ephemeral auth.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveStatus = "idle" | "connecting" | "live" | "ending" | "error";

interface LiveTurn {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
  /** True if the turn contained detected MSA/wrong-dialect tokens. */
  hasDialectDrift?: boolean;
}

interface StartArgs {
  dialect: string;
  difficulty: string;
  topicHint?: string;
}

interface Options {
  onTurnFinalized?: (turn: LiveTurn) => void;
  /** Called when MSA/wrong-dialect tokens are detected in model output. */
  onDialectDrift?: (leaks: string[]) => void;
}

// Lightweight client-side MSA detector for live voice turns.
// A subset of the server-side detector — catches the most common MSA leaks.
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

// Tiny inline AudioWorklet that emits Float32 frames as Int16 PCM messages.
const PCM_WORKLET_SRC = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const pcm = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let s = Math.max(-1, Math.min(1, ch[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function useGeminiLive(opts: Options = {}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackTimeRef = useRef(0);
  const userPartialRef = useRef<string>("");
  const modelPartialRef = useRef<string>("");
  const mutedRef = useRef(false);
  const dialectRef = useRef<string>("Gulf");

  useEffect(() => {
    mutedRef.current = muted;
    // When muting, send an explicit audioStreamEnd as a fallback turn boundary
    // in case VAD didn't trigger (user paused mid-sentence and tapped mute).
    if (muted && wsRef.current && wsRef.current.readyState === 1) {
      try {
        wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (e) {
        console.warn("[live] audioStreamEnd send failed", e);
      }
    }
  }, [muted]);

  const appendUserPartial = useCallback((text: string) => {
    userPartialRef.current += text;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "user" && last.partial) {
        return prev.map((t, i) => (i === prev.length - 1 ? { ...t, text: userPartialRef.current } : t));
      }
      return [...prev, { role: "user", text: userPartialRef.current, partial: true }];
    });
  }, []);

  const appendModelPartial = useCallback((text: string) => {
    modelPartialRef.current += text;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.partial) {
        return prev.map((t, i) => (i === prev.length - 1 ? { ...t, text: modelPartialRef.current } : t));
      }
      return [...prev, { role: "assistant", text: modelPartialRef.current, partial: true }];
    });
  }, []);

  const finalizeTurns = useCallback(() => {
    const u = userPartialRef.current.trim();
    const m = modelPartialRef.current.trim();

    // Check model output for MSA/wrong-dialect leaks.
    let modelDrift = false;
    if (m) {
      const leaks = detectLiveLeaks(m, dialectRef.current);
      if (leaks.length > 0) {
        modelDrift = true;
        opts.onDialectDrift?.(leaks);
      }
    }

    setTurns((prev) =>
      prev.map((t) => {
        if (!t.partial) return t;
        if (t.role === "assistant" && modelDrift) {
          return { ...t, partial: false, hasDialectDrift: true };
        }
        return { ...t, partial: false };
      })
    );
    if (u) opts.onTurnFinalized?.({ role: "user", text: u });
    if (m) opts.onTurnFinalized?.({ role: "assistant", text: m, hasDialectDrift: modelDrift });
    userPartialRef.current = "";
    modelPartialRef.current = "";
  }, [opts]);

  const cleanup = useCallback(() => {
    try { workletNodeRef.current?.disconnect(); } catch {}
    workletNodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { captureCtxRef.current?.close(); } catch {}
    captureCtxRef.current = null;
    try { playbackCtxRef.current?.close(); } catch {}
    playbackCtxRef.current = null;
    playbackTimeRef.current = 0;
    if (wsRef.current && wsRef.current.readyState <= 1) {
      try { wsRef.current.close(); } catch {}
    }
    wsRef.current = null;
  }, []);

  const stop = useCallback(() => {
    setStatus("ending");
    finalizeTurns();
    cleanup();
    setStatus("idle");
  }, [cleanup, finalizeTurns]);

  const enqueuePlayback = useCallback(async (pcm16: ArrayBuffer) => {
    if (!playbackCtxRef.current) {
      // Live API emits 24 kHz PCM.
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    const view = new Int16Array(pcm16);
    const buf = ctx.createBuffer(1, view.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < view.length; i++) ch[i] = view[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playbackTimeRef.current);
    src.start(startAt);
    playbackTimeRef.current = startAt + buf.duration;
  }, []);

  const interruptPlayback = useCallback(() => {
    // Killing the AudioContext is the cleanest interrupt; recreate on next chunk.
    try { playbackCtxRef.current?.close(); } catch {}
    playbackCtxRef.current = null;
    playbackTimeRef.current = 0;
  }, []);

  const handleServerMessage = useCallback(async (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) interruptPlayback();

    // Inline audio (model voice) — comes as base64 PCM16 24kHz inline_data parts.
    const parts = sc.modelTurn?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data && (inline.mimeType || inline.mime_type || "").includes("audio")) {
        try { await enqueuePlayback(base64ToBuf(inline.data)); } catch (e) { console.warn("playback err", e); }
      }
    }

    // Transcripts (we enabled both input + output).
    if (sc.inputTranscription?.text) appendUserPartial(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) appendModelPartial(sc.outputTranscription.text);

    if (sc.turnComplete || sc.generationComplete) finalizeTurns();
  }, [appendModelPartial, appendUserPartial, enqueuePlayback, finalizeTurns, interruptPlayback]);

  const start = useCallback(async ({ dialect, difficulty, topicHint }: StartArgs) => {
    if (status === "connecting" || status === "live") return;
    dialectRef.current = dialect || "Gulf";
    setError(null);
    setStatus("connecting");
    setTurns([]);
    userPartialRef.current = "";
    modelPartialRef.current = "";

    try {
      // 1. Mint ephemeral token via our edge function (handles auth + dialect prompt).
      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke("live-session-token", {
        body: { dialect, difficulty, topicHint },
      });
      if (tokenErr) throw new Error(tokenErr.message || "Failed to get session token");
      if (!tokenData?.token) throw new Error(tokenData?.error || "No token returned");

      // 2. Open WebSocket. Token already encodes setup config.
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=${encodeURIComponent(tokenData.token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let firstMsgLogged = false;
      ws.onmessage = async (ev) => {
        const data = ev.data;
        const text = typeof data === "string" ? data : data instanceof Blob ? await data.text() : "";
        if (!firstMsgLogged) {
          firstMsgLogged = true;
          console.debug("[live] first server message", text.slice(0, 300));
        }
        if (text) handleServerMessage(text);
      };
      ws.onerror = (e) => {
        console.error("[live] ws error", e);
        setError("Voice connection error");
        setStatus("error");
        cleanup();
      };
      ws.onclose = (ev) => {
        console.warn("[live] ws closed", ev.code, ev.reason);
        if (status !== "ending") {
          if (ev.code !== 1000 && ev.code !== 1005) {
            setError(`Voice session ended (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`);
            setStatus("error");
          }
          finalizeTurns();
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        setTimeout(() => reject(new Error("WebSocket open timeout")), 8000);
      });

      // 3. Mic capture → 16 kHz PCM frames.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const captureCtx = new AudioContext({ sampleRate: 16000 });
      captureCtxRef.current = captureCtx;
      const workletUrl = URL.createObjectURL(
        new Blob([PCM_WORKLET_SRC], { type: "application/javascript" }),
      );
      await captureCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const src = captureCtx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(captureCtx, "pcm-capture");
      workletNodeRef.current = node;
      node.port.onmessage = (ev) => {
        if (mutedRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== 1) return;
        const b64 = bufToBase64(ev.data as ArrayBuffer);
        wsRef.current.send(JSON.stringify({
          realtimeInput: {
            audio: { mimeType: "audio/pcm;rate=16000", data: b64 },
          },
        }));
      };
      src.connect(node);
      // Don't connect node → destination; we'd hear the mic locally.

      setStatus("live");
    } catch (e) {
      console.error("[live] start error", e);
      setError(e instanceof Error ? e.message : "Failed to start voice session");
      setStatus("error");
      cleanup();
    }
  }, [cleanup, finalizeTurns, handleServerMessage, status]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, error, turns, muted, setMuted, start, stop };
}
