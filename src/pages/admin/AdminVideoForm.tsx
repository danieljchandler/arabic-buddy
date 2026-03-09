import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { extractTikTokVideoId, parseVideoUrl, getYouTubeThumbnail } from "@/lib/videoEmbed";
import { extractFramesWithTimestamps } from "@/lib/videoFrameExtractor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft, Sparkles, Save, Upload, Download, Plus, Trash2 } from "lucide-react";
import { AdminTranscriptEditor } from "@/components/admin/AdminTranscriptEditor";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { TranscriptLine } from "@/types/transcript";
import { TimeRangeSelector } from "@/components/transcript/TimeRangeSelector";

const DIALECTS = ["Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani", "Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Expert"];

const AdminVideoForm = () => {
  const navigate = useNavigate();
  const { videoId } = useParams<{ videoId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Pre-warm RunPod endpoints (Jais + Falcon) so cold starts happen before pipeline runs
  useEffect(() => {
    supabase.functions.invoke("warmup-runpod").catch(() => {});
  }, []);
  const isEditing = !!videoId;
  const { data: existingVideo, isLoading: loadingVideo } = useDiscoverVideo(videoId);

  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [titleArabic, setTitleArabic] = useState("");
  const [platform, setPlatform] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [dialect, setDialect] = useState("Gulf");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [published, setPublished] = useState(false);
  const [culturalContext, setCulturalContext] = useState("");
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [vocabulary, setVocabulary] = useState<any[]>([]);
  const [grammarPoints, setGrammarPoints] = useState<any[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Time range selection (no limit for admin discover videos)
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Stable blob URL for audio playback in transcript editor
  const [stableAudioUrl, setStableAudioUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!audioFile) {
      setStableAudioUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setStableAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    detectFileDuration(file);
    ensureUrlParsed();
    toast.success("File loaded! Select the time range, then process.");
  };

  const detectFileDuration = useCallback((file: File) => {
    const el = file.type.startsWith("video/") ? document.createElement("video") : document.createElement("audio");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    el.src = url;
    el.onloadedmetadata = () => {
      const dur = Math.ceil(el.duration);
      setMediaDuration(dur);
      setDurationSeconds(dur);
      setTimeRange([0, dur]);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => URL.revokeObjectURL(url);
  }, []);

  // Populate form when editing
  useEffect(() => {
    if (existingVideo) {
      setSourceUrl(existingVideo.source_url);
      setTitle(existingVideo.title);
      setTitleArabic(existingVideo.title_arabic || "");
      setPlatform(existingVideo.platform);
      setEmbedUrl(existingVideo.embed_url);
      setThumbnailUrl(existingVideo.thumbnail_url || "");
      setDurationSeconds(existingVideo.duration_seconds);
      setDialect(existingVideo.dialect);
      setDifficulty(existingVideo.difficulty);
      setPublished(existingVideo.published);
      setCulturalContext(existingVideo.cultural_context || "");
      setTranscriptLines(((existingVideo.transcript_lines as any[]) ?? []) as TranscriptLine[]);
      setVocabulary(((existingVideo.vocabulary as any[]) ?? []) as any[]);
      setGrammarPoints(((existingVideo.grammar_points as any[]) ?? []) as any[]);
    }
  }, [existingVideo]);

  const handleUrlParse = async () => {
    // Check if it's a TikTok URL first (including short URLs)
    if (sourceUrl.includes("tiktok.com")) {
      toast.info("Resolving TikTok URL...");
      try {
        // Use TikTok's oEmbed API to get proper embed URL
        const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
        const data = await response.json();

        const videoId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${sourceUrl}`);
        if (videoId) {
          const embedUrl = `https://www.tiktok.com/player/v1/${videoId}`;
          setPlatform("tiktok");
          setEmbedUrl(embedUrl);
          toast.success(`TikTok video detected (ID: ${videoId})`);
          return;
        }
      } catch (err) {
        console.error("TikTok oEmbed error:", err);
        toast.error("Could not resolve TikTok URL", {
          description: "Please try copying the full URL from the TikTok video page",
        });
        return;
      }
    }

    // For non-TikTok URLs, use the original parser
    const parsed = parseVideoUrl(sourceUrl);
    if (!parsed) {
      toast.error("Unsupported URL", { description: "Please use a YouTube, TikTok, or Instagram URL" });
      return;
    }
    setPlatform(parsed.platform);
    setEmbedUrl(parsed.embedUrl);
    if (parsed.platform === "youtube") {
      setThumbnailUrl(getYouTubeThumbnail(parsed.videoId));
    }

    toast.success(`Detected ${parsed.platform} video`);
  };

  // Auto-parse URL if not already parsed
  const ensureUrlParsed = useCallback(async () => {
    if (sourceUrl && !embedUrl) {
      // Handle TikTok URLs specially
      if (sourceUrl.includes("tiktok.com")) {
        try {
          const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
          const data = await response.json();
          const videoId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${sourceUrl}`);
          if (videoId) {
            const embedUrl = `https://www.tiktok.com/player/v1/${videoId}`;
            setPlatform("tiktok");
            setEmbedUrl(embedUrl);
            return;
          }
        } catch (err) {
          console.error("TikTok auto-parse error:", err);
        }
      }

      // Fallback to regular parser
      const parsed = parseVideoUrl(sourceUrl);
      if (parsed) {
        setPlatform(parsed.platform);
        setEmbedUrl(parsed.embedUrl);
        if (parsed.platform === "youtube") {
          setThumbnailUrl(getYouTubeThumbnail(parsed.videoId));
        }
      }
    }
  }, [sourceUrl, embedUrl]);

  const handleDownloadAndProcess = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);
    let downloadedFile: File | null = null;
    try {
      toast.info("Downloading audio...");
      const { data, error } = await supabase.functions.invoke("download-media", {
        body: { url: sourceUrl },
      });
      if (error) {
        console.error("download-media error:", error);
        let realMsg = error.message;
        try {
          const resp = (error as any)?.context;
          if (resp && typeof resp.json === "function") {
            const body = await resp.json();
            realMsg = body?.error || body?.message || realMsg;
          }
        } catch { /* ignore parse errors */ }
        throw new Error(realMsg);
      }
      if (!data?.audioBase64) throw new Error("No audio found");

      const binaryStr = atob(data.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.contentType || "audio/mp4" });
      downloadedFile = new File([blob], data.filename || "audio.mp4", { type: blob.type });
      setAudioFile(downloadedFile);
      detectFileDuration(downloadedFile);
      if (data.duration) {
        const dur = Math.round(data.duration);
        setDurationSeconds(dur);
        setMediaDuration(dur);
        setTimeRange([0, dur]);
      }
      toast.success("Audio downloaded! Starting transcription...");
    } catch (err) {
      console.error("Download error:", err);
      toast.error("Download failed — use 'Upload File' instead", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      return;
    } finally {
      setIsDownloading(false);
    }
    if (downloadedFile) await handleProcess(downloadedFile);
  };

  const handleDownloadAudio = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);
    try {
      const { data: downloadData, error: downloadError } = await supabase.functions.invoke("download-media", {
        body: { url: sourceUrl },
      });
      if (downloadError) {
        console.error("download-media error:", downloadError);
        let realMsg = downloadError.message;
        try {
          const resp = (downloadError as any)?.context;
          if (resp && typeof resp.json === "function") {
            const body = await resp.json();
            realMsg = body?.error || body?.message || realMsg;
          }
        } catch { /* ignore parse errors */ }
        throw new Error(realMsg);
      }
      if (!downloadData?.audioBase64) throw new Error("No audio found");

      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: downloadData.contentType || "audio/mp4" });
      const file = new File([blob], "audio.mp4", { type: blob.type });
      setAudioFile(file);
      detectFileDuration(file);

      if (downloadData.duration) {
        const dur = Math.round(downloadData.duration);
        setDurationSeconds(dur);
        setMediaDuration(dur);
        setTimeRange([0, dur]);
      }

      toast.success("Audio downloaded! Select the time range, then process.");
    } catch (err) {
      console.error("Download error:", err);
      toast.error("Download failed — use 'Upload File' instead", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleProcess = async (fileOverride?: File) => {
    const targetFile = fileOverride ?? audioFile;
    if (!targetFile) {
      toast.error("Download audio first");
      return;
    }
    setIsProcessing(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const projectUrl = import.meta.env.VITE_SUPABASE_URL;
      const authHeaders = { Authorization: `Bearer ${session?.access_token}` };

      // Start visual analysis in parallel if the file is a video
      const isVideoFile = targetFile.type.startsWith("video/");
      const visualPromise = isVideoFile
        ? (async () => {
            try {
              const frames = await extractFramesWithTimestamps(targetFile, 4, 12, 640);
              const { data, error } = await supabase.functions.invoke("extract-visual-context", {
                body: { frames, audioDuration: mediaDuration ?? undefined },
              });
              if (error || !data?.success) return null;
              return data.result;
            } catch (err) {
              console.warn("Visual analysis failed (non-blocking):", err);
              return null;
            }
          })()
        : Promise.resolve(null);

      // Run all ASR engines in parallel
      toast.info("Transcribing with Deepgram, Fanar & Soniox...");

      const munsitFormData = new FormData();
      munsitFormData.append("audio", targetFile);
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
      deepgramFormData.append("file", targetFile);
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
      fanarFormData.append("audio", targetFile);
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
      sonioxFormData.append("audio", new File([targetFile], targetFile.name, { type: targetFile.type }));
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

      // Extract texts from each engine
      const munsitText = munsitResult.status === "fulfilled" ? (munsitResult.value.text || "") : "";
      const deepgramData = deepgramResult.status === "fulfilled" ? deepgramResult.value : null;
      const deepgramText = deepgramData?.text || "";
      const fanarText = fanarResult.status === "fulfilled" ? (fanarResult.value.text || "") : "";
      const sonioxText = sonioxResult.status === "fulfilled" && sonioxResult.value.sonioxUsed ? (sonioxResult.value.text || "") : "";

      // Log results
      if (munsitResult.status === "rejected") console.warn("Munsit failed:", munsitResult.reason);
      else if (munsitResult.status === "fulfilled" && !munsitResult.value.text && munsitResult.value.error) {
        console.warn("Munsit failed (non-blocking):", munsitResult.value.error);
      }
      if (deepgramResult.status === "rejected") console.warn("Deepgram failed:", deepgramResult.reason);
      if (fanarResult.status === "rejected") console.warn("Fanar failed:", fanarResult.reason);
      else if (fanarResult.status === "fulfilled" && !fanarResult.value.text && fanarResult.value.reason) {
        console.log(`Fanar excluded: ${fanarResult.value.reason}`);
      }
      if (sonioxResult.status === "rejected") console.warn("Soniox failed:", sonioxResult.reason);
      else if (sonioxResult.status === "fulfilled" && !sonioxResult.value.sonioxUsed) {
        console.log(`Soniox excluded: ${sonioxResult.value.reason || 'not used'}`);
      }

      const engines: string[] = [];
      if (munsitText) engines.push("Munsit");
      if (deepgramText) engines.push("Deepgram");
      if (fanarText) engines.push("Fanar");
      if (sonioxText) engines.push("Soniox");

      if (engines.length === 0) {
        throw new Error("All transcription engines failed. Please try again.");
      }

      toast.info(`Got transcriptions from: ${engines.join(", ")}. Analyzing...`);

      // Use Deepgram as the primary transcript (has word-level timestamps).
      // Fall back to Munsit or Fanar if Deepgram failed.
      const primaryText = deepgramText || munsitText || fanarText;

      // Filter Deepgram words by selected time range for timestamp mapping
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

      // Extract visual context result (non-blocking — undefined if failed or not a video)
      const visualContextData = visualResult.status === "fulfilled" ? visualResult.value : null;
      if (visualContextData) {
        const segmentCount = visualContextData.onScreenTextSegments?.length ?? 0;
        toast.info(`Visual analysis complete — ${segmentCount} on-screen text segment${segmentCount !== 1 ? "s" : ""} detected`);
      }

      // Build a compact visual context string to pass to the translation model
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

      // Send all available transcripts to the analysis function for intelligent merging
      const analyzeBody: Record<string, string> = { transcript: filteredPrimaryText };
      if (munsitText && munsitText !== filteredPrimaryText) {
        analyzeBody.munsitTranscript = munsitText;
      }
      if (fanarText) {
        analyzeBody.fanarTranscript = fanarText;
      }
      if (sonioxText) {
        analyzeBody.sonioxTranscript = sonioxText;
      }
      // Pass Soniox translation as an additional reference for the analysis
      const sonioxTranslation = sonioxResult.status === "fulfilled" ? sonioxResult.value.translationText : null;
      if (sonioxTranslation) {
        analyzeBody.sonioxTranslation = sonioxTranslation;
      }
      if (visualContextStr) {
        analyzeBody.visualContext = visualContextStr;
      }

      toast.info("Analyzing transcript...");
      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke("analyze-gulf-arabic", {
        body: analyzeBody,
      });
      if (analyzeError) throw new Error(analyzeError.message);
      if (!analyzeData?.success) throw new Error(analyzeData?.error || "Analysis failed");

      const result = analyzeData.result;

      // Map timestamps to lines if available
      let lines = result.lines || [];
      if (relativeWords.length > 0 && lines.length > 0) {
        const words = relativeWords;
        let wordIdx = 0;
        lines = lines.map((line: any) => {
          const lineWords = line.arabic?.split(/\s+/).filter(Boolean) || [];
          let startMs: number | undefined;
          let endMs: number | undefined;

          for (const _lw of lineWords) {
            if (wordIdx < words.length) {
              if (startMs === undefined) startMs = Math.round(words[wordIdx].start * 1000);
              endMs = Math.round(words[wordIdx].end * 1000);
              wordIdx++;
            }
          }

          return { ...line, startMs, endMs };
        });
      }

      // Merge on-screen text segments as text_overlay lines
      let mergedLines = lines;
      if (visualContextData?.onScreenTextSegments?.length > 0) {
        const overlayLines: TranscriptLine[] = visualContextData.onScreenTextSegments.map(
          (seg: any, idx: number) => ({
            id: `overlay-${idx}-${Date.now()}`,
            arabic: String(seg.text ?? ""),
            translation: String(seg.translation ?? ""),
            tokens: String(seg.text ?? "").split(/\s+/).filter(Boolean).map((w: string, wi: number) => ({
              id: `otok-${idx}-${wi}`,
              surface: w,
            })),
            startMs: typeof seg.startSeconds === "number" ? Math.round(seg.startSeconds * 1000) : undefined,
            endMs: typeof seg.endSeconds === "number" ? Math.round(seg.endSeconds * 1000) : undefined,
            segmentType: "text_overlay" as const,
          })
        );
        // Interleave overlay lines with audio lines ordered by startMs
        const allLines = [...mergedLines, ...overlayLines].sort((a, b) => {
          const aMs = a.startMs ?? Infinity;
          const bMs = b.startMs ?? Infinity;
          return aMs - bMs;
        });
        mergedLines = allLines;
      }

      // Ensure every line has a valid tokens array (guards against API returning lines without tokens)
      const sanitizedLines = mergedLines.map((line: any) => ({
        ...line,
        tokens: Array.isArray(line.tokens)
          ? line.tokens
          : String(line.arabic ?? "").split(/\s+/).filter(Boolean).map((w: string, wi: number) => ({
              id: `tok-${line.id ?? wi}-${wi}`,
              surface: w,
            })),
      }));
      setTranscriptLines(sanitizedLines);
      setVocabulary(result.vocabulary || []);
      setGrammarPoints(result.grammarPoints || []);
      // Merge visual cultural context with audio analysis cultural context
      const audioCulturalContext = result.culturalContext || "";
      const visualCulturalNote = visualContextData?.culturalContext
        ? (audioCulturalContext ? `${audioCulturalContext}\n\nVisual context: ${visualContextData.culturalContext}` : visualContextData.culturalContext)
        : audioCulturalContext;
      setCulturalContext(visualCulturalNote);

      // Auto-populate dialect + difficulty from AI detection
      if (result.dialect) setDialect(result.dialect);
      if (result.difficulty) setDifficulty(result.difficulty);
      if (result.dialect || result.difficulty) {
        toast.info(
          `Auto-detected: ${result.dialect || "Gulf"} dialect · ${result.difficulty || "Intermediate"} difficulty`,
          { duration: 4000 }
        );
      }

      // Auto-populate title if empty
      if (!title && result.title) {
        setTitle(result.title);
      }
      if (!titleArabic && result.titleArabic) {
        setTitleArabic(result.titleArabic);
      }

      // Duration already set during download step

      const overlayCount = visualContextData?.onScreenTextSegments?.length ?? 0;
      toast.success("Processing complete!", {
        description: `${mergedLines.length} segments from ${engines.length} engine${engines.length > 1 ? "s" : ""}${overlayCount > 0 ? `, ${overlayCount} screen text overlay${overlayCount !== 1 ? "s" : ""}` : ""}, ${(result.vocabulary || []).length} vocab items`,
      });
    } catch (err) {
      console.error("Processing error:", err);
      toast.error("Processing failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    // Auto-parse URL if not done yet
    let savePlatform = platform;
    let saveEmbedUrl = embedUrl;
    let saveThumbnail = thumbnailUrl;
    if (sourceUrl && !saveEmbedUrl) {
      // Handle TikTok specially
      if (sourceUrl.includes("tiktok.com")) {
        try {
          const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
          const data = await response.json();
          const videoId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${sourceUrl}`);
          if (videoId) {
            saveEmbedUrl = `https://www.tiktok.com/player/v1/${videoId}`;
            savePlatform = "tiktok";
            setPlatform(savePlatform);
            setEmbedUrl(saveEmbedUrl);
          }
        } catch (err) {
          console.error("TikTok save parse error:", err);
        }
      }

      // If still no embed URL, try regular parser
      if (!saveEmbedUrl) {
        const parsed = parseVideoUrl(sourceUrl);
        if (parsed) {
          savePlatform = parsed.platform;
          saveEmbedUrl = parsed.embedUrl;
          setPlatform(savePlatform);
          setEmbedUrl(saveEmbedUrl);
          if (parsed.platform === "youtube") {
            saveThumbnail = getYouTubeThumbnail(parsed.videoId);
            setThumbnailUrl(saveThumbnail);
          }
        } else {
          // Final fallback: use sourceUrl directly as embed URL
          saveEmbedUrl = sourceUrl;
          savePlatform = savePlatform || "youtube";
          setEmbedUrl(saveEmbedUrl);
          setPlatform(savePlatform);
        }
      }
    }

    // Auto-generate title from first transcript line if still empty
    let saveTitle = title;
    if (!saveTitle && transcriptLines.length > 0) {
      saveTitle = (transcriptLines[0] as any).arabic?.slice(0, 60) || "Untitled Video";
      setTitle(saveTitle);
    }
    if (!saveTitle) {
      saveTitle = "Untitled Video";
      setTitle(saveTitle);
    }

    if (!sourceUrl) {
      toast.error("Please enter a video URL");
      return;
    }
    setIsSaving(true);

    try {
      const record = {
        title: saveTitle,
        title_arabic: titleArabic || null,
        source_url: sourceUrl,
        platform: savePlatform,
        embed_url: saveEmbedUrl,
        thumbnail_url: saveThumbnail || null,
        duration_seconds: durationSeconds,
        dialect,
        difficulty,
        transcript_lines: transcriptLines as any,
        vocabulary: vocabulary as any,
        grammar_points: grammarPoints as any,
        cultural_context: culturalContext || null,
        published,
        created_by: user!.id,
      };

      if (isEditing) {
        const { error } = await (supabase.from("discover_videos" as any) as any).update(record).eq("id", videoId);
        if (error) throw error;
        toast.success("Video updated!");
      } else {
        const { error } = await (supabase.from("discover_videos" as any) as any).insert(record);
        if (error) throw error;
        toast.success("Video created!");
      }

      queryClient.invalidateQueries({ queryKey: ["admin-discover-videos"] });
      navigate("/admin/videos");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing && loadingVideo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/videos")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">{isEditing ? "Edit Video" : "Add Video"}</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* URL Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Video Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Video URL</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://youtube.com/watch?v=... or https://www.tiktok.com/@user/video/..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <Button variant="outline" onClick={handleUrlParse} disabled={!sourceUrl}>
                  Parse
                </Button>
              </div>
            </div>

            {platform && (
              <div className="flex gap-2 items-center">
                <Badge variant="outline" className="capitalize">
                  {platform}
                </Badge>
                {thumbnailUrl && <img src={thumbnailUrl} alt="" className="h-12 rounded" />}
              </div>
            )}

            {/* Step 1: Download or Upload */}
            {!audioFile ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    onClick={handleDownloadAndProcess}
                    disabled={!sourceUrl || isDownloading || isProcessing}
                    className="flex-1"
                  >
                    {isDownloading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Downloading...</>
                    ) : isProcessing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Transcribing...</>
                    ) : (
                      <><Download className="h-4 w-4 mr-2" />{isEditing ? "Download & Re-transcribe" : "Download Audio and Transcribe"}</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDownloadAudio}
                    disabled={!sourceUrl || isDownloading || isProcessing}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><Download className="h-4 w-4 mr-2" />Audio Only</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById("audio-upload")?.click()}
                    disabled={isDownloading || isProcessing}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>
                  <input id="audio-upload" type="file" accept="audio/*,video/*" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 items-center">
                  <Badge variant="secondary" className="py-1.5">✓ Audio Ready</Badge>
                  <Button variant="ghost" size="sm" onClick={() => { setAudioFile(null); setMediaDuration(null); }}>Change</Button>
                </div>
                {mediaDuration && mediaDuration > 0 && (
                  <TimeRangeSelector duration={mediaDuration} maxRange={mediaDuration} value={timeRange} onChange={setTimeRange} />
                )}
                <Button onClick={() => handleProcess()} disabled={isProcessing} className="w-full">
                  {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : <><Sparkles className="h-4 w-4 mr-2" />Transcribe & Analyze</>}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video title" />
            </div>
            <div className="space-y-2">
              <Label>Arabic Title</Label>
              <Input
                value={titleArabic}
                onChange={(e) => setTitleArabic(e.target.value)}
                dir="rtl"
                placeholder="عنوان الفيديو"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dialect *</Label>
                <Select value={dialect} onValueChange={setDialect}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIALECTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Difficulty *</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Duration (seconds)</Label>
              <Input
                type="number"
                value={durationSeconds ?? ""}
                onChange={(e) => setDurationSeconds(e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Cultural Context</Label>
              <Textarea
                value={culturalContext}
                onChange={(e) => setCulturalContext(e.target.value)}
                placeholder="Optional cultural notes for viewers..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={published} onCheckedChange={setPublished} />
              <Label>Published (visible to all users)</Label>
            </div>
          </CardContent>
        </Card>

        {/* Editable Transcript */}
        {transcriptLines.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Transcript</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!stableAudioUrl && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm text-muted-foreground flex-1">
                    Load audio to listen to each line and verify timestamps.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadAudio}
                    disabled={!sourceUrl || isDownloading}
                  >
                    {isDownloading ? (
                      <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Loading...</>
                    ) : (
                      <><Download className="h-3 w-3 mr-2" />Load Audio</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("audio-upload-transcript")?.click()}
                    disabled={isDownloading}
                  >
                    <Upload className="h-3 w-3 mr-2" />
                    Upload
                  </Button>
                  <input id="audio-upload-transcript" type="file" accept="audio/*,video/*" className="hidden" aria-label="Upload audio or video file for transcript playback" onChange={handleFileUpload} />
                </div>
              )}
              <AdminTranscriptEditor
                lines={transcriptLines}
                onChange={setTranscriptLines}
                audioUrl={stableAudioUrl}
              />
            </CardContent>
          </Card>
        )}

        {/* Editable Vocabulary */}
        {vocabulary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vocabulary ({vocabulary.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {vocabulary.map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/50">
                  <Input
                    value={item.arabic || ""}
                    onChange={(e) => {
                      const updated = [...vocabulary];
                      updated[i] = { ...item, arabic: e.target.value };
                      setVocabulary(updated);
                    }}
                    dir="rtl"
                    className="flex-1 h-8 text-sm"
                    style={{ fontFamily: "'Cairo', sans-serif" }}
                    placeholder="Arabic"
                  />
                  <Input
                    value={item.english || ""}
                    onChange={(e) => {
                      const updated = [...vocabulary];
                      updated[i] = { ...item, english: e.target.value };
                      setVocabulary(updated);
                    }}
                    className="flex-1 h-8 text-sm"
                    placeholder="English"
                  />
                  <Input
                    value={item.root || ""}
                    onChange={(e) => {
                      const updated = [...vocabulary];
                      updated[i] = { ...item, root: e.target.value };
                      setVocabulary(updated);
                    }}
                    dir="rtl"
                    className="w-20 h-8 text-sm"
                    placeholder="Root"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive/50 hover:text-destructive shrink-0"
                    onClick={() => setVocabulary(vocabulary.filter((_: any, j: number) => j !== i))}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVocabulary([...vocabulary, { arabic: "", english: "", root: "" }])}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Word
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Editable Grammar Points */}
        {grammarPoints.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Grammar Points ({grammarPoints.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {grammarPoints.map((gp: any, i: number) => (
                <div key={i} className="p-3 rounded bg-muted/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={gp.title || ""}
                      onChange={(e) => {
                        const updated = [...grammarPoints];
                        updated[i] = { ...gp, title: e.target.value };
                        setGrammarPoints(updated);
                      }}
                      className="flex-1 h-8 text-sm font-medium"
                      placeholder="Title"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive/50 hover:text-destructive shrink-0"
                      onClick={() => setGrammarPoints(grammarPoints.filter((_: any, j: number) => j !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <Textarea
                    value={gp.explanation || ""}
                    onChange={(e) => {
                      const updated = [...grammarPoints];
                      updated[i] = { ...gp, explanation: e.target.value };
                      setGrammarPoints(updated);
                    }}
                    className="text-sm"
                    rows={2}
                    placeholder="Explanation"
                  />
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGrammarPoints([...grammarPoints, { title: "", explanation: "" }])}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Grammar Point
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Save button */}
        <Button onClick={handleSave} disabled={isSaving} className="w-full" size="lg">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isEditing ? "Update Video" : "Save Video"}
        </Button>
      </main>
    </div>
  );
};

export default AdminVideoForm;
