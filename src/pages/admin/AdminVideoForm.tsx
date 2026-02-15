import { useState, useEffect, useCallback, useMemo } from "react";
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
import { EditableTranscript } from "@/components/admin/EditableTranscript";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { TranscriptLine } from "@/types/transcript";
import { TimeRangeSelector } from "@/components/transcript/TimeRangeSelector";

const DIALECTS = ["Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"];
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

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Time range selection (no limit for admin discover videos)
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

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

  const handleDownloadAudio = async () => {
    if (!sourceUrl) return;
    await ensureUrlParsed();
    setIsDownloading(true);
    try {
      const { data: downloadData, error: downloadError } = await supabase.functions.invoke("download-media", {
        body: { url: sourceUrl },
      });
      if (downloadError) throw new Error(downloadError.message);
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

  const handleProcess = async () => {
    if (!audioFile) {
      toast.error("Download audio first");
      return;
    }
    setIsProcessing(true);

    try {
      // Transcribe with ElevenLabs
      toast.info("Transcribing selected segment...");
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("language_code", "ara");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const projectUrl = import.meta.env.VITE_SUPABASE_URL;

      const transcribeRes = await fetch(`${projectUrl}/functions/v1/elevenlabs-transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
        signal: AbortSignal.timeout(300000),
      });

      if (!transcribeRes.ok) throw new Error("Transcription failed");
      const transcribeData = await transcribeRes.json();

      // Filter words by selected time range
      const [startSec, endSec] = timeRange;
      let filteredWords = transcribeData.words || [];
      let rawText = transcribeData.text || "";

      if (filteredWords.length > 0 && (startSec > 0 || endSec < (mediaDuration || Infinity))) {
        filteredWords = filteredWords.filter((w: any) => w.start >= startSec && w.end <= endSec);
        rawText = filteredWords.map((w: any) => w.text).join(" ") || rawText;
      }

      // Normalize timestamps to the selected clip so transcript sync starts at 0.
      const clipOffsetSec = Math.max(0, startSec);
      const relativeWords = filteredWords.map((w: any) => ({
        ...w,
        start: Math.max(0, w.start - clipOffsetSec),
        end: Math.max(0, w.end - clipOffsetSec),
      }));

      // Step 3: Analyze with Gemini/Falcon
      toast.info("Analyzing transcript...");
      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke("analyze-gulf-arabic", {
        body: { transcript: rawText },
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

      setTranscriptLines(lines);
      setVocabulary(result.vocabulary || []);
      setGrammarPoints(result.grammarPoints || []);
      setCulturalContext(result.culturalContext || "");

      // Auto-populate title if empty
      if (!title && result.title) {
        setTitle(result.title);
      }
      if (!titleArabic && result.titleArabic) {
        setTitleArabic(result.titleArabic);
      }

      // Duration already set during download step

      toast.success("Processing complete!", {
        description: `${lines.length} sentences, ${(result.vocabulary || []).length} vocab items`,
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
              <div className="flex gap-2">
                <Button
                  onClick={handleDownloadAudio}
                  disabled={!sourceUrl || isDownloading || isProcessing}
                  variant="outline"
                  className="flex-1"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Download Audio
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => document.getElementById("audio-upload")?.click()}
                  disabled={isProcessing}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload File
                </Button>
                <input
                  id="audio-upload"
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <Badge variant="secondary" className="py-1.5">
                  ✓ Audio Ready
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAudioFile(null);
                    setMediaDuration(null);
                  }}
                >
                  Change
                </Button>
              </div>
            )}

            {/* Step 2: Time range */}
            {mediaDuration && mediaDuration > 0 && (
              <TimeRangeSelector
                duration={mediaDuration}
                maxRange={mediaDuration}
                value={timeRange}
                onChange={setTimeRange}
              />
            )}

            {/* Step 3: Process */}
            <Button onClick={handleProcess} disabled={!audioFile || isProcessing} className="w-full">
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Auto-Transcribe & Analyze
                </>
              )}
            </Button>
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
            <CardContent>
              <EditableTranscript
                lines={transcriptLines}
                onChange={setTranscriptLines}
                audioUrl={audioFile ? URL.createObjectURL(audioFile) : undefined}
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
