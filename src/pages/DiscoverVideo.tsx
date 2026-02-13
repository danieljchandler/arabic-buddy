import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, ArrowLeft, BookOpen, Check, Plus, Eye, EyeOff, ChevronDown, ChevronLeft, ChevronRight, List, Play, Pause, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

/* ── Clickable Word Token ─────────────────────────────────── */
const ClickableWord = ({
  token,
  parentLine,
  onSave,
  isSaved,
}: {
  token: WordToken;
  parentLine: TranscriptLine;
  onSave?: (word: VocabItem) => void;
  isSaved?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const hasGloss = !!token.gloss;

  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: token.gloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "cursor-pointer transition-colors duration-150 rounded px-0.5",
            "hover:bg-primary/15 hover:text-primary",
          )}
          role="button"
          tabIndex={0}
        >
          {token.surface}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto min-w-[200px] p-3 z-[100]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-center border-b border-border pb-2">
            <p
              className="text-xl font-bold text-foreground mb-1"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {token.surface}
            </p>
            {hasGloss && <p className="text-sm text-muted-foreground">{token.gloss}</p>}
            {token.standard && (
              <p className="text-xs text-muted-foreground/70" dir="rtl">
                (Standard: {token.standard})
              </p>
            )}
            {!hasGloss && (
              <p className="text-xs text-muted-foreground italic">No definition available</p>
            )}
          </div>
          {onSave && (
            <Button
              variant="default"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                onSave(vocabItem);
                setOpen(false);
              }}
              disabled={isSaved}
            >
              {isSaved ? (
                <><Check className="h-4 w-4" /> Saved to My Words</>
              ) : (
                <><BookOpen className="h-4 w-4" /> Save to My Words</>
              )}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/* ── Transcript Line Row ──────────────────────────────────── */
const TranscriptRow = ({
  line,
  isActive,
  showTranslation,
  onSave,
  savedWords,
  lineRef,
  onSeek,
}: {
  line: TranscriptLine;
  isActive: boolean;
  showTranslation: boolean;
  onSave?: (word: VocabItem) => void;
  savedWords?: Set<string>;
  lineRef?: React.Ref<HTMLDivElement>;
  onSeek?: (ms: number) => void;
}) => {
  return (
    <div
      ref={lineRef}
      className={cn(
        "px-4 py-3 rounded-lg transition-all duration-300 border border-transparent",
        isActive
          ? "bg-primary/8 border-primary/30 scale-[1.01]"
          : "hover:bg-muted/40",
      )}
      onClick={() => line.startMs !== undefined && onSeek?.(line.startMs)}
      role={line.startMs !== undefined ? "button" : undefined}
      style={{ cursor: line.startMs !== undefined ? "pointer" : "default" }}
    >
      {/* Arabic text */}
      <p
        className={cn(
          "text-lg leading-[2] transition-colors",
          isActive ? "text-foreground font-medium" : "text-foreground/80",
        )}
        dir="rtl"
        style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
      >
        {line.tokens && line.tokens.length > 0
          ? line.tokens.map((token, i) => (
              <span key={token.id} className="inline">
                <ClickableWord
                  token={token}
                  parentLine={line}
                  onSave={onSave}
                  isSaved={savedWords?.has(token.surface)}
                />
                {i < line.tokens.length - 1 && !/^[،؟.!:؛]+$/.test(token.surface) && " "}
              </span>
            ))
          : line.arabic}
      </p>

      {/* English translation */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          showTranslation ? "max-h-20 opacity-100 mt-1" : "max-h-0 opacity-0",
        )}
      >
        <p
          className="text-sm text-muted-foreground leading-relaxed"
          style={{ fontFamily: "'Open Sans', sans-serif" }}
        >
          {line.translation}
        </p>
      </div>
    </div>
  );
};

/* ── Main Page ────────────────────────────────────────────── */
const DiscoverVideo = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { data: video, isLoading } = useDiscoverVideo(videoId);
  const { isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [showTranslations, setShowTranslations] = useState(true);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [manualLineIndex, setManualLineIndex] = useState(0);
  // Timer-based sync for non-YouTube
  const [timerPlaying, setTimerPlaying] = useState(false);
  const [timerMs, setTimerMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Load YouTube IFrame API
  useEffect(() => {
    if (video?.platform !== "youtube") return;
    if (window.YT && window.YT.Player) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }, [video?.platform]);

  // Initialize YouTube player
  useEffect(() => {
    if (!video || video.platform !== "youtube" || !iframeRef.current) return;
    const ytVideoId = video.embed_url.match(/embed\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!ytVideoId) return;

    const initPlayer = () => {
      if (playerRef.current) return;
      playerRef.current = new window.YT.Player(iframeRef.current!, {
        videoId: ytVideoId,
        playerVars: { enablejsapi: 1, modestbranding: 1, rel: 0 },
        events: {
          onStateChange: (event: any) => {
            if (event.data === 1) {
              intervalRef.current = setInterval(() => {
                if (playerRef.current?.getCurrentTime) {
                  setCurrentTimeMs(playerRef.current.getCurrentTime() * 1000);
                }
              }, 200);
            } else {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) initPlayer();
    else window.onYouTubeIframeAPIReady = initPlayer;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [video]);

  const handleSeek = useCallback((ms: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(ms / 1000, true);
      playerRef.current.playVideo?.();
    }
  }, []);

  // Timer-based playback for non-YouTube videos
  useEffect(() => {
    if (timerPlaying) {
      timerRef.current = setInterval(() => {
        setTimerMs((prev) => prev + 100);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerPlaying]);

  const handleSaveToMyWords = useCallback(
    async (word: VocabItem) => {
      if (!isAuthenticated) {
        toast.error("Please log in to save words");
        return;
      }
      try {
        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          sentence_text: word.sentenceText,
          sentence_english: word.sentenceEnglish,
          source: "discover",
        });
        setSavedWords((prev) => new Set(prev).add(word.arabic));
        toast.success("Saved to My Words");
      } catch (err: any) {
        if (err?.code === "23505") {
          setSavedWords((prev) => new Set(prev).add(word.arabic));
          toast.info("Already in My Words");
        } else {
          toast.error("Failed to save word");
        }
      }
    },
    [isAuthenticated, addUserVocabulary],
  );

  const lines = useMemo(
    () => ((video?.transcript_lines as any[]) ?? []) as TranscriptLine[],
    [video],
  );

  // For YouTube: find active line by time. For others: use manual index.
  const isYouTube = video?.platform === "youtube";

  const activeLineId = useMemo(() => {
    if (!lines.length) return null;
    if (isYouTube) {
      if (currentTimeMs <= 0) return null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startMs !== undefined && currentTimeMs >= line.startMs) {
          if (line.endMs === undefined || currentTimeMs <= line.endMs + 500) {
            return line.id;
          }
        }
      }
      return null;
    }
    // Timer-based sync for non-YouTube: use timerMs if playing/started, else manual index
    if (timerMs > 0 || timerPlaying) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startMs !== undefined && timerMs >= line.startMs) {
          if (line.endMs === undefined || timerMs <= line.endMs + 500) {
            return line.id;
          }
        }
      }
      return null;
    }
    // Fallback: manual navigation
    const idx = Math.max(0, Math.min(manualLineIndex, lines.length - 1));
    return lines[idx]?.id ?? null;
  }, [lines, currentTimeMs, isYouTube, manualLineIndex, timerMs, timerPlaying]);

  const activeLine = useMemo(
    () => lines.find((l) => l.id === activeLineId) ?? null,
    [lines, activeLineId],
  );

  // Auto-scroll to active line
  useEffect(() => {
    if (!activeLineId) return;
    const el = lineRefs.current.get(activeLineId);
    if (el && transcriptContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineId]);

  const vocabulary = useMemo(
    () => ((video?.vocabulary as any[]) ?? []) as VocabItem[],
    [video],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Video not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky video section */}
      <div className="sticky top-0 z-30 bg-background">
        {/* Back nav */}
        <div className="px-4 py-2 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/discover")}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex-1" />
          <div className="flex gap-1.5">
            <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
            <Badge variant="outline" className="text-xs">{video.difficulty}</Badge>
          </div>
        </div>

        {/* Video embed */}
        <div className="bg-black">
          {video.platform === "youtube" ? (
            <div className="aspect-video max-h-[45vh] mx-auto">
              <div ref={iframeRef} className="w-full h-full" />
            </div>
          ) : video.platform === "tiktok" ? (
            <div className="max-h-[55vh] mx-auto flex justify-center">
              <iframe
                src={video.embed_url}
                className="w-full max-w-[325px] h-[55vh]"
                allowFullScreen
                allow="autoplay; encrypted-media"
                style={{ border: "none" }}
              />
            </div>
          ) : (
            <div className="aspect-video max-h-[45vh] mx-auto">
              <iframe
                src={video.embed_url}
                className="w-full h-full"
                allowFullScreen
                allow="autoplay; encrypted-media"
              />
            </div>
          )}
        </div>
      </div>

      {/* Title bar */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <h1
          className="text-base font-bold text-foreground"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          {video.title}
        </h1>
        {video.title_arabic && (
          <p
            className="text-sm text-foreground/70 mt-0.5"
            dir="rtl"
            style={{ fontFamily: "'Cairo', sans-serif" }}
          >
            {video.title_arabic}
          </p>
        )}
      </div>

      {/* Active subtitle display */}
      <div className="px-4 py-4 border-b border-border bg-card/50 min-h-[80px]">
        {/* Timer controls for non-YouTube */}
        {!isYouTube && lines.length > 0 && (
          <div className="flex items-center justify-center gap-3 mb-3">
            {!timerPlaying && timerMs === 0 ? (
              <Button
                variant="default"
                size="lg"
                className="gap-2 px-6"
                onClick={() => setTimerPlaying(true)}
              >
                <Play className="h-4 w-4" />
                Start Learning
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => { setTimerMs(0); setTimerPlaying(false); }}
                  title="Reset"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5 px-4"
                  onClick={() => setTimerPlaying((p) => !p)}
                >
                  {timerPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {timerPlaying ? "Pause" : "Resume"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setTimerMs((prev) => Math.max(0, prev - 3000))}
                  title="-3s"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setTimerMs((prev) => prev + 3000)}
                  title="+3s"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col justify-center">
          {activeLine ? (
            <div className="text-center space-y-1.5">
              <p
                className="text-lg font-medium text-foreground leading-[2]"
                dir="rtl"
                style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
              >
                {activeLine.tokens && activeLine.tokens.length > 0
                  ? activeLine.tokens.map((token, i) => (
                      <span key={token.id} className="inline">
                        <ClickableWord
                          token={token}
                          parentLine={activeLine}
                          onSave={isAuthenticated ? handleSaveToMyWords : undefined}
                          isSaved={savedWords?.has(token.surface)}
                        />
                        {i < activeLine.tokens.length - 1 && !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                      </span>
                    ))
                  : activeLine.arabic}
              </p>
              {showTranslations && activeLine.translation && (
                <p
                  className="text-sm text-muted-foreground leading-relaxed"
                  style={{ fontFamily: "'Open Sans', sans-serif" }}
                >
                  {activeLine.translation}
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground italic">
              {lines.length > 0 ? (isYouTube ? "Play video to see subtitles" : "Press 'Start Learning' to begin") : "No transcript available"}
            </p>
          )}
        </div>
      </div>

      {/* Controls bar */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-border/50 bg-card/50">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground text-xs"
          onClick={() => setShowFullTranscript(!showFullTranscript)}
        >
          <List className="h-3.5 w-3.5" />
          {showFullTranscript ? "Hide" : "Show"} Transcript ({lines.length})
        </Button>
        <div className="flex items-center gap-2">
          {showTranslations ? (
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">EN</span>
          <Switch
            checked={showTranslations}
            onCheckedChange={setShowTranslations}
          />
        </div>
      </div>

      {/* Full transcript (toggleable) */}
      {showFullTranscript && (
        <div
          ref={transcriptContainerRef}
          className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
        >
          {lines.map((line) => (
            <TranscriptRow
              key={line.id}
              line={line}
              isActive={activeLineId === line.id}
              showTranslation={showTranslations}
              onSave={isAuthenticated ? handleSaveToMyWords : undefined}
              savedWords={savedWords}
              lineRef={(el) => {
                if (el) lineRefs.current.set(line.id, el);
                else lineRefs.current.delete(line.id);
              }}
              onSeek={handleSeek}
            />
          ))}
        </div>
      )}

      {/* Vocabulary & cultural context footer */}
      {(vocabulary.length > 0 || video.cultural_context) && (
        <div className="border-t border-border bg-card px-4 py-4 space-y-4">
          {vocabulary.length > 0 && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
                Key Vocabulary ({vocabulary.length})
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {vocabulary.map((v, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                  >
                    <span dir="rtl" className="font-medium text-foreground" style={{ fontFamily: "'Cairo', sans-serif" }}>
                      {v.arabic}
                    </span>
                    <span className="text-muted-foreground text-xs truncate">{v.english}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {video.cultural_context && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
                Cultural Context
              </summary>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {video.cultural_context}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export default DiscoverVideo;
