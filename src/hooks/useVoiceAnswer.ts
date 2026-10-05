import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Answer a tutor by voice: record, transcribe (Arabic), and hand the text to
 * the composer so the learner can check it before sending.
 *
 * Shared by the guided tutor sessions — the post-video debrief and the daily
 * recap — which both put a microphone next to the text box. The transcript
 * is appended to whatever is typed rather than sent: a recogniser's guess at
 * a beginner's Arabic is worth a glance before it goes to the tutor.
 */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"));
    // A data URL is "data:<type>;base64,<payload>"; only the payload is sent.
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(blob);
  });
}

export function useVoiceAnswer(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [],
  );

  const start = useCallback(async () => {
    if (recording || transcribing) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone blocked", { description: "Allow mic access in your browser to answer by voice." });
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0) return;
      setTranscribing(true);
      try {
        const { data, error } = await supabase.functions.invoke("munsit-transcribe", {
          body: { audioBase64: await blobToBase64(blob), mimeType: blob.type },
        });
        const text = (data as { text?: string } | null)?.text?.trim();
        if (error || !text) {
          toast.error("Couldn't hear that", { description: "Try again, or type your answer." });
          return;
        }
        onText(text);
      } finally {
        setTranscribing(false);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }, [onText, recording, transcribing]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }, []);

  return { recording, transcribing, start, stop };
}
