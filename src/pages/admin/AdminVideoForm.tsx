import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { parseVideoUrl, getYouTubeThumbnail } from "@/lib/videoEmbed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { TranscriptLine } from "@/types/transcript";

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
      setTranscriptLines((existingVideo.transcript_lines as any[] ?? []) as TranscriptLine[]);
      setVocabulary((existingVideo.vocabulary as any[] ?? []) as any[]);
      setGrammarPoints((existingVideo.grammar_points as any[] ?? []) as any[]);
    }
  }, [existingVideo]);

  const handleUrlParse = () => {
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

  const handleProcess = async () => {
    if (!sourceUrl) return;
    setIsProcessing(true);

    try {
      // Step 1: Download audio
      toast.info("Downloading audio...");
      const { data: downloadData, error: downloadError } = await supabase.functions.invoke(
        "download-media",
        { body: { url: sourceUrl } }
      );
      if (downloadError) throw new Error(downloadError.message);
      if (!downloadData?.audioBase64) throw new Error("No audio found");

      // Convert base64 to File for transcription
      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: downloadData.contentType || "audio/mp4" });
      const audioFile = new File([blob], "audio.mp4", { type: blob.type });

      // Step 2: Transcribe with ElevenLabs
      toast.info("Transcribing...");
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("language_code", "ara");

      const { data: { session } } = await supabase.auth.getSession();
      const projectUrl = import.meta.env.VITE_SUPABASE_URL;

      const transcribeRes = await fetch(`${projectUrl}/functions/v1/elevenlabs-transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
        signal: AbortSignal.timeout(300000),
      });

      if (!transcribeRes.ok) throw new Error("Transcription failed");
      const transcribeData = await transcribeRes.json();
      const rawText = transcribeData.text || "";

      // Step 3: Analyze with Gemini/Falcon
      toast.info("Analyzing transcript...");
      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke(
        "analyze-gulf-arabic",
        { body: { transcript: rawText } }
      );
      if (analyzeError) throw new Error(analyzeError.message);
      if (!analyzeData?.success) throw new Error(analyzeData?.error || "Analysis failed");

      const result = analyzeData.result;

      // Map timestamps to lines if available
      let lines = result.lines || [];
      if (transcribeData.words?.length > 0 && lines.length > 0) {
        // Simple timestamp mapping
        const words = transcribeData.words;
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

      if (downloadData.duration) {
        setDurationSeconds(Math.round(downloadData.duration));
      }

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
    if (!title || !embedUrl || !platform) {
      toast.error("Please fill in the required fields");
      return;
    }
    setIsSaving(true);

    try {
      const record = {
        title,
        title_arabic: titleArabic || null,
        source_url: sourceUrl,
        platform,
        embed_url: embedUrl,
        thumbnail_url: thumbnailUrl || null,
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
        const { error } = await (supabase.from("discover_videos" as any) as any)
          .update(record)
          .eq("id", videoId);
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
                  placeholder="https://youtube.com/watch?v=..."
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
                <Badge variant="outline" className="capitalize">{platform}</Badge>
                {thumbnailUrl && (
                  <img src={thumbnailUrl} alt="" className="h-12 rounded" />
                )}
              </div>
            )}

            <Button
              onClick={handleProcess}
              disabled={!sourceUrl || isProcessing}
              className="w-full"
            >
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
              <Input value={titleArabic} onChange={(e) => setTitleArabic(e.target.value)} dir="rtl" placeholder="عنوان الفيديو" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dialect *</Label>
                <Select value={dialect} onValueChange={setDialect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIALECTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Difficulty *</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
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

        {/* Transcript preview */}
        {transcriptLines.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Transcript ({transcriptLines.length} lines)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {transcriptLines.map((line, i) => (
                  <div key={line.id || i} className="p-2 rounded bg-muted/50 text-sm">
                    <p dir="rtl" className="font-arabic">{line.arabic}</p>
                    <p className="text-muted-foreground text-xs mt-1">{line.translation}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Save button */}
        <Button onClick={handleSave} disabled={isSaving || !title || !embedUrl} className="w-full" size="lg">
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isEditing ? "Update Video" : "Save Video"}
        </Button>
      </main>
    </div>
  );
};

export default AdminVideoForm;
