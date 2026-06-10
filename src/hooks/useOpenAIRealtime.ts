// useOpenAIRealtime — manages an OpenAI Realtime API voice session via WebRTC.
// Flow:
//   1. POST /functions/v1/realtime-session-token to mint an ephemeral client_secret.
//   2. Create RTCPeerConnection, add mic track, attach <audio> sink for model voice,
//      open a data channel for JSON events.
//   3. SDP exchange with https://api.openai.com/v1/realtime?model=...
//      using ephemeral key as Bearer.
//   4. Stream user + assistant transcripts from data-channel events.
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
}

interface Options {
  onTurnFinalized?: (turn: LiveTurn) => void;
  onDialectDrift?: (leaks: string[]) => void;
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

export function useOpenAIRealtime(opts: Options = {}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const dialectRef = useRef<string>("Gulf");
  const endingRef = useRef(false);

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
      const idx = prev.findIndex((t) => (t as any)._id === id);
      const next = { role, text, partial, _id: id } as LiveTurn & { _id: string };
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
        (t as any)._id === id
          ? { ...t, text: finalText, partial: false, hasDialectDrift: drift }
          : t,
      ),
    );
    if (finalText.trim()) {
      opts.onTurnFinalized?.({ role, text: finalText, hasDialectDrift: drift });
    }
  }, [opts]);

  const cleanup = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    dcRef.current = null;
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch {}
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    localStreamRef.current = null;
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
      } catch {}
      audioElRef.current = null;
    }
    micSenderRef.current = null;
    userBufRef.current.clear();
    assistantBufRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    endingRef.current = true;
    setStatus("ending");
    cleanup();
    setStatus("idle");
    endingRef.current = false;
  }, [cleanup]);

  const handleEvent = useCallback((evt: any) => {
    const type: string = evt?.type ?? "";

    // User speech transcripts (Whisper).
    if (type === "conversation.item.input_audio_transcription.delta") {
      const id = evt.item_id ?? "user-current";
      const prev = userBufRef.current.get(id) ?? "";
      const next = prev + (evt.delta ?? "");
      userBufRef.current.set(id, next);
      upsertTurn("user", id, next, true);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const id = evt.item_id ?? "user-current";
      const finalText = evt.transcript ?? userBufRef.current.get(id) ?? "";
      userBufRef.current.delete(id);
      finalizeTurn("user", id, finalText);
      return;
    }

    // Assistant audio transcript (what the model is saying).
    if (type === "response.audio_transcript.delta") {
      const id = evt.item_id ?? evt.response_id ?? "assistant-current";
      const prev = assistantBufRef.current.get(id) ?? "";
      const next = prev + (evt.delta ?? "");
      assistantBufRef.current.set(id, next);
      upsertTurn("assistant", id, next, true);
      return;
    }
    if (type === "response.audio_transcript.done") {
      const id = evt.item_id ?? evt.response_id ?? "assistant-current";
      const finalText = evt.transcript ?? assistantBufRef.current.get(id) ?? "";
      assistantBufRef.current.delete(id);
      finalizeTurn("assistant", id, finalText);
      return;
    }

    if (type === "error") {
      console.error("[realtime] server error", evt);
      setError(evt?.error?.message ?? "Realtime server error");
    }
  }, [finalizeTurn, upsertTurn]);

  const start = useCallback(async ({ dialect, difficulty, topicHint }: StartArgs) => {
    if (status === "connecting" || status === "live") return;
    dialectRef.current = dialect || "Gulf";
    setError(null);
    setStatus("connecting");
    setTurns([]);
    userBufRef.current.clear();
    assistantBufRef.current.clear();

    try {
      // 1. Mint ephemeral key.
      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke("realtime-session-token", {
        body: { dialect, difficulty, topicHint },
      });
      if (tokenErr) throw new Error(tokenErr.message || "Failed to get session token");
      if (!tokenData?.client_secret) throw new Error(tokenData?.error || "No ephemeral key returned");

      const ephemeralKey: string = tokenData.client_secret;
      const model: string = tokenData.model;

      // 2. Set up peer connection.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Remote audio sink — model voice.
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

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
          if (!endingRef.current && status !== "idle") {
            setError(`Voice connection ${st}`);
            setStatus("error");
            cleanup();
          }
        }
      };

      // 3. SDP exchange.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpResp.ok) {
        const t = await sdpResp.text();
        throw new Error(`SDP exchange failed (${sdpResp.status}): ${t.slice(0, 200)}`);
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

  return { status, error, turns, muted, setMuted, start, stop };
}
