import { createContext, useContext, useState, useRef, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { extractFramesWithTimestamps } from "@/lib/videoFrameExtractor";
import type { TranscriptLine } from "@/types/transcript";

export type TranscriptionResult = {
  transcriptLines: TranscriptLine[];
  vocabulary: any[];
  grammarPoints: any[];
  culturalContext: string;
  dialect?: string;
  difficulty?: string;
  title?: string;
  titleArabic?: string;
  durationSeconds?: number;
};

export type JobParams = {
  audioFile: File;
  timeRange: [number, number];
  mediaDuration: number | null;
  videoId?: string;
};

export type TranscriptionJob = {
  id: string;
  videoId?: string;
  status: "running" | "complete" | "error";
  progress: number;
  progressLabel: string;
  error?: string;
  result?: TranscriptionResult;
  startedAt: number;
};

type TranscriptionJobContextType = {
  job: TranscriptionJob | null;
  startJob: (params: JobParams) => void;
  consumeResult: (videoId?: string) => TranscriptionResult | null;
  clearJob: () => void;
};

const TranscriptionJobContext = createContext<TranscriptionJobContextType | null>(null);

export function useTranscriptionJob() {
  const ctx = useContext(TranscriptionJobContext);
  if (!ctx) throw new Error("useTranscriptionJob must be used inside TranscriptionJobProvider");
  return ctx;
}

export function TranscriptionJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  // Keep a ref so async callbacks always read current job id
  const jobIdRef = useRef<string | null>(null);

  const updateJob = useCallback((updates: Partial<TranscriptionJob>) => {
    setJob((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const startJob = useCallback(
    async (params: JobParams) => {
      const { audioFile, timeRange, mediaDuration, videoId } = params;

      const id = `job-${Date.now()}`;
      jobIdRef.current = id;

      const newJob: TranscriptionJob = {
        id,
        videoId,
        status: "running",
        progress: 5,
        progressLabel: "Starting transcription…",
        startedAt: Date.now(),
      };
      setJob(newJob);

      const patch = (progress: number, progressLabel: string) => {
        if (jobIdRef.current !== id) return; // stale job, ignore
        setJob((prev) => (prev?.id === id ? { ...prev, progress, progressLabel } : prev));
      };

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const projectUrl = import.meta.env.VITE_SUPABASE_URL;
        const authHeaders: Record<string, string> = {
          Authorization: `Bearer ${session?.access_token}`,
        };

        // Visual analysis in parallel for video files
        const isVideoFile = audioFile.type.startsWith("video/");
        const visualPromise = isVideoFile
          ? (async () => {
              try {
                const frames = await extractFramesWithTimestamps(audioFile, 4, 12, 640);
                const { data, error } = await supabase.functions.invoke("extract-visual-context", {
                  body: { frames, audioDuration: mediaDuration ?? undefined },
                });
                if (error || !data?.success) return null;
                return data.result;
              } catch {
                return null;
              }
            })()
          : Promise.resolve(null);

        patch(10, "Transcribing with Deepgram, Fanar & Soniox…");

        const munsitFormData = new FormData();
        munsitFormData.append("audio", audioFile);
        const munsitPromise = fetch(`${projectUrl}/functions/v1/munsit-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: munsitFormData,
          signal: AbortSignal.timeout(300000),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok && !body.text) throw new Error(body.error || `Munsit HTTP ${res.status}`);
          return body as { text?: string | null; error?: string };
        });

        const deepgramFormData = new FormData();
        deepgramFormData.append("file", audioFile);
        const deepgramPromise = fetch(`${projectUrl}/functions/v1/deepgram-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: deepgramFormData,
          signal: AbortSignal.timeout(300000),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}`);
          return res.json();
        });

        const fanarFormData = new FormData();
        fanarFormData.append("audio", audioFile);
        const fanarPromise = fetch(`${projectUrl}/functions/v1/fanar-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: fanarFormData,
          signal: AbortSignal.timeout(300000),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok && !body.text) throw new Error(body.error || `Fanar HTTP ${res.status}`);
          return body as { text?: string | null; reason?: string };
        });

        const sonioxFormData = new FormData();
        sonioxFormData.append("audio", new File([audioFile], audioFile.name, { type: audioFile.type }));
        sonioxFormData.append("includeTranslation", "true");
        const sonioxPromise = fetch(`${projectUrl}/functions/v1/soniox-transcribe`, {
          method: "POST",
          headers: authHeaders,
          body: sonioxFormData,
          signal: AbortSignal.timeout(300000),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok && !body.text) throw new Error(body.error || `Soniox HTTP ${res.status}`);
          return body as { text?: string | null; sonioxUsed?: boolean; reason?: string; translationText?: string | null };
        });

        const [munsitResult, deepgramResult, fanarResult, sonioxResult, visualResult] = await Promise.allSettled([
          munsitPromise,
          deepgramPromise,
          fanarPromise,
          sonioxPromise,
          visualPromise,
        ]);

        patch(40, "Analyzing transcriptions…");

        const munsitText = munsitResult.status === "fulfilled" ? munsitResult.value.text || "" : "";
        const deepgramData = deepgramResult.status === "fulfilled" ? deepgramResult.value : null;
        const deepgramText = deepgramData?.text || "";
        const fanarText = fanarResult.status === "fulfilled" ? fanarResult.value.text || "" : "";
        const sonioxText =
          sonioxResult.status === "fulfilled" && sonioxResult.value.sonioxUsed
            ? sonioxResult.value.text || ""
            : "";

        const engines: string[] = [];
        if (munsitText) engines.push("Munsit");
        if (deepgramText) engines.push("Deepgram");
        if (fanarText) engines.push("Fanar");
        if (sonioxText) engines.push("Soniox");

        if (engines.length === 0) {
          throw new Error("All transcription engines failed. Please try again.");
        }

        const primaryText = deepgramText || munsitText || fanarText;

        let relativeWords: any[] = [];
        let filteredPrimaryText = primaryText;

        if (deepgramData?.words && deepgramData.words.length > 0) {
          const [startSec, endSec] = timeRange;
          let filteredWords = deepgramData.words;

          if (startSec > 0 || endSec < (mediaDuration || Infinity)) {
            filteredWords = filteredWords.filter((w: any) => w.start >= startSec && w.end <= endSec);
            filteredPrimaryText = filteredWords.map((w: any) => w.text).join(" ") || primaryText;
          }

          const clipOffsetSec = Math.max(0, startSec);
          relativeWords = filteredWords.map((w: any) => ({
            ...w,
            start: Math.max(0, w.start - clipOffsetSec),
            end: Math.max(0, w.end - clipOffsetSec),
          }));
        }

        const visualContextData = visualResult.status === "fulfilled" ? visualResult.value : null;

        const visualContextStr = visualContextData
          ? (() => {
              const parts: string[] = [];
              if (visualContextData.sceneContext) parts.push(`Scene: ${visualContextData.sceneContext}`);
              if (visualContextData.culturalContext) parts.push(visualContextData.culturalContext);
              if (visualContextData.onScreenTextSegments?.length > 0) {
                const texts = visualContextData.onScreenTextSegments.map((s: any) => s.text).join("; ");
                parts.push(`On-screen text: ${texts}`);
              }
              if (visualContextData.detectedDialectCues?.length > 0) {
                parts.push(`Visual dialect cues: ${visualContextData.detectedDialectCues.join(", ")}`);
              }
              return parts.join(". ");
            })()
          : undefined;

        const analyzeBody: Record<string, string> = { transcript: filteredPrimaryText };
        if (munsitText && munsitText !== filteredPrimaryText) analyzeBody.munsitTranscript = munsitText;
        if (fanarText) analyzeBody.fanarTranscript = fanarText;
        if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
        const sonioxTranslation =
          sonioxResult.status === "fulfilled" ? sonioxResult.value.translationText : null;
        if (sonioxTranslation) analyzeBody.sonioxTranslation = sonioxTranslation;
        if (visualContextStr) analyzeBody.visualContext = visualContextStr;

        patch(55, "Running Gulf Arabic analysis…");

        const analyzeController = new AbortController();
        const analyzeTimeout = setTimeout(() => analyzeController.abort(), 300_000);
        let analyzeData: any;
        try {
          const analyzeResp = await fetch(`${projectUrl}/functions/v1/analyze-gulf-arabic`, {
            method: "POST",
            signal: analyzeController.signal,
            headers: {
              ...authHeaders,
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify(analyzeBody),
          });
          if (!analyzeResp.ok) {
            const errBody = await analyzeResp.text().catch(() => "");
            throw new Error(`Analysis HTTP ${analyzeResp.status}: ${errBody.slice(0, 200)}`);
          }
          analyzeData = await analyzeResp.json();
        } finally {
          clearTimeout(analyzeTimeout);
        }

        if (!analyzeData?.success) throw new Error(analyzeData?.error || "Analysis failed");

        patch(85, "Building transcript segments…");

        const result = analyzeData.result;

        let lines = result.lines || [];
        if (relativeWords.length > 0 && lines.length > 0) {
          let wordIdx = 0;
          lines = lines.map((line: any) => {
            const lineWords = line.arabic?.split(/\s+/).filter(Boolean) || [];
            let startMs: number | undefined;
            let endMs: number | undefined;
            for (const _lw of lineWords) {
              if (wordIdx < relativeWords.length) {
                if (startMs === undefined) startMs = Math.round(relativeWords[wordIdx].start * 1000);
                endMs = Math.round(relativeWords[wordIdx].end * 1000);
                wordIdx++;
              }
            }
            return { ...line, startMs, endMs };
          });
        }

        let mergedLines = lines;
        if (visualContextData?.onScreenTextSegments?.length > 0) {
          const overlayLines: TranscriptLine[] = visualContextData.onScreenTextSegments.map(
            (seg: any, idx: number) => ({
              id: `overlay-${idx}-${Date.now()}`,
              arabic: String(seg.text ?? ""),
              translation: String(seg.translation ?? ""),
              tokens: String(seg.text ?? "")
                .split(/\s+/)
                .filter(Boolean)
                .map((w: string, wi: number) => ({ id: `otok-${idx}-${wi}`, surface: w })),
              startMs:
                typeof seg.startSeconds === "number" ? Math.round(seg.startSeconds * 1000) : undefined,
              endMs:
                typeof seg.endSeconds === "number" ? Math.round(seg.endSeconds * 1000) : undefined,
              segmentType: "text_overlay" as const,
            })
          );
          mergedLines = [...mergedLines, ...overlayLines].sort((a, b) => {
            const aMs = (a as any).startMs ?? Infinity;
            const bMs = (b as any).startMs ?? Infinity;
            return aMs - bMs;
          });
        }

        const sanitizedLines = mergedLines.map((line: any) => ({
          ...line,
          tokens: Array.isArray(line.tokens)
            ? line.tokens
            : String(line.arabic ?? "")
                .split(/\s+/)
                .filter(Boolean)
                .map((w: string, wi: number) => ({
                  id: `tok-${line.id ?? wi}-${wi}`,
                  surface: w,
                })),
        }));

        const audioCulturalContext = result.culturalContext || "";
        const visualCulturalNote = visualContextData?.culturalContext
          ? audioCulturalContext
            ? `${audioCulturalContext}\n\nVisual context: ${visualContextData.culturalContext}`
            : visualContextData.culturalContext
          : audioCulturalContext;

        const overlayCount = visualContextData?.onScreenTextSegments?.length ?? 0;

        const jobResult: TranscriptionResult = {
          transcriptLines: sanitizedLines,
          vocabulary: result.vocabulary || [],
          grammarPoints: result.grammarPoints || [],
          culturalContext: visualCulturalNote,
          dialect: result.dialect,
          difficulty: result.difficulty,
          title: result.title,
          titleArabic: result.titleArabic,
        };

        if (jobIdRef.current === id) {
          setJob((prev) =>
            prev?.id === id
              ? { ...prev, status: "complete", progress: 100, progressLabel: "Complete!", result: jobResult }
              : prev
          );
        }

        toast.success("Transcription complete!", {
          description: `${sanitizedLines.length} segments from ${engines.length} engine${engines.length > 1 ? "s" : ""}${overlayCount > 0 ? `, ${overlayCount} screen text overlay${overlayCount !== 1 ? "s" : ""}` : ""}, ${(result.vocabulary || []).length} vocab items`,
          duration: 8000,
          action: {
            label: "Go to form",
            onClick: () => {
              const path = videoId
                ? `/admin/videos/${videoId}/edit`
                : "/admin/videos/new";
              window.location.href = path;
            },
          },
        });
      } catch (err) {
        console.error("Background transcription error:", err);
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        if (jobIdRef.current === id) {
          setJob((prev) =>
            prev?.id === id
              ? { ...prev, status: "error", progress: 0, progressLabel: "Failed", error: errorMsg }
              : prev
          );
        }
        toast.error("Transcription failed", { description: errorMsg });
      }
    },
    []
  );

  const consumeResult = useCallback(
    (videoId?: string): TranscriptionResult | null => {
      if (!job || job.status !== "complete") return null;
      // Match by videoId (or both undefined for new video form)
      if (job.videoId !== videoId) return null;
      const result = job.result ?? null;
      setJob(null);
      jobIdRef.current = null;
      return result;
    },
    [job]
  );

  const clearJob = useCallback(() => {
    setJob(null);
    jobIdRef.current = null;
  }, []);

  return (
    <TranscriptionJobContext.Provider value={{ job, startJob, consumeResult, clearJob }}>
      {children}
    </TranscriptionJobContext.Provider>
  );
}
