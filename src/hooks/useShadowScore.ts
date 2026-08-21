/**
 * useShadowScore — scores a shadowing take against the ACTUAL native clip.
 *
 * Combines two clip-anchored signals (never a generic pronunciation model):
 *   1. Transcript match  — did you say the same words the native said in the
 *      clip? (Munsit ASR + normalised Arabic edit distance, server-side.)
 *   2. Acoustic match    — does your take sound like the clip? (MFCC + DTW,
 *      client-side; only when the clip's audio is downloadable.)
 *
 * Neither is shown raw. `@/lib/shadowScoring` calibrates the transcript match
 * and caps a take that had no clip audio to compare against — see the note
 * there on why a perfect transcript is not a perfect take.
 *
 * Then fetches 2–3 AI coaching tips from `pronunciation-feedback` (shadow mode).
 */

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { blobToWav } from "@/lib/audioToWav";
import { acousticSimilarity } from "@/lib/acousticSimilarity";
import { shadowOverall, wordsScore } from "@/lib/shadowScoring";
import { useDialect } from "@/contexts/DialectContext";

export interface ShadowWordDiff {
  ref?: string;
  said?: string;
  status: "match" | "sub" | "missing" | "extra";
}

export interface ShadowScoreResult {
  /** Combined 0–100 closeness to the clip. */
  overall: number;
  /** 0–100 word match to what the native said, calibrated (see `shadowScoring`). */
  transcriptSimilarity: number;
  /** The uncalibrated character-level match, 0–100, before the curve. */
  rawTranscriptSimilarity: number;
  /** 0–100 acoustic match, or null when clip audio wasn't available. */
  acousticSimilarity: number | null;
  /** What the ASR heard the learner say. */
  recognizedText: string;
  wordDiffs: ShadowWordDiff[];
  /** AI coaching tips (may be empty if the tips call failed). */
  tips: string[];
}

interface ScoreOptions {
  referenceText: string;
  /** Native clip audio as a WAV Blob — enables the acoustic component. */
  nativeClipWav?: Blob | null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function useShadowScore() {
  // Sent to the scorer so the words the learner missed are recorded against the
  // right dialect in `learner_errors` (they feed the learner profile).
  const { activeDialect } = useDialect();
  const [result, setResult] = useState<ShadowScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const score = useCallback(
    async (audioBlob: Blob, { referenceText, nativeClipWav }: ScoreOptions): Promise<ShadowScoreResult | null> => {
      if (!audioBlob || audioBlob.size === 0) {
        setError("No audio recorded");
        return null;
      }
      if (!referenceText.trim()) {
        setError("Reference text is required");
        return null;
      }

      const reqId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        // Convert the WebM/Opus recording to 16 kHz WAV once — used for both
        // the ASR call and the client-side acoustic comparison.
        const userWav = await blobToWav(audioBlob);
        const audioBase64 = await blobToBase64(userWav);

        // 1. Transcript match (server) + 2. acoustic match (client) in parallel.
        const [fnResponse, acoustic] = await Promise.all([
          supabase.functions.invoke("score-shadow-attempt", {
            body: { audioBase64, mimeType: "audio/wav", referenceText, dialect: activeDialect },
          }),
          nativeClipWav
            ? acousticSimilarity(userWav, nativeClipWav).catch(() => null)
            : Promise.resolve<number | null>(null),
        ]);

        if (reqId !== requestIdRef.current) return null;

        const { data, error: fnError } = fnResponse;
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        const rawTranscriptSimilarity = Math.round((data.transcriptSimilarity ?? 0) * 100);
        const recognizedText: string = data.recognizedText ?? "";
        const wordDiffs: ShadowWordDiff[] = Array.isArray(data.wordDiffs) ? data.wordDiffs : [];

        // The recogniser writes down real words whatever it hears, so a clean
        // transcript is evidence the learner chose the right words rather than
        // that they said them well. `shadowScoring` is where that is priced in.
        const transcriptSimilarity = wordsScore(rawTranscriptSimilarity);
        const overall = shadowOverall(transcriptSimilarity, acoustic);

        // 3. AI coaching tips — best-effort; never blocks the score.
        let tips: string[] = [];
        try {
          const { data: tipData } = await supabase.functions.invoke("pronunciation-feedback", {
            body: {
              mode: "shadow",
              referenceText,
              recognizedText,
              closeness: overall,
              wordDiffs,
            },
          });
          if (Array.isArray(tipData?.tips)) tips = tipData.tips;
        } catch {
          /* tips are optional */
        }

        if (reqId !== requestIdRef.current) return null;

        const scoreResult: ShadowScoreResult = {
          overall,
          transcriptSimilarity,
          rawTranscriptSimilarity,
          acousticSimilarity: acoustic,
          recognizedText,
          wordDiffs,
          tips,
        };
        setResult(scoreResult);
        return scoreResult;
      } catch (err: unknown) {
        if (reqId !== requestIdRef.current) return null;
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        if (reqId === requestIdRef.current) setIsLoading(false);
      }
    },
    [activeDialect],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { score, result, isLoading, error, reset };
}
