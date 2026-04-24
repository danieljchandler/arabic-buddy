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
import { Loader2, ArrowLeft, BookOpen, Check, Eye, EyeOff, ChevronDown, ChevronLeft, ChevronRight, List, Pause, Play, SkipBack, SkipForward, Gauge, Heart } from "lucide-react";
import { useVideoLikeCount, useIsVideoLiked, useLikeVideo, useUnlikeVideo } from "@/hooks/useVideoLikes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractTikTokVideoId, getTikTokEmbedUrl } from "@/lib/videoEmbed";
import {
  resolveDiscoverVideoAudioUrl,
  extractAndUploadAudioClip,
} from "@/lib/vocabularyAudioContext";
import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
import { VideoRating } from "@/components/discover/VideoRating";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
    tiktokEmbedLoad?: () => void;
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
  const [liveTranslation, setLiveTranslation] = useState<string | null>(null);
  const [liveMsa, setLiveMsa] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // A real gloss exists if gloss is set and is not a legacy compound marker
  const hasGloss = !!token.gloss && !token.gloss.startsWith("(→") && !token.compoundRef;
  const displayGloss = hasGloss ? token.gloss : liveTranslation;

  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: displayGloss || token.gloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  // Auto-translate when popover opens and no gloss exists
  useEffect(() => {
    if (open && !hasGloss && !liveTranslation && !isTranslating) {
      setIsTranslating(true);
      supabase.functions
        .invoke("translate-phrase", {
          body: {
            phrase: token.surface,
            sentenceArabic: parentLine.arabic,
            sentenceEnglish: parentLine.translation,
          },
        })
        .then(({ data, error }) => {
          if (!error && data?.translation) {
            setLiveTranslation(data.translation);
            if (data.msa) setLiveMsa(data.msa);
          }
        })
        .catch((err) => console.warn("Word translation failed:", err))
        .finally(() => setIsTranslating(false));
    }
  }, [open, hasGloss, liveTranslation, isTranslating, token.surface]);

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
            {displayGloss && <p className="text-sm text-muted-foreground">{displayGloss}</p>}
            {(token.standard || liveMsa) && (
              <p className="text-xs text-muted-foreground/70" dir="rtl">
                (فصحى: {token.standard || liveMsa})
              </p>
            )}
            {!displayGloss && isTranslating && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs text-muted-foreground">Translating…</span>
              </div>
            )}
            {!displayGloss && !isTranslating && (
              <p className="text-xs text-muted-foreground italic">No definition available</p>
            )}
          </div>
          {onSave && displayGloss && (
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

/* ── Like Button ──────────────────────────────────────────── */
const LikeButton = ({ videoId, isAuthenticated }: { videoId: string; isAuthenticated: boolean }) => {
  const isLiked = useIsVideoLiked(videoId);
  const { data: likeCount = 0 } = useVideoLikeCount(videoId);
  const likeVideo = useLikeVideo();
  const unlikeVideo = useUnlikeVideo();

  const handleToggle = async () => {
    if (!isAuthenticated) {
      toast.error("Sign in to like videos");
      return;
    }
    try {
      if (isLiked) {
        await unlikeVideo.mutateAsync(videoId);
      } else {
        await likeVideo.mutateAsync(videoId);
      }
    } catch {
      toast.error("Failed to update like");
    }
  };

  const isPending = likeVideo.isPending || unlikeVideo.isPending;

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all shrink-0",
        isLiked
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
      )}
    >
      <Heart
        className={cn("h-5 w-5 transition-all", isLiked && "fill-primary")}
      />
      {likeCount > 0 && (
        <span className="text-sm font-semibold">{likeCount}</span>
      )}
    </button>
  );
};

/* ── Main Page ────────────────────────────────────────────── */
const DiscoverVideo = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { data: video, isLoading } = useDiscoverVideo(videoId);
  const { user, isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [showTranslations, setShowTranslations] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"continuous" | "line">("continuous");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [manualLineIndex, setManualLineIndex] = useState(0);
  // Timer-based sync for non-YouTube
  const [timerPlaying, setTimerPlaying] = useState(false);
  const [timerMs, setTimerMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLDivElement>(null);
  const [tiktokEmbedReadyKey, setTiktokEmbedReadyKey] = useState(0);
  const [resolvedTikTokVideoId, setResolvedTikTokVideoId] = useState<string | null>(null);
  const [resolvedTikTokAuthorUrl, setResolvedTikTokAuthorUrl] = useState<string | null>(null);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState(false);
  const [lineControlIndex, setLineControlIndex] = useState(0);
  const [tiktokAudioUrl, setTiktokAudioUrl] = useState<string | null>(null);
  const [tiktokAudioReady, setTiktokAudioReady] = useState(false);
  const [isTiktokAudioPlaying, setIsTiktokAudioPlaying] = useState(false);
  const tiktokAudioRef = useRef<HTMLAudioElement | null>(null);
  const phraseEndMsRef = useRef<number | null>(null);
  const phraseStartMsRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
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
              setIsYouTubePlaying(true);
              // Apply current playback speed when video starts
              playerRef.current?.setPlaybackRate?.(playbackSpeedRef.current);
              if (intervalRef.current) clearInterval(intervalRef.current);
              intervalRef.current = setInterval(() => {
                if (playerRef.current?.getCurrentTime) {
                  setCurrentTimeMs(playerRef.current.getCurrentTime() * 1000);
                }
              }, 200);
            } else if (event.data === 3) {
              // Buffering — do NOT clear isSeekingRef here, as this fires
              // during seeks. The seek is still in progress; let it complete.
            } else {
              // Genuinely stopped (paused=2, ended=0, unstarted=-1, cued=5)
              setIsYouTubePlaying(false);
              isSeekingRef.current = false; // safe to clear now
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  // Apply speed changes to YouTube player
  useEffect(() => {
    if (playerRef.current?.setPlaybackRate) {
      playerRef.current.setPlaybackRate(playbackSpeed);
    }
  }, [playbackSpeed]);

  const stopTikTokAudio = useCallback(() => {
    const audio = tiktokAudioRef.current;
    if (!audio) return;
    audio.pause();
    setIsTiktokAudioPlaying(false);
  }, []);

  const playTikTokAudio = useCallback((startMs?: number) => {
    const audio = tiktokAudioRef.current;
    if (!audio || !tiktokAudioReady) return;
    if (typeof startMs === "number") {
      audio.currentTime = Math.max(0, startMs / 1000);
    }
    audio.play().catch(() => toast.error("Audio playback failed"));
  }, [tiktokAudioReady]);

  const handleSeek = useCallback((ms: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(ms / 1000, true);
      playerRef.current.playVideo?.();
      return;
    }
    if (tiktokAudioRef.current && tiktokAudioReady) {
      playTikTokAudio(ms);
    }
  }, [playTikTokAudio, tiktokAudioReady]);

  // Resolve hidden audio source for TikTok videos (from video-audio bucket)
  useEffect(() => {
    if (!video || video.platform !== "tiktok") {
      setTiktokAudioUrl(null);
      setTiktokAudioReady(false);
      return;
    }
    let cancelled = false;
    resolveDiscoverVideoAudioUrl(video).then((url) => {
      if (!cancelled) setTiktokAudioUrl(url);
    });
    return () => { cancelled = true; };
  }, [video]);

  // Apply playback speed to hidden TikTok audio
  useEffect(() => {
    if (tiktokAudioRef.current) {
      tiktokAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, tiktokAudioReady]);


  // Timer-based playback for non-YouTube videos (respects playback speed)
  useEffect(() => {
    if (timerPlaying) {
      timerRef.current = setInterval(() => {
        setTimerMs((prev) => prev + Math.round(100 * playbackSpeed));
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
  }, [timerPlaying, playbackSpeed]);

  const handleSaveToMyWords = useCallback(
    async (word: VocabItem) => {
      if (!isAuthenticated || !user) {
        toast.error("Please log in to save words");
        return;
      }
      try {
        // Best-effort: clip the sentence audio from the source video so the
        // flashcard plays with native audio. Falls back gracefully if any
        // step fails (no audio yet, CORS issue, etc.).
        let sentenceAudioUrl: string | undefined;
        if (
          video &&
          typeof word.startMs === "number" &&
          typeof word.endMs === "number" &&
          word.endMs > word.startMs
        ) {
          try {
            const audioSrc = await resolveDiscoverVideoAudioUrl(video);
            if (audioSrc) {
              const uploaded = await extractAndUploadAudioClip(
                audioSrc,
                word.startMs,
                word.endMs,
                user.id,
                "sentence",
              );
              if (uploaded) sentenceAudioUrl = uploaded;
            }
          } catch (clipErr) {
            console.warn("Discover sentence audio clip failed:", clipErr);
          }
        }

        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          sentence_text: word.sentenceText,
          sentence_english: word.sentenceEnglish,
          sentence_audio_url: sentenceAudioUrl,
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
    [isAuthenticated, user, video, addUserVocabulary],
  );

  const lines = useMemo(
    () => ((video?.transcript_lines as any[]) ?? []) as TranscriptLine[],
    [video],
  );

  // For YouTube: find active line by time. For others: use manual index.
  const isYouTube = video?.platform === "youtube";
  const isTikTok = video?.platform === "tiktok";
  const horizontalVideoMaxHeightClass = "max-h-[min(45vh,calc(100dvh-15rem))]";
  const verticalVideoMaxHeightClass = "max-h-[min(72vh,calc(100dvh-13rem))]";

  const playLineByIndex = useCallback(
    (index: number) => {
      if (!lines.length) return;
      const clampedIndex = Math.max(0, Math.min(index, lines.length - 1));
      const targetLine = lines[clampedIndex];
      if (!targetLine) return;

      setLineControlIndex(clampedIndex);
      setManualLineIndex(clampedIndex);

      // Track the target line's start/end time for phrase-mode pause
      phraseStartMsRef.current = targetLine.startMs ?? null;
      phraseEndMsRef.current = targetLine.endMs ?? null;

      if (isYouTube && targetLine.startMs !== undefined) {
        isSeekingRef.current = true;
        setTimeout(() => { isSeekingRef.current = false; }, 2000);
        handleSeek(targetLine.startMs);
      } else if (isTikTok && targetLine.startMs !== undefined) {
        if (tiktokAudioReady && tiktokAudioRef.current) {
          isSeekingRef.current = true;
          setTimeout(() => { isSeekingRef.current = false; }, 1500);
          tiktokAudioRef.current.currentTime = targetLine.startMs / 1000;
          tiktokAudioRef.current.play().catch(() => {});
        } else {
          // Fallback: legacy TikTok without uploaded source audio
          setTimerMs(targetLine.startMs);
        }
      }
    },
    [handleSeek, isYouTube, isTikTok, lines, tiktokAudioReady],
  );

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
    if (isTikTok && tiktokAudioReady) {
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
    // Timer-based sync fallback (legacy TikTok without uploaded audio)
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
  }, [lines, currentTimeMs, isYouTube, isTikTok, tiktokAudioReady, manualLineIndex, timerMs, timerPlaying]);

  const activeLine = useMemo(
    () => lines.find((l) => l.id === activeLineId) ?? null,
    [lines, activeLineId],
  );

  // In phrase mode, show the line at lineControlIndex to avoid stale activeLine during seek lag
  const displayLine = (playbackMode === "line" && lines[lineControlIndex])
    ? lines[lineControlIndex]
    : activeLine;

  useEffect(() => {
    if (!activeLine) return;
    if (isSeekingRef.current) return;
    if (playbackMode === "line") return;
    const nextIndex = lines.findIndex((line) => line.id === activeLine.id);
    if (nextIndex >= 0) {
      setLineControlIndex(nextIndex);
      setManualLineIndex(nextIndex);
    }
  }, [activeLine, lines, playbackMode]);

  // When switching to phrase mode, pause the video/audio and lock to current phrase
  useEffect(() => {
    if (playbackMode !== "line") return;
    if (isYouTube) {
      playerRef.current?.pauseVideo?.();
    } else if (isTikTok) {
      tiktokAudioRef.current?.pause();
    }
    const currentLine = lines[lineControlIndex];
    if (currentLine) {
      phraseStartMsRef.current = currentLine.startMs ?? null;
      phraseEndMsRef.current = currentLine.endMs ?? null;
    }
  }, [playbackMode, isYouTube, isTikTok]); // intentionally exclude lines/lineControlIndex — only fire on mode switch

  // Phrase-end auto-pause for both YouTube and TikTok (hidden audio)
  useEffect(() => {
    if (playbackMode !== "line") return;
    const isPlaying = isYouTube ? isYouTubePlaying : (isTikTok && isTiktokAudioPlaying);
    if (!isPlaying) return;

    const startMs = phraseStartMsRef.current;
    const endMs = phraseEndMsRef.current;
    if (endMs == null) return;

    if (isSeekingRef.current) {
      if (startMs != null && currentTimeMs >= startMs && currentTimeMs < endMs) {
        isSeekingRef.current = false;
      }
      return;
    }

    if (currentTimeMs >= endMs) {
      if (isYouTube) {
        playerRef.current?.pauseVideo?.();
        setIsYouTubePlaying(false);
      } else if (isTikTok) {
        tiktokAudioRef.current?.pause();
      }
    }
  }, [currentTimeMs, isYouTube, isTikTok, isYouTubePlaying, isTiktokAudioPlaying, playbackMode]);

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

  const resolvedEmbedUrl = useMemo(() => {
    if (!video) return "";
    if (video.platform !== "tiktok") return video.embed_url;

    return (
      getTikTokEmbedUrl(video.embed_url) ||
      getTikTokEmbedUrl(video.source_url) ||
      video.embed_url
    );
  }, [video]);

  const tiktokVideoId = useMemo(() => {
    if (!video || video.platform !== "tiktok") return null;

    const source = `${resolvedEmbedUrl} ${video.embed_url} ${video.source_url}`;
    const match = source.match(/(?:video\/|embed\/v2\/|player\/v1\/)(\d{8,})/);
    return match?.[1] ?? null;
  }, [video, resolvedEmbedUrl]);

  const resolvedTikTokCiteUrl = useMemo(() => {
    if (!video || video.platform !== "tiktok") return "";
    if (resolvedTikTokVideoId && resolvedTikTokAuthorUrl) {
      return `${resolvedTikTokAuthorUrl.replace(/\/$/, "")}/video/${resolvedTikTokVideoId}`;
    }

    // Prefer a canonical watch URL whenever we have an ID.
    // Short/share/embed URLs are more likely to trigger unavailable responses in embed.js.
    if (resolvedTikTokVideoId) {
      return `https://www.tiktok.com/video/${resolvedTikTokVideoId}`;
    }

    return video.source_url || resolvedEmbedUrl || video.embed_url;
  }, [video, resolvedEmbedUrl, resolvedTikTokAuthorUrl, resolvedTikTokVideoId]);

  // Use TikTok's official player iframe as a muted visual companion only.
  // Audio comes exclusively from the extracted source track below.
  const tiktokIframeUrl = useMemo(() => {
    if (!video || video.platform !== "tiktok") return "";
    const params = "?autoplay=0&mute=1&muted=1&volume_control=1&controls=0&music_info=0&description=0";
    if (resolvedTikTokVideoId) return `https://www.tiktok.com/player/v1/${resolvedTikTokVideoId}${params}`;
    return resolvedEmbedUrl;
  }, [video, resolvedEmbedUrl, resolvedTikTokVideoId]);

  const tiktokIframeElRef = useRef<HTMLIFrameElement | null>(null);
  const sendTikTokCommand = useCallback((type: string, value?: number) => {
    const iframe = tiktokIframeElRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type, "x-tiktok-player": true, value },
        "*",
      );
    } catch {
      // best-effort visual sync only
    }
  }, []);

  // Keep the TikTok iframe visual-only. Sound is driven exclusively by our
  // hidden <audio> element via the extracted source track.

  // Blockquote embed disabled — kept as empty fallback so older code paths
  // that check for it short-circuit to the iframe.
  const tiktokBlockquoteHtml = "";

  useEffect(() => {
    if (!video || video.platform !== "tiktok" || !tiktokBlockquoteHtml) return;
    const scriptId = "tiktok-embed-script";
    if (document.getElementById(scriptId)) return;
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = "https://www.tiktok.com/embed.js";
    script.onload = () => setTiktokEmbedReadyKey((prev) => prev + 1);
    document.body.appendChild(script);
  }, [video, tiktokBlockquoteHtml]);

  useEffect(() => {
    if (!video || video.platform !== "tiktok") return;

    setResolvedTikTokVideoId(tiktokVideoId);
    setResolvedTikTokAuthorUrl(null);
    if (tiktokVideoId) return;

    const candidateUrl = video.source_url || video.embed_url || resolvedEmbedUrl;
    if (!candidateUrl) return;

    let cancelled = false;

    const resolveTikTokVideoId = async () => {
      try {
        const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(candidateUrl)}`);
        const data = await response.json();
        const resolvedId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${candidateUrl}`);
        if (!cancelled) {
          if (resolvedId) {
            setResolvedTikTokVideoId(resolvedId);
          }
          if (typeof data?.author_url === "string" && data.author_url.includes("tiktok.com/@")) {
            setResolvedTikTokAuthorUrl(data.author_url);
          }
        }
      } catch {
        // Keep best-effort fallback with source URL only.
      }
    };

    resolveTikTokVideoId();

    return () => {
      cancelled = true;
    };
  }, [video, resolvedEmbedUrl, tiktokVideoId]);

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
      {/* Video section - sticky for YouTube, static for TikTok (vertical videos need more space) */}
      <div className={cn(isYouTube ? "sticky top-0 z-30" : "relative z-30", "bg-background")}>
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
        <div className="bg-black relative">
          {video.platform === "youtube" ? (
            <div className={cn("aspect-video mx-auto", horizontalVideoMaxHeightClass)}>
              <div ref={iframeRef} className="w-full h-full" />
            </div>
          ) : video.platform === "tiktok" ? (
            <div className="mx-auto flex w-full justify-center px-2 py-2">
              <div className="w-full max-w-[420px]">
                <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-md bg-black", verticalVideoMaxHeightClass)}>
                  {tiktokBlockquoteHtml ? (
                    <div
                      key={`${resolvedTikTokVideoId}-${tiktokEmbedReadyKey}`}
                      className="absolute inset-0 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: tiktokBlockquoteHtml }}
                    />
                  ) : tiktokIframeUrl ? (
                    <iframe
                      ref={tiktokIframeElRef}
                      src={tiktokIframeUrl}
                      className="absolute inset-0 h-full w-full border-0"
                      title={video.title}
                      allowFullScreen
                      scrolling="no"
                      // autoplay permission is REQUIRED for postMessage("play") to work.
                      // Silence is enforced via the mute=1 URL param (respected on init)
                      // and we never send unmute commands.
                      allow="autoplay; fullscreen; picture-in-picture"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  ) : (
                    <a
                      href={resolvedTikTokCiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-full w-full items-center justify-center text-sm text-white/80"
                    >
                      View on TikTok
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={cn("aspect-video mx-auto", horizontalVideoMaxHeightClass)}>
              <iframe
                src={resolvedEmbedUrl}
                className="w-full h-full"
                title={video.title}
                allowFullScreen
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}

        </div>
      </div>

      {/* Title bar */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
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
          <LikeButton videoId={video.id} isAuthenticated={isAuthenticated} />
        </div>
      </div>

      {/* TikTok-only: hidden audio sync. When source MP4 is available we drive
          the highlight from a real <audio> element. Otherwise fall back to a manual timer. */}
      {isTikTok && tiktokAudioUrl && (
        <>
          <audio
            ref={tiktokAudioRef}
            src={tiktokAudioUrl}
            preload="auto"
            crossOrigin="anonymous"
            className="hidden"
            onLoadedMetadata={() => {
              setTiktokAudioReady(true);
              if (tiktokAudioRef.current) {
                tiktokAudioRef.current.playbackRate = playbackSpeed;
              }
              sendTikTokCommand("mute");
            }}
            onTimeUpdate={(e) => setCurrentTimeMs((e.currentTarget.currentTime || 0) * 1000)}
            onPlay={() => { setIsTiktokAudioPlaying(true); sendTikTokCommand("mute"); sendTikTokCommand("play"); }}
            onPause={() => { setIsTiktokAudioPlaying(false); sendTikTokCommand("pause"); }}
            onSeeked={(e) => { sendTikTokCommand("mute"); sendTikTokCommand("seekTo", e.currentTarget.currentTime); }}
            onEnded={() => { setIsTiktokAudioPlaying(false); sendTikTokCommand("pause"); }}
          />
          {lines.length > 0 && (
            <div className="px-4 py-2 border-b border-border/50 bg-card/50 flex items-center justify-center gap-2">
              <Button
                variant={isTiktokAudioPlaying ? "secondary" : "default"}
                size="sm"
                className="gap-2"
                onClick={() => {
                  const audio = tiktokAudioRef.current;
                  if (!audio) return;
                  if (isTiktokAudioPlaying) audio.pause();
                  else audio.play().catch(() => toast.error("Audio playback failed"));
                }}
                disabled={!tiktokAudioReady}
              >
                {isTiktokAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isTiktokAudioPlaying ? "Pause" : "Play"}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.floor(currentTimeMs / 1000)}s
              </span>
            </div>
          )}
        </>
      )}

      {/* Legacy TikTok fallback (no uploaded source audio) */}
      {isTikTok && !tiktokAudioUrl && lines.length > 0 && (
        <div className="px-4 py-2 border-b border-border/50 bg-card/50 flex flex-col items-center gap-1">
          {isAuthenticated && (
            <p className="text-[11px] text-muted-foreground/80 text-center px-2">
              Source audio missing — auto-sync unavailable. Re-upload the audio in Admin → Edit Video to enable it.
            </p>
          )}
          <div className="flex items-center justify-center gap-2">
            <Button
              variant={timerPlaying ? "secondary" : "default"}
              size="sm"
              className="gap-2"
              onClick={() => {
                setTimerPlaying((p) => !p);
                // Start timer from the current manual line position so the user
                // can press play without first scrubbing to a line.
                if (!timerPlaying && timerMs === 0 && lines[manualLineIndex]?.startMs !== undefined) {
                  setTimerMs(lines[manualLineIndex].startMs!);
                }
              }}
            >
              {timerPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {timerPlaying ? "Pause sync" : "Start subtitle sync"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setTimerPlaying(false); setTimerMs(0); setManualLineIndex(0); setLineControlIndex(0); }}
            >
              Reset
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.floor(timerMs / 1000)}s
            </span>
          </div>
        </div>
      )}

      {/* Active subtitle display with navigation arrows */}
      {(
        <div className="px-4 py-4 border-b border-border bg-card/50 min-h-[80px]">
          <div className="flex items-center gap-2">
            {/* Previous line arrow */}
            <button
              onClick={() => playLineByIndex(lineControlIndex - 1)}
              disabled={lineControlIndex <= 0 || lines.length === 0}
              className={cn(
                "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                "bg-muted/60 transition-all duration-200",
                "hover:bg-muted active:scale-95",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-muted/60"
              )}
              aria-label="Previous line"
            >
              <ChevronLeft className="h-5 w-5 text-foreground" />
            </button>

            {/* Active line content */}
            <div className="flex-1 min-w-0">
              {displayLine ? (
                <div className="text-center space-y-1.5">
                  <p
                    className="text-lg font-medium text-foreground leading-[2]"
                    dir="rtl"
                    style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
                  >
                    {displayLine.tokens && displayLine.tokens.length > 0
                      ? displayLine.tokens.map((token, i) => (
                          <span key={token.id} className="inline">
                            <ClickableWord
                              token={token}
                              parentLine={displayLine}
                              onSave={isAuthenticated ? handleSaveToMyWords : undefined}
                              isSaved={savedWords?.has(token.surface)}
                            />
                            {i < displayLine.tokens.length - 1 && !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                          </span>
                        ))
                      : displayLine.arabic}
                  </p>
                  {showTranslations && displayLine.translation && (
                    <p
                      className="text-sm text-muted-foreground leading-relaxed"
                      style={{ fontFamily: "'Open Sans', sans-serif" }}
                    >
                      {displayLine.translation}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/60">{lineControlIndex + 1} / {lines.length}</p>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground italic">
                  {lines.length > 0 ? (isYouTube ? "Play video to see subtitles" : "Tap play on the video to begin") : "No transcript available"}
                </p>
              )}
            </div>

            {/* Next line arrow */}
            <button
              onClick={() => playLineByIndex(lineControlIndex + 1)}
              disabled={lineControlIndex >= lines.length - 1 || lines.length === 0}
              className={cn(
                "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                "bg-muted/60 transition-all duration-200",
                "hover:bg-muted active:scale-95",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-muted/60"
              )}
              aria-label="Next line"
            >
              <ChevronRight className="h-5 w-5 text-foreground" />
            </button>
          </div>
        </div>
      )}

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
        <div className="flex items-center gap-1.5">
          {/* Speed control */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                {playbackSpeed}x
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[100px]">
              {[0.5, 0.75, 1, 1.25, 1.5].map((speed) => (
                <DropdownMenuItem
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={cn("text-sm", playbackSpeed === speed && "font-bold text-primary")}
                >
                  {speed}x {speed === 1 && "(Normal)"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Playback mode toggle */}
          <Button
            variant={playbackMode === "line" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => setPlaybackMode((prev) => (prev === "continuous" ? "line" : "continuous"))}
          >
            {playbackMode === "continuous" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {playbackMode === "continuous" ? "Continuous" : "Phrase"}
          </Button>
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

      {playbackMode === "line" && lines.length > 0 && (
        <div className="border-b border-border/50 bg-card/40 px-4 py-2">
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => playLineByIndex(lineControlIndex - 1)} disabled={lineControlIndex <= 0}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="default" size="sm" className="gap-2" onClick={() => playLineByIndex(lineControlIndex)}>
              <Play className="h-4 w-4" />
              Phrase {lineControlIndex + 1}/{lines.length}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => playLineByIndex(lineControlIndex + 1)} disabled={lineControlIndex >= lines.length - 1}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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

          {/* Video Rating */}
          <VideoRating videoId={video.id} userId={user?.id} />
        </div>
      )}
    </div>
  );
};

export default DiscoverVideo;
