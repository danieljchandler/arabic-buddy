import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
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
import { Loader2, ArrowLeft, Sparkles, Save, Upload, Download, Image as ImageIcon } from "lucide-react";
import { AdminTranscriptEditor } from "@/components/admin/AdminTranscriptEditor";
import { TranscriptDraftBanner } from "@/components/admin/TranscriptDraftBanner";
import { useTranscriptDraft } from "@/hooks/useTranscriptDraft";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LineRevisionHistory from "@/components/admin/transcribe/LineRevisionHistory";
import LineComments from "@/components/admin/transcribe/LineComments";
import VideoNotesEditor, {
  type DialectFeature,
  type GrammarPoint,
  type VocabEntry,
} from "@/components/admin/transcribe/VideoNotesEditor";
import type { LineReviewSlot } from "@/components/TranscriptEditor";
import { useTranscriptReview } from "@/hooks/useTranscriptReview";
import { reviewProgress, reviewStateFor } from "@/lib/reviewStatus";
import { linesEqual } from "@/lib/transcriptDraft";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { TranscriptLine } from "@/types/transcript";
import { TimeRangeSelector } from "@/components/transcript/TimeRangeSelector";
import { extractFramesWithTimestamps } from "@/lib/videoFrameExtractor";
import { extractAudioForAsr } from "@/lib/audioToWav";
import { resolveStagedVideoAudioUrl, STAGED_AUDIO_EXTENSIONS } from "@/lib/videoAudioStaging";
import { VideoThumbnail } from "@/components/media/VideoThumbnail";
// The same array the review workspace offers and the `transcript-review` write
// path validates against. Two copies would drift, and the one that drifts is
// always the one enforcing.
import { REVIEWABLE_DIALECTS, subvarietyLabel } from "../../../supabase/functions/_shared/dialectSubvarieties";

const DIALECTS = REVIEWABLE_DIALECTS;
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Expert"];
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const isVideoFile = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);

function GenerateGrammarRow({
  videoId,
  onAdded,
}: {
  videoId: string;
  onAdded: (added: number) => void;
}) {
  const [level, setLevel] = useState<string>("B1");
  const [count, setCount] = useState<number>(4);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-grammar-points", {
        body: { video_id: videoId, target_level: level, count },
      });
      if (error) throw error;
      const added = (data as any)?.added ?? 0;
      if (added > 0) toast.success(`Added ${added} grammar note${added === 1 ? "" : "s"} at ${level}`);
      else toast.info((data as any)?.message || "No new grammar notes");
      onAdded(added);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Target level</Label>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CEFR_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Count</Label>
        <Input
          type="number"
          min={1}
          max={8}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 4)))}
          className="h-9 w-20"
        />
      </div>
      <Button onClick={handleClick} disabled={busy} size="sm">
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
        Generate
      </Button>
      <p className="text-xs text-muted-foreground basis-full">
        Adds new level-tagged points to this video. Existing titles are skipped.
      </p>
    </div>
  );
}

const AdminVideoForm = () => {
  const navigate = useNavigate();
  const { videoId } = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const memeQueryFlag = searchParams.get("meme") === "1";
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /**
   * Who is looking, and what they may do here.
   *
   * This page is now the one workspace for everyone who touches a transcript:
   * admins and content reviewers manage the video itself, and a transcriber — a
   * native speaker hired to check the Arabic, not a member of staff — checks
   * and corrects lines. The management surface (publish, delete, re-running the
   * pipeline, metadata) is hidden from a transcriber; RLS and the
   * `transcript-review` function are what actually enforce that split, this
   * just stops the page offering buttons that would only ever error.
   *
   * `canManage` stays false until the roles have loaded, so a transcriber never
   * sees the management controls flash before their role resolves.
   */
  const {
    isAdmin,
    isContentReviewer,
    isRecorder,
    loading: rolesLoading,
  } = useAdminAuth();
  const canManage = !rolesLoading && (isAdmin || isContentReviewer || isRecorder);

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
  const [cefrLevel, setCefrLevel] = useState<string | null>(null);
  const [difficultyRationale, setDifficultyRationale] = useState<string | null>(null);
  const [isRating, setIsRating] = useState(false);
  const [published, setPublished] = useState(false);
  const [isMeme, setIsMeme] = useState(memeQueryFlag);


  // Apply ?meme=1 default for brand new videos.
  useEffect(() => {
    if (!videoId && memeQueryFlag) setIsMeme(true);
  }, [videoId, memeQueryFlag]);
  const [culturalContext, setCulturalContext] = useState("");
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [vocabulary, setVocabulary] = useState<any[]>([]);
  const [grammarPoints, setGrammarPoints] = useState<any[]>([]);

  /**
   * Whether the transcript in this form has been edited in this session.
   *
   * The hydrate-from-server effect below re-seeds every field whenever the video
   * row arrives again, which is right for a first load and destructive once
   * somebody is halfway through a correction pass: a background refetch would
   * drop an hour of unpublished work back to the stored transcript with no
   * warning. A ref rather than `draft.dirty`, because an empty transcript
   * filling in when background transcription finishes is also a difference from
   * what was stored, and that one must still land.
   */
  const transcriptEdited = useRef(false);

  /**
   * The transcript as of *right now*, not as of the last render.
   *
   * The editor flushes its pending edit synchronously before actions like
   * re-translate, and the handler that runs next must see that flush — reading
   * `transcriptLines` from state there would act on the version one render old.
   */
  const latestLines = useRef<TranscriptLine[]>([]);
  useEffect(() => {
    latestLines.current = transcriptLines;
  }, [transcriptLines]);

  const handleTranscriptChange = useCallback((next: TranscriptLine[]) => {
    transcriptEdited.current = true;
    latestLines.current = next;
    setTranscriptLines(next);
  }, []);

  /**
   * The transcript as it is actually stored, which is what "published" means
   * here — the editor's copy is compared against it to decide whether there is
   * anything unpublished to warn about or to keep safe.
   */
  const publishedLines = useMemo(
    () => ((existingVideo?.transcript_lines as unknown as TranscriptLine[]) ?? []),
    [existingVideo],
  );

  /**
   * The safety net under an hour of transcript corrections.
   *
   * Everything in this form lives in React state until Update Video is pressed,
   * and a transcript pass is the one job on the page long enough for that to
   * matter: a closed tab or a reload used to take the lot. Drafts are local and
   * per-video, and are emphatically not a publish — the banner over the editor
   * exists to keep those two apart.
   */
  const draft = useTranscriptDraft({
    videoId,
    lines: transcriptLines,
    publishedLines,
    onRestore: handleTranscriptChange,
    // Only once the stored transcript has arrived; before that the editor's
    // empty list would read as "the whole transcript was deleted".
    enabled: isEditing && Boolean(existingVideo),
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * The native-speaker review layer, folded in from the old /admin/transcribe
   * workspace: checkmarks, per-line comments, the change log, re-translation.
   * All of its writes go through the `transcript-review` edge function — the
   * audit trail's subject must not be able to author it, so the diff behind
   * every revision row is computed server-side against what is stored.
   */
  const review = useTranscriptReview(isEditing ? videoId : undefined);
  const [detailLineId, setDetailLineId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"history" | "comments">("comments");
  const [retranslating, setRetranslating] = useState<string | null>(null);

  const progress = useMemo(
    () =>
      reviewProgress(
        transcriptLines.map((l) => ({ id: l.id, arabic: l.arabic, translation: l.translation })),
        review.reviews,
      ),
    [transcriptLines, review.reviews],
  );

  // Destructured rather than closed over as `review`, which is a fresh object
  // every render: `lineReview` below reaches every card in the list and
  // re-binds the editor's keydown listener, and a four-hundred-line transcript
  // is exactly where that churn would be felt.
  const { reviews, commentsByLine, revisionsByLine, setReviewed, saveLines, retranslateLine } =
    review;
  // `draft` is a fresh object every render; its `clear` is the stable part.
  const clearLocalDraft = draft.clear;

  /**
   * Persist the transcript through `transcript-review`'s save_lines.
   *
   * This — not a direct row update — is what "keeping history" means: the
   * server diffs the incoming lines against what is stored and writes a
   * revision row for every change, under the identity in the JWT. It is also
   * the only write path a transcriber has, so routing everyone through it
   * keeps the page to one save model. The training-data capture runs first,
   * while the old lines are still stored to diff against, and stays
   * best-effort: a failed capture must never block the save.
   */
  const persistTranscript = useCallback(
    async (lines: TranscriptLine[]) => {
      if (!videoId) return;
      try {
        await supabase.functions.invoke("record-transcript-corrections", {
          body: { videoId, lines },
        });
      } catch (captureErr) {
        console.warn("transcript correction capture failed:", captureErr);
      }
      await saveLines.mutateAsync({ lines });
      // The server now holds it, so the local safety net has nothing to guard.
      clearLocalDraft();
      queryClient.invalidateQueries({ queryKey: ["discover-video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["admin-discover-videos"] });
    },
    [videoId, saveLines, clearLocalDraft, queryClient],
  );

  const handleSaveTranscript = useCallback(async () => {
    setIsSavingTranscript(true);
    try {
      // The editor reports its edits on an 800 ms debounce, so a reviewer who
      // types a correction and immediately clicks Save would otherwise save the
      // text from before that keystroke. Waiting one debounce window out is the
      // difference between "saving works" and "saving silently drops my last
      // edit" — the complaint that sent us here.
      await new Promise((resolve) => setTimeout(resolve, 900));
      await persistTranscript(latestLines.current);
      toast.success("Transcript saved");
    } catch (err) {
      toast.error("Could not save the transcript", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSavingTranscript(false);
    }
  }, [persistTranscript]);


  const openDetail = useCallback((lineId: string, tab: "history" | "comments") => {
    setDetailLineId(lineId);
    setDetailTab(tab);
  }, []);

  const toggleReviewed = useCallback(
    async (lineId: string, reviewed: boolean) => {
      try {
        // The tick snapshots the text the *server* holds — that snapshot is
        // what later proves the tick stale — so a line corrected but not yet
        // saved must land first, or the reviewer would be signing off on the
        // version they just replaced.
        if (reviewed && !linesEqual(latestLines.current, publishedLines)) {
          await persistTranscript(latestLines.current);
        }
        await setReviewed.mutateAsync({ lineId, reviewed });
      } catch (error) {
        toast.error("Could not record the review", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [persistTranscript, publishedLines, setReviewed],
  );

  const handleRetranslate = useCallback(
    async (lineId: string) => {
      setRetranslating(lineId);
      try {
        // The server re-translates the Arabic it has stored, and the correction
        // that prompted this press is usually seconds old — flush it first so
        // the model sees the corrected words rather than the ones they replaced.
        if (!linesEqual(latestLines.current, publishedLines)) {
          await persistTranscript(latestLines.current);
        }
        const data = await retranslateLine.mutateAsync({ lineId });
        handleTranscriptChange(
          latestLines.current.map((line) =>
            line.id === lineId
              ? { ...line, translation: data.translation, literal: data.literal ?? line.literal }
              : line,
          ),
        );
        toast.success("Re-translated", { description: data.translation });
      } catch (error) {
        toast.error("Re-translation failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setRetranslating(null);
      }
    },
    [handleTranscriptChange, persistTranscript, publishedLines, retranslateLine],
  );

  const lineReview = useCallback(
    (lineId: string): LineReviewSlot | undefined => {
      const line = transcriptLines.find((l) => l.id === lineId);
      if (!line) return undefined;
      const row = reviews.get(lineId);
      return {
        state: reviewStateFor(row, line),
        reviewedAt: row?.reviewedAt,
        // Set by the translation ensemble when its models disagreed, or when
        // nothing settled the line. A different question from whether a person
        // has looked at it, and the best place for one to start.
        flagged: line.needs_review === true,
        flagReason: line.review_reason,
        openComments: (commentsByLine.get(lineId) ?? []).filter((c) => !c.resolvedAt).length,
        revisions: (revisionsByLine.get(lineId) ?? []).length,
        onToggleReviewed: () =>
          // A stale tick is re-confirmed rather than cleared: the reviewer has
          // just looked at the new text, which is the whole point of the
          // prompt to look again.
          void toggleReviewed(lineId, reviewStateFor(row, line) !== "reviewed"),
        onOpenComments: () => openDetail(lineId, "comments"),
        onOpenHistory: () => openDetail(lineId, "history"),
      };
    },
    [commentsByLine, openDetail, reviews, revisionsByLine, toggleReviewed, transcriptLines],
  );

  const detailLine = transcriptLines.find((l) => l.id === detailLineId);
  const detailIndex = transcriptLines.findIndex((l) => l.id === detailLineId);

  const applySuggestion = useCallback(
    (suggestion: string) => {
      if (!detailLineId) return;
      handleTranscriptChange(
        latestLines.current.map((line) =>
          line.id === detailLineId ? { ...line, translation: suggestion } : line,
        ),
      );
      toast.success("Translation updated", {
        description: "Save the transcript to publish it.",
      });
    },
    [detailLineId, handleTranscriptChange],
  );

  // Time range selection
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isFetchingThumbnail, setIsFetchingThumbnail] = useState(false);

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
      const staged = await resolveStagedVideoAudioUrl(videoId);
      if (staged) {
        setStableAudioUrl(staged);
        return;
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
    const el = isVideoFile(file) ? document.createElement("video") : document.createElement("audio");
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
    if (!isVideoFile(file)) return null;
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
          // Seek to ~25% of duration for a more representative frame
          // (avoids black/intro frame at the very start). Clamp to [0.1, 5s].
          const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
          const target = Math.min(Math.max(dur * 0.25, 0.1), 5);
          video.currentTime = target;
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
      setCefrLevel((existingVideo as any).cefr_level ?? null);
      setDifficultyRationale((existingVideo as any).difficulty_rationale ?? null);

      setPublished(existingVideo.published);
      setIsMeme(Boolean((existingVideo as any).is_meme) || memeQueryFlag);
      setCulturalContext(existingVideo.cultural_context || "");
      if (!transcriptEdited.current) {
        setTranscriptLines(((existingVideo.transcript_lines as any[]) ?? []) as TranscriptLine[]);
      }
      setVocabulary(((existingVideo.vocabulary as any[]) ?? []) as any[]);
      setGrammarPoints(((existingVideo.grammar_points as any[]) ?? []) as any[]);
    }
  }, [existingVideo, memeQueryFlag]);

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
          if (data?.thumbnail_url) setThumbnailUrl(data.thumbnail_url);
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
            if (data?.thumbnail_url) setThumbnailUrl(data.thumbnail_url);
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
   * Manual fallback for when a thumbnail didn't get set automatically —
   * TikTok's oEmbed occasionally omits thumbnail_url, and Instagram has no
   * public oEmbed we can call without an app token. Tries, in order:
   * platform thumbnail APIs, then capturing a frame from whatever media file
   * is currently loaded in the form.
   */
  const handleFetchThumbnail = useCallback(async () => {
    if (!sourceUrl && !audioFile) {
      toast.error("Add a video URL or file first");
      return;
    }
    setIsFetchingThumbnail(true);
    try {
      let fetched: string | null = null;
      let resolvedPlatform = platform;

      if (sourceUrl && !resolvedPlatform) {
        resolvedPlatform = parseVideoUrl(sourceUrl)?.platform ?? (sourceUrl.includes("tiktok.com") ? "tiktok" : "");
      }

      if (resolvedPlatform === "youtube") {
        const parsed = parseVideoUrl(sourceUrl);
        if (parsed?.platform === "youtube") fetched = getYouTubeThumbnail(parsed.videoId);
      } else if (resolvedPlatform === "tiktok" && sourceUrl) {
        try {
          const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
          const data = await response.json();
          if (data?.thumbnail_url) fetched = data.thumbnail_url as string;
        } catch (err) {
          console.error("TikTok oEmbed thumbnail fetch error:", err);
        }
      }

      // Fall back to capturing a frame from whatever media file is loaded,
      // regardless of platform (covers Instagram and TikTok oEmbed misses).
      if (!fetched && audioFile && isVideoFile(audioFile)) {
        fetched = await captureAndUploadThumbnail(audioFile);
      }

      if (!fetched) {
        toast.error("Could not fetch a thumbnail", {
          description: "Upload the video file so a frame can be captured instead.",
        });
        return;
      }

      setThumbnailUrl(fetched);
      if (videoId) {
        const { error } = await (supabase.from("discover_videos" as any) as any)
          .update({ thumbnail_url: fetched })
          .eq("id", videoId);
        if (error) {
          console.error("Failed to persist fetched thumbnail:", error);
          toast.error("Thumbnail fetched but couldn't be saved — click Update Video to retry.");
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["discover-video", videoId] });
        queryClient.invalidateQueries({ queryKey: ["admin-discover-videos"] });
      }
      toast.success("Thumbnail fetched!");
    } finally {
      setIsFetchingThumbnail(false);
    }
  }, [sourceUrl, platform, audioFile, videoId, captureAndUploadThumbnail, queryClient]);

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
      if (!saveThumbnail && isVideoFile(file)) {
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
          is_meme: isMeme,
        };
        const { data: inserted, error: insertErr } = await (supabase.from("discover_videos" as any) as any)
          .insert(record)
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        targetVideoId = inserted.id;
      } else {
        // Mark existing row as pending (and update thumbnail if we just captured one).
        // IMPORTANT: do NOT pre-emptively wipe cultural_context / transcript_lines /
        // vocabulary / grammar_points here. If visual extraction or the server
        // pipeline hiccups, the previously-published content should stay intact.
        // The server pipeline overwrites these fields atomically on success.
        const updates: Record<string, unknown> = { transcription_status: "pending", is_meme: isMeme };
        if (saveThumbnail && saveThumbnail !== thumbnailUrl) updates.thumbnail_url = saveThumbnail;
        await (supabase.from("discover_videos" as any) as any)
          .update(updates)
          .eq("id", targetVideoId);
      }

      // Upload audio to storage.
      //
      // Stage the audio track, not the video. The pipeline reads whatever is
      // here as its ASR input, so uploading the raw file sent every engine a
      // mostly-video payload — and kept Munsit permanently over its 9 MB
      // sync-endpoint limit in a container it can't chunk, so it was skipped on
      // every upload. Extraction is best-effort: if the browser can't decode
      // the container we upload the original exactly as before.
      const extracted = await extractAudioForAsr(file);
      const ext = extracted ? "wav" : (file.name.split(".").pop() || "mp4");
      const storagePath = `${targetVideoId}.${ext}`;
      if (extracted) {
        console.log(
          `[upload] Extracted audio: ${(file.size / 1048576).toFixed(1)} MB ${file.type || "media"} ` +
          `→ ${(extracted.size / 1048576).toFixed(1)} MB wav`,
        );
      }
      // Clear any audio staged for this video under a different extension.
      // `upsert` only replaces the identical path, so re-uploading a clip whose
      // first attempt staged (say) `.mp4` would leave two files for one video —
      // and both the pipeline and the player take the first extension that
      // resolves, not the newest. The result is a video transcribed from, and
      // played against, the audio it used to have.
      const stalePaths = STAGED_AUDIO_EXTENSIONS
        .map((e) => `${targetVideoId}${e}`)
        .filter((p) => p !== storagePath);
      const { error: staleErr } = await supabase.storage.from("video-audio").remove(stalePaths);
      if (staleErr) console.warn("Could not clear stale staged audio:", staleErr);

      const { error: uploadErr } = await supabase.storage
        .from("video-audio")
        .upload(storagePath, extracted ?? file, { upsert: true });
      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        // Non-fatal — edge function will try download-media as fallback
      }

      // Read the text off the frames before the pipeline runs, for EVERY video
      // file — not only the ones ticked as memes. POV captions, subtitles and
      // title cards turn up on ordinary clips just as often, and the browser is
      // the only place that still has the file to sample.
      //
      // What the meme flag changes is how a failure is treated. A meme's joke is
      // usually the text on screen, so a meme that cannot be read must not be
      // transcribed at all; an ordinary video simply loses a nice-to-have and
      // carries on. Memes also let the visual function kick off the pipeline
      // itself with the service role, so a flaky second browser request cannot
      // strand the row in pending after the read succeeds.
      let processingQueuedByVisual = false;
      if (isVideoFile(file)) {
        try {
          toast.info(isMeme ? "Reading on-screen text from meme frames…" : "Reading any text on screen…");
          const frames = await extractFramesWithTimestamps(file, 1.5, 16, 1280);
          const { data: visualData, error: visualErr } = await supabase.functions.invoke(
            "extract-visual-context",
            {
              body: {
                frames,
                audioDuration: durationSeconds ?? mediaDuration ?? undefined,
                videoTitle: title || undefined,
                videoId: targetVideoId,
                kickoffProcessing: isMeme,
              },
            },
          );
          if (visualErr) {
            const message = await extractFunctionErrorMessage(visualErr);
            console.warn("extract-visual-context failed:", visualErr);
            if (!isMeme) throw new Error(message);
            await (supabase.from("discover_videos" as any) as any)
              .update({
                transcription_status: "failed",
                transcription_error: `Meme screen-text extraction failed: ${message}`,
              })
              .eq("id", targetVideoId);
            throw new Error(`Meme screen-text extraction failed: ${message}`);
          }
          if (visualData?.processingQueued) processingQueuedByVisual = true;
          const foundText = visualData?.result?.onScreenTextSegments?.length ?? 0;
          if (foundText === 0 && isMeme) {
            toast.warning("No on-screen text found", {
              description: "The meme will be flagged for review instead of inventing context.",
              duration: 7000,
            });
          }
        } catch (visualErr) {
          if (isMeme) {
            console.warn("Meme visual extraction error:", visualErr);
            throw visualErr instanceof Error ? visualErr : new Error("Meme screen-text extraction failed");
          }
          // Non-fatal for an ordinary video: the transcript is the point, the
          // screen text is a bonus, and an admin can re-read it later from the
          // video list without re-uploading anything.
          console.warn("On-screen text extraction skipped (non-fatal):", visualErr);
        }
      } else if (isMeme) {
        throw new Error("Upload the actual video file for memes so the analyzer can read text on screen. Audio-only files can only transcribe speech.");
      }

      let invokeData: unknown = { success: true, message: "Processing queued by visual analysis" };
      if (!processingQueuedByVisual) {
        // Start the backend pipeline and wait for the acknowledgement before
        // navigating away, otherwise mobile browsers can leave the video stuck in
        // "pending" if the request is interrupted.
        const { data, error: invokeErr } = await supabase.functions.invoke(
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

        invokeData = data;
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
        is_meme: isMeme,
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

  const handleDownloadAndProcess = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);

    const parsed = parseVideoUrl(sourceUrl.trim());
    // YouTube used to route through a RunPod extraction worker here. That
    // worker no longer works and has been removed — download-media handles
    // YouTube directly (Cobalt, then RapidAPI MP3 fallbacks), same as every
    // other source, so there is no longer a separate YouTube path.
    if (parsed?.platform === "youtube" && isMeme) {
      setIsDownloading(false);
      toast.error("Upload the meme video file", {
        description: "YouTube extraction only returns audio, so it cannot read captions or text on screen.",
        duration: 8000,
      });
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
   * Fetches existing audio for playback only — never triggers the
   * transcription pipeline.
   */
  const handleLoadAudioForPlayback = async () => {
    if (!sourceUrl) return;
    setIsDownloading(true);

    try {
      // Strategy 1: video-audio bucket (staged / recently uploaded)
      if (videoId) {
        const staged = await resolveStagedVideoAudioUrl(videoId);
        if (staged) {
          setStableAudioUrl(staged);
          toast.success("Audio loaded!");
          return;
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
        // No cached audio found — don't trigger the pipeline from here
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
    if (parsed?.platform === "youtube" && isMeme) {
      setIsDownloading(false);
      toast.error("Upload the meme video file", {
        description: "Audio-only extraction cannot read captions or text on screen.",
        duration: 8000,
      });
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
        cefr_level: cefrLevel,
        difficulty_rationale: difficultyRationale,
        published,
        is_meme: isMeme,
        created_by: user!.id,
      };

      if (isEditing) {
        // The transcript goes through the review pipeline rather than the row
        // update: `transcript-review` computes the diff server-side and writes
        // the revision log (and the training capture inside persistTranscript
        // banks corrected lines while the old text is still stored to diff
        // against). The notes fields — cultural context, vocabulary, grammar —
        // are deliberately NOT in the record: the notes editor below saves them
        // through the same function, and writing this form's stale copies here
        // would silently undo a save made minutes ago.
        await persistTranscript(latestLines.current);
        const { error } = await (supabase.from("discover_videos" as any) as any).update(record).eq("id", videoId);
        if (error) throw error;
        toast.success("Video updated!");
      } else {
        const { error } = await (supabase.from("discover_videos" as any) as any).insert({
          ...record,
          transcript_lines: transcriptLines as unknown as Record<string, unknown>[],
          vocabulary: vocabulary as unknown as Record<string, unknown>[],
          grammar_points: grammarPoints as unknown as Record<string, unknown>[],
          cultural_context: culturalContext || null,
        });
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
            <h1 className="text-xl font-bold">
              {isEditing ? (canManage ? "Edit Video" : "Review Transcript") : "Add Video"}
            </h1>
          </div>
        </div>
      </header>

      {/* Wider when editing: the transcript editor's review chrome — checkmarks,
          comments, per-line playback — needs the room the old workspace gave it. */}
      <main
        className={cn(
          "container mx-auto px-4 py-8 space-y-6",
          isEditing ? "max-w-6xl" : "max-w-2xl",
        )}
      >
        {/* Background transcription status banner */}
        {isEditing && existingVideo && (existingVideo as any).transcription_status === 'processing' && (
          <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="py-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">
                Transcription is being processed on the server. This page will update automatically
                when complete — the pipeline rewrites the transcript wholesale when it finishes, so
                anything corrected now will be overwritten.
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
                Transcription is queued and will start shortly. You can safely leave this page —
                but don&apos;t correct lines yet, the pipeline will overwrite them when it finishes.
              </span>
            </CardContent>
          </Card>
        )}

        {/* What a reviewer without management access sees instead of the
            metadata cards: enough to know which clip this is, nothing they
            could misclick into publishing or re-transcribing. */}
        {isEditing && !canManage && existingVideo && (
          <div>
            <h2 className="truncate text-lg font-semibold">{existingVideo.title}</h2>
            <p className="text-xs text-muted-foreground">
              {existingVideo.dialect}
              {/*
                The sub-variety reads as part of the dialect rather than as
                another facet — "Saudi · Ḥijāzi" — because that is what it is,
                and because its absence is the prompt to go and set it.
              */}
              {existingVideo.dialect_subvariety
                ? ` · ${subvarietyLabel(existingVideo.dialect_subvariety)}`
                : ""}{" "}
              · {existingVideo.difficulty}
              {existingVideo.published ? " · published" : " · not published"}
            </p>
            {/*
              The clip itself. A transcriber has no metadata cards and no
              upload controls, so without this the page was transcript text
              with nothing to check it against: the staged audio only reaches
              the per-line buttons, and a video with none left them working
              blind. The platform player carries its own sound, which is the
              point — you cannot correct Arabic you have not heard.
            */}
            {(existingVideo.embed_url || existingVideo.source_url) && (
              <div className="mt-3 overflow-hidden rounded-lg border bg-black">
                <iframe
                  src={existingVideo.embed_url || existingVideo.source_url}
                  title={`${existingVideo.title} — source video`}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            )}
            {existingVideo.source_url && (
              <a
                href={existingVideo.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-muted-foreground underline"
              >
                Open the original video in a new tab
              </a>
            )}
          </div>
        )}


        {/* URL Input */}
        {canManage && (
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
                {thumbnailUrl ? (
                  <VideoThumbnail
                    src={thumbnailUrl}
                    sources={{ source_url: sourceUrl, embed_url: embedUrl }}
                    alt=""
                    decorative
                    loading="eager"
                    className="h-12 w-auto rounded"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No thumbnail yet</span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchThumbnail}
                  disabled={isFetchingThumbnail}
                >
                  {isFetchingThumbnail ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {thumbnailUrl ? "Re-fetch" : "Fetch"} thumbnail
                </Button>
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
        )}

        {/* Metadata */}
        {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-generated from transcript if left blank" />
              <p className="text-xs text-muted-foreground">Leave blank to auto-generate from the transcript after analysis.</p>
            </div>
            <div className="space-y-2">
              <Label>Arabic Title</Label>
              <Input
                value={titleArabic}
                onChange={(e) => setTitleArabic(e.target.value)}
                dir="rtl"
                placeholder="يُولَّد تلقائياً من النص"
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
                <div className="flex items-center justify-between gap-2">
                  <Label>Difficulty *</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isRating || transcriptLines.length === 0}
                    onClick={async () => {
                      setIsRating(true);
                      try {
                        const { data, error } = await supabase.functions.invoke("rate-video-cefr", {
                          body: {
                            transcript_lines: transcriptLines,
                            duration_seconds: durationSeconds,
                            vocabulary,
                            dialect,
                          },
                        });
                        if (error) throw error;
                        if (data?.cefr_level) {
                          setCefrLevel(data.cefr_level);
                          setDifficulty(data.difficulty ?? difficulty);
                          setDifficultyRationale(data.rationale ?? null);
                          toast.success(
                            `Rated ${data.cefr_level} (${data.difficulty}) — floor ${data.metric_floor}`,
                          );
                        }
                      } catch (e) {
                        toast.error("Rating failed: " + (e as Error).message);
                      } finally {
                        setIsRating(false);
                      }
                    }}
                  >
                    {isRating ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 mr-1" />
                    )}
                    Auto-rate
                  </Button>
                </div>
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
                {cefrLevel && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary">CEFR: {cefrLevel}</Badge>
                    {difficultyRationale && (
                      <span className="text-muted-foreground line-clamp-2">{difficultyRationale}</span>
                    )}
                  </div>
                )}
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
            {/* Once the video exists, cultural notes live in the revision-logged
                Notes & grammar editor below, next to the grammar and vocabulary
                they are argued over with. */}
            {!isEditing && (
              <div className="space-y-2">
                <Label>Cultural Context</Label>
                <Textarea
                  value={culturalContext}
                  onChange={(e) => setCulturalContext(e.target.value)}
                  placeholder="Optional cultural notes for viewers..."
                  rows={3}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch checked={published} onCheckedChange={setPublished} />
              <Label>Published (visible to all users)</Label>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Switch checked={isMeme} onCheckedChange={setIsMeme} className="mt-1" />
              <div className="space-y-1">
                <Label>This is a meme</Label>
                <p className="text-xs text-muted-foreground">
                  Tells the AI to read on-screen text from video frames and treat audio as optional —
                  it will not invent spoken words if the meme has no speech.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Editable Transcript */}
        {transcriptLines.length > 0 && (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between space-y-0 gap-3">
              <CardTitle className="text-lg">Transcript</CardTitle>
              {isEditing && (
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {progress.reviewed} / {progress.total} lines checked
                    </p>
                    {progress.stale > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {progress.stale} changed since being checked
                      </p>
                    )}
                  </div>
                  <div className="h-2 w-28 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                    <div
                      className={cn(
                        "h-full rounded transition-all",
                        progress.percent === 100 ? "bg-green-500" : "bg-blue-500",
                      )}
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                // Dialect signals persisted by analyze-gulf-arabic:
                // Fanar-C-2-27B validation + CAMeL BERT dialect ID.
                type DialectIssue = {
                  line?: number;
                  word?: string;
                  kind?: string;
                  severity?: "low" | "high";
                  note?: string;
                };
                type DialectSignals = {
                  flagged?: boolean;
                  camel_agrees?: boolean | null;
                  camel_error?: string;
                  camel_config_hint?: string;
                  camel?: { dialect?: string; code?: string; confidence?: number } | null;
                  fanar_validation?: { content?: string; issues?: DialectIssue[] } | null;
                };
                const enginesUsed = existingVideo?.engines_used as
                  { dialect_signals?: DialectSignals } | null | undefined;
                const signals = enginesUsed?.dialect_signals;
                if (!signals) return null;
                const camel = signals.camel;
                const issues = signals.fanar_validation?.issues;
                return (
                  <div
                    className={`p-3 rounded-lg border text-sm space-y-1 ${
                      signals.flagged
                        ? "bg-destructive/10 border-destructive/40"
                        : "bg-muted/50 border-border"
                    }`}
                  >
                    <p className="font-medium">
                      Dialect signals {signals.flagged ? "— flagged for review" : "— no issues detected"}
                    </p>
                    {camel ? (
                      <p className="text-muted-foreground">
                        CAMeL BERT: {camel.dialect ?? "?"} ({camel.code ?? "?"}, conf{" "}
                        {typeof camel.confidence === "number" ? camel.confidence.toFixed(2) : "?"})
                        {" — "}
                        {/* Tri-state: null means CAMeL predicted a dialect outside the
                            taught modules (or MSA), which is not evidence either way. */}
                        {signals.camel_agrees === false
                          ? "disagrees with detected dialect"
                          : signals.camel_agrees === true
                            ? "agrees"
                            : "no bearing on the detected dialect"}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        CAMeL BERT: unavailable{signals.camel_error ? ` (${signals.camel_error})` : ""}
                        {signals.camel_config_hint ? ` — ${signals.camel_config_hint}` : ""}
                      </p>
                    )}
                    {/* Logical ps-5: under dir="auto" resolving RTL, a
                        physical pl-5 wastes its indent on the left while
                        the bullets collide with the right edge. */}
                    {issues && issues.length > 0 && (
                      <ul className="text-muted-foreground list-disc ps-5 space-y-0.5" dir="auto">
                        {issues.slice(0, 25).map((issue, i) => (
                          <li key={i}>
                            {issue.line != null && <span className="tabular-nums">L{issue.line} </span>}
                            {issue.word && <span className="font-medium">{issue.word}</span>}
                            {issue.kind && <span> [{issue.kind}]</span>}
                            {issue.severity === "high" && (
                              <span className="text-destructive"> (high)</span>
                            )}
                            {issue.note && <span> — {issue.note}</span>}
                          </li>
                        ))}
                        {issues.length > 25 && (
                          <li className="list-none italic">+{issues.length - 25} more</li>
                        )}
                      </ul>
                    )}
                    {issues && issues.length === 0 && (
                      <p className="text-muted-foreground">Fanar review: no issues found.</p>
                    )}
                    {/* Fanar answered in prose rather than the JSON it was asked for —
                        show the raw text so the signal isn't lost. */}
                    {!issues && signals.fanar_validation?.content && (
                      <p className="text-muted-foreground whitespace-pre-wrap" dir="auto">
                        Fanar review: {String(signals.fanar_validation.content).slice(0, 500)}
                      </p>
                    )}
                  </div>
                );
              })()}
              {/* Diacritization status. A run with no tashkeel used to leave no
                  trace outside the edge-function logs, so "Farasa is down" and
                  "FARASA_API_KEY was never set" looked the same from here. */}
              {(() => {
                type Diacritization = {
                  ok?: boolean;
                  lines_total?: number;
                  lines_diacritized?: number;
                  reason?: string;
                  config_hint?: string;
                };
                const diac = (existingVideo?.engines_used as
                  { diacritization?: Diacritization } | null | undefined)?.diacritization;
                if (!diac) return null;
                const covered = diac.lines_diacritized ?? 0;
                const total = diac.lines_total ?? 0;
                return (
                  <div
                    className={`p-3 rounded-lg border text-sm ${
                      diac.ok ? "bg-muted/50 border-border" : "bg-destructive/10 border-destructive/40"
                    }`}
                  >
                    <p className="font-medium">
                      Diacritization (Farasa) —{" "}
                      {diac.ok ? `${covered}/${total} lines got tashkeel` : `unavailable (${diac.reason ?? "unknown"})`}
                    </p>
                    {diac.config_hint && (
                      <p className="text-muted-foreground">{diac.config_hint}</p>
                    )}
                  </div>
                );
              })()}
              {!stableAudioUrl && !canManage && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  No audio is staged for this video, so the per-line playback controls have
                  nothing to play. Use the video player at the top of the page to listen,
                  then correct the transcript here.
                </p>
              )}

              {!stableAudioUrl && canManage && (
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
              <TranscriptDraftBanner draft={draft} />
              {retranslating && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Re-translating…
                </p>
              )}
              <AdminTranscriptEditor
                lines={transcriptLines}
                onChange={handleTranscriptChange}
                audioUrl={stableAudioUrl}
                videoId={isEditing ? videoId : undefined}
                lineReview={isEditing ? lineReview : undefined}
                onRetranslate={isEditing ? handleRetranslate : undefined}
              />
              {isEditing && (
                <div className="flex flex-wrap items-center gap-3">
                  {/*
                    Never gated on `draft.dirty`. The editor reports changes on
                    an 800 ms debounce and the dirty check compares against the
                    stored lines, so a reviewer who typed a correction and went
                    straight for Save met a disabled button — which reads as
                    "saving is broken" and loses the edit on navigation. Saving
                    an unchanged transcript is harmless: the server diffs it and
                    records no revision.
                  */}
                  <Button
                    onClick={handleSaveTranscript}
                    disabled={isSavingTranscript}
                    variant={draft.dirty ? "default" : "outline"}
                  >
                    {isSavingTranscript ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save transcript
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {draft.dirty
                      ? "You have transcript changes that are not saved yet — this is what publishes them and records the change history."
                      : "The transcript matches what is saved."}
                  </span>
                </div>
              )}

            </CardContent>
          </Card>
        )}

        {/* Notes, grammar, dialect classification and the activity log — the
            native-reviewer surface folded in from the old /admin/transcribe
            workspace. Everything here saves through `transcript-review`, which
            is what writes the revision log and what lets a transcriber (who
            cannot touch the row directly) contribute at all. */}
        {isEditing && existingVideo && (
          <Tabs defaultValue="notes">
            <TabsList>
              <TabsTrigger value="notes">Notes &amp; grammar</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="notes" className="mt-4">
              <VideoNotesEditor
                culturalContext={existingVideo.cultural_context ?? ""}
                grammarPoints={(existingVideo.grammar_points as unknown as GrammarPoint[]) ?? []}
                vocabulary={(existingVideo.vocabulary as unknown as VocabEntry[]) ?? []}
                dialect={existingVideo.dialect}
                dialectSubvariety={existingVideo.dialect_subvariety ?? null}
                dialectFeatures={
                  (existingVideo.dialect_features as unknown as DialectFeature[]) ?? []
                }
                // The live editor state rather than the stored lines: someone
                // who has just split a line should be able to pin a feature to
                // the half it actually happens on.
                lines={transcriptLines}
                busy={review.saveNotes.isPending}
                onSave={(input) =>
                  review.saveNotes.mutateAsync(input).then(
                    () => {
                      toast.success("Notes saved");
                      queryClient.invalidateQueries({ queryKey: ["discover-video", videoId] });
                    },
                    (error: unknown) =>
                      toast.error("Could not save the notes", {
                        description: error instanceof Error ? error.message : "Unknown error",
                      }),
                  )
                }
              />
            </TabsContent>

            <TabsContent value="activity" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Everything that changed</CardTitle>
                </CardHeader>
                <CardContent>
                  <LineRevisionHistory
                    revisions={review.revisions}
                    emptyLabel="Nothing has been changed on this video yet."
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Notes about the whole video</CardTitle>
                </CardHeader>
                <CardContent>
                  <LineComments
                    comments={review.comments.filter((c) => !c.lineId)}
                    busy={review.addComment.isPending}
                    onAdd={(input) => review.addComment.mutateAsync({ ...input, lineId: null })}
                    onResolve={(commentId, resolved) =>
                      review.resolveComment.mutate({ commentId, resolved })
                    }
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Grammar generator (admin) — the editable grammar/vocabulary lists
            themselves live in the Notes & grammar tab above. */}
        {isEditing && canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Generate Grammar Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerateGrammarRow
                videoId={videoId!}
                onAdded={(added) => {
                  if (added > 0) {
                    queryClient.invalidateQueries({ queryKey: ["discover-video", videoId] });
                  }
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* Save button */}
        {canManage && (
          <div className="space-y-2">
            {draft.dirty && (
              <p className="text-center text-sm text-amber-700 dark:text-amber-400">
                You have unsaved transcript changes. This button saves them too.
              </p>
            )}
            <Button onClick={handleSave} disabled={isSaving} className="w-full" size="lg">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {isEditing ? "Update Video" : "Save Video"}
            </Button>
          </div>
        )}
      </main>

      {/* Per-line comments and history, opened from the buttons on each line. */}
      <Dialog open={detailLineId !== null} onOpenChange={(open) => !open && setDetailLineId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Line {detailIndex + 1}</DialogTitle>
          </DialogHeader>

          {detailLine && (
            <>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p dir="rtl" className="text-right font-cairo text-base">
                  {detailLine.arabic}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{detailLine.translation}</p>
              </div>

              <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "history" | "comments")}>
                <TabsList>
                  <TabsTrigger value="comments">Comments</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="comments" className="mt-3">
                  <LineComments
                    comments={review.commentsByLine.get(detailLine.id) ?? []}
                    busy={review.addComment.isPending}
                    onAdd={(input) =>
                      review.addComment.mutateAsync({ ...input, lineId: detailLine.id })
                    }
                    onResolve={(commentId, resolved) =>
                      review.resolveComment.mutate({ commentId, resolved })
                    }
                    onApplySuggestion={applySuggestion}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-3">
                  <LineRevisionHistory
                    revisions={review.revisionsByLine.get(detailLine.id) ?? []}
                    emptyLabel="This line has not been changed since it was transcribed."
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminVideoForm;
