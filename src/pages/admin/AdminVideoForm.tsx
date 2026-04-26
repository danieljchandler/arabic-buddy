import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { extractTikTokVideoId, parseVideoUrl, getYouTubeThumbnail } from "@/lib/videoEmbed";
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

  const [isSaving, setIsSaving] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Time range selection
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

  // Auto-load audio from storage when editing an existing video
  useEffect(() => {
    if (!videoId || !existingVideo) return;
    if (stableAudioUrl) return; // already loaded (user uploaded or blob)
    if (audioFile) return; // user already picked a file

    const tryLoadAudio = async () => {
      // Strategy 1: video-audio bucket (private) — try signed URLs
      const extensions = ['.mp4', '.opus', '.m4a', '.webm'];
      for (const ext of extensions) {
        const { data } = await supabase.storage
          .from('video-audio')
          .createSignedUrl(`${videoId}${ext}`, 3600);
        if (data?.signedUrl) {
          setStableAudioUrl(data.signedUrl);
          return;
        }
      }

      // Strategy 2: audio bucket (public) via audio_files table lookup
      const parsed = parseVideoUrl(existingVideo.source_url);
      const ytId = parsed?.videoId;
      if (ytId) {
        const { data: audioRecord } = await supabase
          .from('audio_files')
          .select('storage_path')
          .eq('video_id', ytId)
          .limit(1)
          .maybeSingle();
        if (audioRecord?.storage_path) {
          const { data: urlData } = supabase.storage
            .from('audio')
            .getPublicUrl(audioRecord.storage_path);
          if (urlData?.publicUrl) {
            setStableAudioUrl(urlData.publicUrl);
            return;
          }
        }
      }
    };

    tryLoadAudio();
  }, [videoId, existingVideo, stableAudioUrl, audioFile]);

  // Track server-side processing status from polling
  const serverStatus = existingVideo?.transcription_status;
  useEffect(() => {
    if (serverStatus === 'processing' || serverStatus === 'pending') {
      setIsProcessing(true);
    } else if (serverStatus === 'completed' || serverStatus === 'failed') {
      setIsProcessing(false);
    }
  }, [serverStatus]);

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

  /**
   * Capture frame 0 from a video file, upload to flashcard-images bucket,
   * and return the public URL. Used for TikTok uploads where we can't fetch
   * a thumbnail from the embed.
   */
  const captureAndUploadThumbnail = useCallback(async (file: File): Promise<string | null> => {
    if (!file.type.startsWith("video/")) return null;
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      const cleanup = () => URL.revokeObjectURL(url);

      video.onloadeddata = async () => {
        try {
          // Seek to frame ~0.1s to ensure a real frame is rendered
          video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
        } catch {
          cleanup();
          resolve(null);
        }
      };

      video.onseeked = async () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 720;
          canvas.height = video.videoHeight || 1280;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            cleanup();
            resolve(null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob: Blob | null = await new Promise((res) =>
            canvas.toBlob((b) => res(b), "image/jpeg", 0.85)
          );
          cleanup();
          if (!blob) {
            resolve(null);
            return;
          }
          const path = `tiktok-thumbs/${crypto.randomUUID()}.jpg`;
          const { error: upErr } = await supabase.storage
            .from("flashcard-images")
            .upload(path, blob, { contentType: "image/jpeg", upsert: true });
          if (upErr) {
            console.error("Thumbnail upload error:", upErr);
            resolve(null);
            return;
          }
          const { data: pub } = supabase.storage.from("flashcard-images").getPublicUrl(path);
          resolve(pub?.publicUrl ?? null);
        } catch (err) {
          console.error("Thumbnail capture error:", err);
          cleanup();
          resolve(null);
        }
      };

      video.onerror = () => {
        cleanup();
        resolve(null);
      };
    });
  }, []);

  // Populate form when editing (or when server-side processing completes)
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
    if (sourceUrl.includes("tiktok.com")) {
      toast.info("Resolving TikTok URL...");
      try {
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
        toast.error("Could not resolve TikTok URL");
        return;
      }
    }

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

  const ensureUrlParsed = useCallback(async () => {
    if (sourceUrl && !embedUrl) {
      if (sourceUrl.includes("tiktok.com")) {
        try {
          const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
          const data = await response.json();
          const videoId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${sourceUrl}`);
          if (videoId) {
            setPlatform("tiktok");
            setEmbedUrl(`https://www.tiktok.com/player/v1/${videoId}`);
            return;
          }
        } catch (err) {
          console.error("TikTok auto-parse error:", err);
        }
      }
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

  /**
   * Creates (or reuses) the DB row, uploads audio to storage, and
   * kicks off the server-side pipeline. The user can leave immediately.
   */
  const kickOffServerPipeline = async (file: File) => {
    if (!user) return;
    await ensureUrlParsed();

    // Resolve embed URL
    let savePlatform = platform || "youtube";
    let saveEmbedUrl = embedUrl || sourceUrl;
    let saveThumbnail = thumbnailUrl;
    if (sourceUrl && !embedUrl) {
      const parsed = parseVideoUrl(sourceUrl);
      if (parsed) {
        savePlatform = parsed.platform;
        saveEmbedUrl = parsed.embedUrl;
        if (parsed.platform === "youtube") saveThumbnail = getYouTubeThumbnail(parsed.videoId);
      }
    }

    // TikTok requires both URL (for embed) and uploaded video file
    if (savePlatform === "tiktok") {
      if (!sourceUrl || !saveEmbedUrl || !saveEmbedUrl.includes("tiktok.com")) {
        toast.error("TikTok URL required", {
          description: "Paste the public TikTok link before uploading the file.",
        });
        return;
      }
    }

    // Capture thumbnail from uploaded video file when we don't already have one
    if (!saveThumbnail && file.type.startsWith("video/")) {
      const captured = await captureAndUploadThumbnail(file);
      if (captured) {
        saveThumbnail = captured;
        setThumbnailUrl(captured);
      }
    }

    let targetVideoId = videoId;

    try {
      setIsProcessing(true);

      if (!targetVideoId) {
        // Create the DB row first
        const record = {
          title: title || "Untitled Video",
          title_arabic: titleArabic || null,
          source_url: sourceUrl,
          platform: savePlatform,
          embed_url: saveEmbedUrl,
          thumbnail_url: saveThumbnail || null,
          duration_seconds: durationSeconds,
          dialect,
          difficulty,
          cultural_context: culturalContext || null,
          published: false,
          created_by: user.id,
          transcription_status: "pending",
        };
        const { data: inserted, error: insertErr } = await (supabase.from("discover_videos" as any) as any)
          .insert(record)
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        targetVideoId = inserted.id;
      } else {
        // Mark existing row as pending (and update thumbnail if we just captured one)
        const updates: Record<string, unknown> = { transcription_status: "pending" };
        if (saveThumbnail && saveThumbnail !== thumbnailUrl) updates.thumbnail_url = saveThumbnail;
        await (supabase.from("discover_videos" as any) as any)
          .update(updates)
          .eq("id", targetVideoId);
      }

      // Upload audio to storage
      const ext = file.name.split(".").pop() || "mp4";
      const storagePath = `${targetVideoId}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("video-audio")
        .upload(storagePath, file, { upsert: true });
      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        // Non-fatal — edge function will try download-media as fallback
      }

      // Start the backend pipeline and wait for the acknowledgement before
      // navigating away, otherwise mobile browsers can leave the video stuck in
      // "pending" if the request is interrupted.
      // Use supabase.functions.invoke so the SDK attaches the correct
      // apikey + (when available) session bearer. The function accepts the
      // publishable key as a fallback bearer when the user JWT is rejected
      // (e.g. asymmetric signing-key transition). This avoids the
      // "Failed to start processing (401)" stuck-in-pending bug.
      const { data: invokeData, error: invokeErr } = await supabase.functions.invoke(
        "process-approved-video",
        { body: { videoId: targetVideoId } }
      );

      if (invokeErr) {
        console.error("process-approved-video failed:", invokeErr);

        await (supabase.from("discover_videos" as any) as any)
          .update({
            transcription_status: "failed",
            transcription_error: `Failed to start processing: ${invokeErr.message ?? "unknown"}`,
          })
          .eq("id", targetVideoId);

        throw new Error(invokeErr.message || "Failed to start processing");
      }

      console.log("process-approved-video kicked off successfully", invokeData);


      toast.success("Processing started on server!", {
        description: "You can safely leave this page. Results will appear automatically.",
        duration: 6000,
      });

      // Navigate to edit page so polling picks up results
      if (!videoId) {
        navigate(`/admin/videos/${targetVideoId}/edit`);
      }

      queryClient.invalidateQueries({ queryKey: ["admin-discover-videos"] });
    } catch (err) {
      console.error("Pipeline kickoff error:", err);
      setIsProcessing(false);
      toast.error("Failed to start processing", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };


  const extractFunctionErrorMessage = async (fnError: any): Promise<string> => {
    let message = fnError?.message || "Request failed";

    try {
      const resp = fnError?.context;
      if (resp && typeof resp.json === "function") {
        const body = await resp.json();
        message = body?.error || body?.message || message;
      }
    } catch {
      // ignore parsing errors and keep fallback message
    }

    return message;
  };

  const downloadMediaAudio = async () => {
    const { data, error } = await supabase.functions.invoke("download-media", {
      body: { url: sourceUrl },
    });

    if (error) {
      return {
        data: null,
        errorMessage: await extractFunctionErrorMessage(error),
      };
    }

    if (!data?.audioBase64) {
      return {
        data: null,
        errorMessage: "No audio found",
      };
    }

    return { data, errorMessage: null as string | null };
  };

  const ensurePendingVideoRecord = async () => {
    if (!user) return null;

    let savePlatform = platform || "youtube";
    let saveEmbedUrl = embedUrl || sourceUrl;
    let saveThumbnail = thumbnailUrl;

    if (sourceUrl && !embedUrl) {
      const parsed = parseVideoUrl(sourceUrl);
      if (parsed) {
        savePlatform = parsed.platform;
        saveEmbedUrl = parsed.embedUrl;
        if (parsed.platform === "youtube") saveThumbnail = getYouTubeThumbnail(parsed.videoId);
      }
    }

    let targetVideoId = videoId;

    if (!targetVideoId) {
      const record = {
        title: title || "Untitled Video",
        title_arabic: titleArabic || null,
        source_url: sourceUrl,
        platform: savePlatform,
        embed_url: saveEmbedUrl,
        thumbnail_url: saveThumbnail || null,
        duration_seconds: durationSeconds,
        dialect,
        difficulty,
        cultural_context: culturalContext || null,
        published: false,
        created_by: user.id,
        transcription_status: "pending",
      };

      const { data: inserted, error: insertErr } = await (supabase.from("discover_videos" as any) as any)
        .insert(record)
        .select("id")
        .single();

      if (insertErr) throw insertErr;
      targetVideoId = inserted.id;
    } else {
      await (supabase.from("discover_videos" as any) as any)
        .update({ transcription_status: "pending", transcription_error: null })
        .eq("id", targetVideoId);
    }

    return targetVideoId;
  };

  const triggerRunPodFallback = async (options?: { createPendingRecord?: boolean }) => {
    const trimmedUrl = sourceUrl.trim();
    const parsed = parseVideoUrl(trimmedUrl);
    const extractedVideoId =
      parsed?.videoId ||
      trimmedUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];

    if (!extractedVideoId || (parsed && parsed.platform !== "youtube")) return false;

    let targetVideoId: string | null = videoId ?? null;

    try {
      if (options?.createPendingRecord) {
        targetVideoId = await ensurePendingVideoRecord();
        if (!targetVideoId) {
          toast.error("Please sign in to queue processing");
          return false;
        }
      }

      toast.info("Queuing audio extraction via RunPod…");
      const { data: rpData, error: rpError } = await supabase.functions.invoke("trigger-download", {
        body: {
          youtube_url: trimmedUrl,
          video_id: extractedVideoId,
          discover_video_id: targetVideoId,
        },
      });

      if (rpError) {
        const message = await extractFunctionErrorMessage(rpError);
        toast.error("Could not queue RunPod job", { description: message });
        return false;
      }

      if (options?.createPendingRecord && targetVideoId && !videoId) {
        navigate(`/admin/videos/${targetVideoId}/edit`);
      }

      setIsProcessing(true);
      queryClient.invalidateQueries({ queryKey: ["admin-discover-videos"] });
      toast.success(`RunPod job queued (${rpData?.job_id}). Transcription will continue automatically when audio arrives.`);
      return true;
    } catch (rpErr) {
      console.warn("RunPod queue error:", rpErr);
      return false;
    }
  };

  const handleDownloadAndProcess = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);

    const parsed = parseVideoUrl(sourceUrl.trim());
    if (parsed?.platform === "youtube") {
      const queued = await triggerRunPodFallback({ createPendingRecord: true });
      setIsDownloading(false);
      if (!queued) {
        toast.error("Could not queue RunPod extraction", {
          description: "Please retry or upload an audio file manually.",
        });
      }
      return;
    }

    toast.info("Downloading audio...");
    const { data, errorMessage } = await downloadMediaAudio();

    if (!data) {
      setIsDownloading(false);
      toast.error("Download failed — use 'Upload File' instead", {
        description: errorMessage || "Unknown error",
      });
      return;
    }

    try {
      const binaryStr = atob(data.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.contentType || "audio/mp4" });
      const downloadedFile = new File([blob], data.filename || "audio.mp4", { type: blob.type });
      setAudioFile(downloadedFile);
      detectFileDuration(downloadedFile);

      if (data.duration) {
        const dur = Math.round(data.duration);
        setDurationSeconds(dur);
        setMediaDuration(dur);
        setTimeRange([0, dur]);
      }

      toast.success("Audio downloaded! Starting server-side transcription…");
      setIsDownloading(false);
      await kickOffServerPipeline(downloadedFile);
    } catch (err) {
      setIsDownloading(false);
      toast.error("Downloaded audio could not be processed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  /**
   * Used by the "Load Audio" button in the transcript section.
   * Fetches existing audio for playback only — never triggers RunPod or the
   * transcription pipeline.
   */
  const handleLoadAudioForPlayback = async () => {
    if (!sourceUrl) return;
    setIsDownloading(true);

    try {
      // Strategy 1: video-audio bucket (staged / recently uploaded)
      if (videoId) {
        const extensions = ['.mp4', '.opus', '.m4a', '.webm', '.mp3'];
        for (const ext of extensions) {
          const { data } = await supabase.storage
            .from('video-audio')
            .createSignedUrl(`${videoId}${ext}`, 3600);
          if (data?.signedUrl) {
            setStableAudioUrl(data.signedUrl);
            toast.success("Audio loaded!");
            return;
          }
        }
      }

      // Strategy 2: audio bucket via audio_files table (YouTube)
      const parsed = parseVideoUrl(sourceUrl.trim());
      const ytId = parsed?.videoId;
      if (ytId) {
        const { data: audioRecord } = await supabase
          .from('audio_files')
          .select('storage_path')
          .eq('video_id', ytId)
          .limit(1)
          .maybeSingle();
        if (audioRecord?.storage_path) {
          const { data: urlData } = supabase.storage
            .from('audio')
            .getPublicUrl(audioRecord.storage_path);
          if (urlData?.publicUrl) {
            setStableAudioUrl(urlData.publicUrl);
            toast.success("Audio loaded!");
            return;
          }
        }
        // No cached audio found — don't trigger RunPod/pipeline from here
        toast.error("Audio not yet available", {
          description: "Use 'Upload File' to load audio, or re-transcribe the video first.",
        });
        return;
      }

      // Strategy 3: non-YouTube — download via download-media (no pipeline trigger)
      const { data: downloadData, errorMessage } = await downloadMediaAudio();
      if (!downloadData) {
        toast.error("Could not load audio", {
          description: errorMessage || "Please upload the audio file manually.",
        });
        return;
      }

      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: downloadData.contentType || "audio/mp4" });
      const file = new File([blob], "audio.mp4", { type: blob.type });
      setAudioFile(file);
      detectFileDuration(file);
      toast.success("Audio loaded!");
    } catch (err) {
      toast.error("Could not load audio", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadAudio = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);

    const parsed = parseVideoUrl(sourceUrl.trim());
    if (parsed?.platform === "youtube") {
      const queued = await triggerRunPodFallback();
      setIsDownloading(false);
      if (!queued) {
        toast.error("Could not queue RunPod extraction", {
          description: "Please retry or upload an audio file manually.",
        });
      }
      return;
    }

    try {
      const { data: downloadData, errorMessage } = await downloadMediaAudio();

      if (!downloadData) {
        toast.error("Download failed — use 'Upload File' instead", {
          description: errorMessage || "Unknown error",
        });
        return;
      }

      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
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
      toast.error("Downloaded audio could not be processed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSave = async () => {
    let savePlatform = platform;
    let saveEmbedUrl = embedUrl;
    let saveThumbnail = thumbnailUrl;
    if (sourceUrl && !saveEmbedUrl) {
      if (sourceUrl.includes("tiktok.com")) {
        try {
          const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
          const data = await response.json();
          const vid = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${sourceUrl}`);
          if (vid) {
            saveEmbedUrl = `https://www.tiktok.com/player/v1/${vid}`;
            savePlatform = "tiktok";
            setPlatform(savePlatform);
            setEmbedUrl(saveEmbedUrl);
          }
        } catch (err) {
          console.error("TikTok save parse error:", err);
        }
      }
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
          saveEmbedUrl = sourceUrl;
          savePlatform = savePlatform || "youtube";
          setEmbedUrl(saveEmbedUrl);
          setPlatform(savePlatform);
        }
      }
    }

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
        {/* Background transcription status banner */}
        {isEditing && existingVideo && (existingVideo as any).transcription_status === 'processing' && (
          <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="py-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">
                Transcription is being processed on the server. This page will update automatically when complete.
              </span>
            </CardContent>
          </Card>
        )}
        {isEditing && existingVideo && (existingVideo as any).transcription_status === 'failed' && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="py-3 space-y-2">
              <p className="text-sm font-medium text-destructive">
                Background transcription failed
              </p>
              {(existingVideo as any).transcription_error && (
                <p className="text-xs text-destructive/80">{(existingVideo as any).transcription_error}</p>
              )}
              <p className="text-xs text-muted-foreground">
                You can manually download and transcribe the audio using the controls below.
              </p>
            </CardContent>
          </Card>
        )}
        {isEditing && existingVideo && (existingVideo as any).transcription_status === 'pending' && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="py-3 flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">
                Transcription is queued and will start shortly. You can safely leave this page.
              </span>
            </CardContent>
          </Card>
        )}

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
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing on server…</>
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
                <Button
                  onClick={() => {
                    if (!audioFile) return;
                    kickOffServerPipeline(audioFile);
                  }}
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing on server — you can navigate away</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" />Transcribe & Analyze (server-side)</>
                  )}
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
                    onClick={handleLoadAudioForPlayback}
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
