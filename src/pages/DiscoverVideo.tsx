import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { visualContextAt } from "../../supabase/functions/_shared/visualTimelineCore";
import { useParams, useNavigate } from "react-router-dom";
import { useDiscoverVideo, type DiscoverVideo as DiscoverVideoType } from "@/hooks/useDiscoverVideos";
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
import { Loader2, ArrowLeft, BookOpen, Check, Eye, EyeOff, ChevronDown, ChevronLeft, ChevronRight, Info, List, Pause, Play, SkipBack, SkipForward, Gauge, Heart, Turtle } from "lucide-react";
import { useVideoLikeCount, useIsVideoLiked, useLikeVideo, useUnlikeVideo } from "@/hooks/useVideoLikes";
import { useRecordVideoView } from "@/hooks/useDiscoverFeed";
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
  synthesizeAndUploadTTS,
  extractAudioClipFromUrl,
} from "@/lib/vocabularyAudioContext";
import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
import { VideoRating } from "@/components/discover/VideoRating";
import { OnScreenTextPanel } from "@/components/discover/OnScreenTextPanel";
import { screenTextFor, splitTranscriptLines } from "@/lib/onScreenText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { FushaLine } from "@/components/shared/FushaLine";
import { useFushaLines } from "@/hooks/useFushaLines";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { LineShadowPanel } from "@/components/pronunciation/LineShadowPanel";
import type { ExternalYouTubeController } from "@/components/pronunciation/ClipSourcePlayer";
import { DIALECT_LOCALE, extractYouTubeId, type ShadowClip } from "@/hooks/useShadowQueue";
import { loadYouTubeIframeAPI } from "@/lib/youtubeIframeApi";
import { Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isCappedError, toInvokeFailureError } from "@/lib/invokeError";
import { recordContinue } from "@/lib/continueProgress";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

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
              style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
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
          <div className="pt-1 border-t border-border">
            <AskAISentence
              arabic={parentLine.arabic}
              english={parentLine.translation}
              variant="chip"
              className="w-full justify-center"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/* ── Transcript Line Row ──────────────────────────────────── */
const buildShadowClipForLine = (
  line: TranscriptLine,
  video?: DiscoverVideoType,
  shadowAudioUrl?: string | null,
): ShadowClip | null => {
  const startMs = Number(line.startMs);
  const endMs = Number(line.endMs);
  const hasTiming = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const isYouTube = video?.platform === "youtube";
  const youtubeId = isYouTube ? extractYouTubeId(video?.embed_url ?? null, video?.source_url ?? null) : null;

  if (!video || !line.arabic || !hasTiming) return null;

  const base = {
    id: `line-${line.id}`,
    text: line.arabic,
    translation: line.translation,
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    dialect: video.dialect,
    locale: DIALECT_LOCALE[video.dialect] ?? "ar-SA",
    sourceTitle: video.title,
  };

  // Prefer a downloadable native-audio clip whenever we have one. An <audio>
  // element started by the user's tap plays reliably on every platform — the
  // cross-origin YouTube iframe, by contrast, refuses to autoplay until the
  // user has interacted inside it (that's why shadowing used to need the main
  // video played first). We only fall back to driving the iframe when no audio
  // file exists. Either way the reference stays the actual native clip.
  if (shadowAudioUrl) {
    return { ...base, source: "audio", audioUrl: shadowAudioUrl };
  }
  if (isYouTube && youtubeId) {
    return { ...base, source: "youtube", youtubeId };
  }
  return null;
};

const TranscriptRow = ({
  line,
  isActive,
  showTranslation,
  showLiteral,
  fusha,
  onSave,
  savedWords,
  lineRef,
  onSeek,
  video,
  shadowAudioUrl,
  isShadowing,
  onToggleShadow,
  externalYouTubeController,
}: {
  line: TranscriptLine;
  isActive: boolean;
  showTranslation: boolean;
  showLiteral?: boolean;
  /** The line in Modern Standard Arabic, when the Fusha row is on and one exists. */
  fusha?: string;
  onSave?: (word: VocabItem) => void;
  savedWords?: Set<string>;
  lineRef?: React.Ref<HTMLDivElement>;
  onSeek?: (ms: number) => void;
  video?: DiscoverVideoType;
  shadowAudioUrl?: string | null;
  isShadowing?: boolean;
  onToggleShadow?: (lineId: string) => void;
  externalYouTubeController?: ExternalYouTubeController | null;
}) => {
  const shadowClip = buildShadowClipForLine(line, video, shadowAudioUrl);

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
        style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
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

      {/* Fusha row — the same sentence in MSA, next to the dialect rather than
          down with the translation, because it is not what the line means. */}
      {fusha && <FushaLine dialect={line.arabic} fusha={fusha} className="mt-1" />}

      {line.arabic && (
        <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <AskAISentence
            arabic={line.arabic}
            english={line.translation}
            variant="chip"
            className="h-8 px-3 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          />
          {shadowClip && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleShadow?.(line.id)}
              className={cn(
                "h-8 px-3 gap-1.5 rounded-full text-xs font-medium",
                isShadowing
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              <Mic className="h-3.5 w-3.5" />
              {isShadowing ? "Close" : "Practice shadowing"}
            </Button>
          )}
        </div>
      )}

      {/* Inline shadowing panel */}
      {isShadowing && shadowClip && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineLineShadow
            clip={shadowClip}
            audioUrl={shadowAudioUrl ?? null}
            startMs={line.startMs}
            endMs={line.endMs}
            externalYouTubeController={externalYouTubeController}
            onClose={() => onToggleShadow?.(line.id)}
          />
        </div>
      )}

      {/* English translation */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          showTranslation ? "max-h-64 opacity-100 mt-1" : "max-h-0 opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "'Open Sans', sans-serif" }}
      >
        <TranslationPair
          variant="compact"
          literal={showLiteral ? line.literal : undefined}
          natural={line.translation}
        />
      </div>
    </div>
  );
};

/* ── Inline shadow loader: extracts the native clip WAV (when audio is
 *    available) then renders the shadowing panel. ─────────────────────── */
const InlineLineShadow = ({
  clip,
  audioUrl,
  startMs,
  endMs,
  externalYouTubeController,
  onClose,
}: {
  clip: ShadowClip;
  audioUrl: string | null;
  startMs?: number;
  endMs?: number;
  externalYouTubeController?: ExternalYouTubeController | null;
  onClose: () => void;
}) => {
  const [nativeClipWav, setNativeClipWav] = useState<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNativeClipWav(null);
    if (audioUrl && startMs !== undefined && endMs !== undefined) {
      extractAudioClipFromUrl(audioUrl, startMs, endMs)
        .then((blob) => {
          if (!cancelled) setNativeClipWav(blob);
        })
        .catch(() => {
          /* acoustic component is optional */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [audioUrl, startMs, endMs]);

  return (
    <LineShadowPanel
      clip={clip}
      nativeClipWav={nativeClipWav}
      externalYouTubeController={externalYouTubeController}
      onClose={onClose}
    />
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

/* ── Grammar Notes Section ───────────────────────────────── */
type GrammarPoint = {
  title: string;
  explanation: string;
  examples?: string[];
  cefr_level?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
};

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const difficultyToCefr = (d?: string | null): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" => {
  const v = (d || "").toLowerCase();
  if (v.startsWith("begin")) return "A2";
  if (v.startsWith("adv")) return "C1";
  return "B1";
};

const GrammarNotesSection = ({
  videoId,
  points,
  videoDifficulty,
}: {
  videoId: string;
  points: GrammarPoint[];
  videoDifficulty?: string | null;
}) => {
  const { placementLevel } = useUserLevel();
  const qc = useQueryClient();
  const userLevel = (placementLevel as any) || difficultyToCefr(videoDifficulty);
  const [showAll, setShowAll] = useState(false);
  const [generating, setGenerating] = useState(false);

  const filtered = useMemo(() => {
    if (showAll) return points;
    const userIdx = LEVEL_ORDER.indexOf(userLevel);
    if (userIdx < 0) return points;
    return points.filter((p) => {
      const lvl = (p.cefr_level || difficultyToCefr(videoDifficulty)) as any;
      const idx = LEVEL_ORDER.indexOf(lvl);
      // show points at user level or one below
      return idx >= 0 && idx <= userIdx && idx >= userIdx - 1;
    });
  }, [points, showAll, userLevel, videoDifficulty]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-grammar-points", {
        body: { video_id: videoId, target_level: userLevel, count: 4 },
      });
      if (error) throw await toInvokeFailureError(error, data, "Couldn't generate grammar notes. Please try again.");
      if ((data as any)?.added > 0) {
        toast.success(`Added ${(data as any).added} new grammar note${(data as any).added === 1 ? "" : "s"}`);
        qc.invalidateQueries({ queryKey: ["discover-video", videoId] });
      } else {
        toast.info((data as any)?.message || "No new grammar notes found");
      }
    } catch (e: any) {
      if (!isCappedError(e)) toast.error(e?.message || "Failed to generate grammar notes");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <details className="group" open>
      <summary className="flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
          Grammar Notes ({filtered.length}
          {points.length !== filtered.length ? `/${points.length}` : ""})
        </span>
        <span className="flex items-center gap-2">
          {points.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setShowAll((v) => !v);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {showAll ? `My level (${userLevel})` : "All levels"}
            </button>
          )}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {points.length === 0
              ? "No grammar notes yet."
              : `No notes at your level (${userLevel}). Try "All levels" or generate more.`}
          </p>
        )}
        {filtered.map((p, i) => (
          <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">{p.title}</h4>
              {p.cefr_level && (
                <Badge variant="outline" className="text-[10px] font-mono">{p.cefr_level}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{p.explanation}</p>
            {p.examples && p.examples.length > 0 && (
              <ul className="mt-1 space-y-1">
                {p.examples.slice(0, 2).map((ex, j) => (
                  <li
                    key={j}
                    dir="rtl"
                    className="text-sm text-foreground/90 px-2 py-1 rounded bg-background/60"
                    style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
                  >
                    {ex}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full mt-2"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-2" />
          )}
          Generate more at my level ({userLevel})
        </Button>
      </div>
    </details>
  );
};

/* ── Main Page ────────────────────────────────────────────── */
/**
 * Renders from two places with identical behaviour: as the /discover/:videoId
 * route (props empty, id from the URL), and inside the feed's inline player
 * overlay (id passed as a prop, back wired to close the overlay instead of
 * navigating). One component in two mounts is the whole point — the overlay
 * exists so tapping a clip skips the route change, and it must never mean a
 * second, lesser version of this page.
 */
const DiscoverVideo = ({
  videoId: videoIdProp,
  onBack,
}: {
  videoId?: string;
  onBack?: () => void;
} = {}) => {
  const { videoId: videoIdParam } = useParams<{ videoId: string }>();
  const videoId = videoIdProp ?? videoIdParam;
  const navigate = useNavigate();
  const { data: video, isLoading, isError: videoError, refetch: refetchVideo } = useDiscoverVideo(videoId);
  const { user, isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();
  const recordView = useRecordVideoView();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [showTranslations, setShowTranslations] = useState(false);
  const [showLiteral, setShowLiteral] = useState(false);
  // Unlike its neighbours, the Fusha switch is the global "Formal Arabic (MSA)"
  // preference rather than page state: a learner who asked for MSA in Settings
  // or on a transcript means it everywhere, and one row appearing on some
  // screens and not others reads as a bug rather than a setting.
  const { prefs: displayPrefs, update: updateDisplayPrefs } = useDisplayPrefs();
  const showFusha = displayPrefs.showFormal;
  const setShowFusha = (on: boolean) => updateDisplayPrefs({ showFormal: on });
  const [playbackMode, setPlaybackMode] = useState<"continuous" | "line">("continuous");
  // YouTube-only: the IFrame API slows picture and sound together, so the
  // transcript stays in sync at any rate. TikTok deliberately has no synced
  // speed — its player/v1 iframe accepts no rate command, so slowing only the
  // hidden audio dragged the picture further out of sync the longer it played.
  // TikTok's slow-down is the separate listen-only phrase control below.
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  // Slow listen (TikTok): replays ONE phrase's audio at a reduced rate on its
  // own <audio> element while the synced player sits paused.
  const [slowListenRate, setSlowListenRate] = useState<0.75 | 0.5>(0.75);
  const [isSlowListening, setIsSlowListening] = useState(false);
  const slowListenAudioRef = useRef<HTMLAudioElement | null>(null);
  const slowListenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [manualLineIndex, setManualLineIndex] = useState(0);
  // Timer-based sync for non-YouTube
  const [timerPlaying, setTimerPlaying] = useState(false);
  const [timerMs, setTimerMs] = useState(0);
  const timerMsRef = useRef(0);
  timerMsRef.current = timerMs;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLDivElement>(null);
  const [resolvedTikTokVideoId, setResolvedTikTokVideoId] = useState<string | null>(null);
  const [resolvedTikTokAuthorUrl, setResolvedTikTokAuthorUrl] = useState<string | null>(null);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState(false);
  const [lineControlIndex, setLineControlIndex] = useState(0);
  const [tiktokAudioUrl, setTiktokAudioUrl] = useState<string | null>(null);
  const [tiktokAudioReady, setTiktokAudioReady] = useState(false);
  // Shadowing: which line's inline panel is open, and the resolved native
  // audio URL used to extract clips for acoustic scoring (null for videos
  // without downloadable audio, e.g. most YouTube).
  const [shadowLineId, setShadowLineId] = useState<string | null>(null);
  const [shadowAudioUrl, setShadowAudioUrl] = useState<string | null>(null);
  const [isTiktokAudioPlaying, setIsTiktokAudioPlaying] = useState(false);
  // When the muted player/v1 iframe never confirms it started (unresolved
  // video id, or cross-origin muted-autoplay refused), we prompt the user to
  // tap the video's own play button. Non-blocking hint — see render below.
  const [tiktokNeedsManualPlay, setTiktokNeedsManualPlay] = useState(false);
  const tiktokAudioRef = useRef<HTMLAudioElement | null>(null);
  const phraseEndMsRef = useRef<number | null>(null);
  const phraseStartMsRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
  // Whether the previous tick of the phrase-mode effects saw playback running —
  // lets a fresh "play" be told apart from playback that was already going.
  const phraseWasPlayingRef = useRef(false);
  // Safari only unlocks an <audio> element after a play() issued inside a real
  // user-gesture handler, so the first-ever start must not be deferred.
  const tiktokAudioEverPlayedRef = useRef(false);
  // A scheduled fallback start of the hidden audio while we wait for the muted
  // TikTok frame to confirm it is playing (see startTikTokPlayback).
  const pendingAudioStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingAudioStart = useCallback(() => {
    if (pendingAudioStartRef.current) {
      clearTimeout(pendingAudioStartRef.current);
      pendingAudioStartRef.current = null;
    }
  }, []);
  const shadowPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Record "continue where you left off" entry, throttled internally to 5s
  useEffect(() => {
    if (!video?.id) return;
    const title = (video as any).title || (video as any).title_arabic || "Video";
    const dialect = (video as any).dialect as string | undefined;
    const totalSec = Math.floor(currentTimeMs / 1000);
    if (totalSec <= 0) {
      recordContinue({ kind: "video", route: `/discover/${video.id}`, title, dialect });
      return;
    }
    const mm = Math.floor(totalSec / 60);
    const ss = (totalSec % 60).toString().padStart(2, "0");
    recordContinue({
      kind: "video",
      route: `/discover/${video.id}`,
      title,
      subtitle: `at ${mm}:${ss}`,
      dialect,
    });
  }, [video?.id, currentTimeMs]);

  // Resolve a downloadable native-audio URL for shadowing (used to extract
  // per-line clips for acoustic scoring). Null when none exists yet.
  useEffect(() => {
    if (!video) {
      setShadowAudioUrl(null);
      return;
    }
    let cancelled = false;
    resolveDiscoverVideoAudioUrl(video)
      .then((url) => {
        if (!cancelled) setShadowAudioUrl(url);
      })
      .catch(() => {
        if (!cancelled) setShadowAudioUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [video]);

  const handleToggleShadow = useCallback((lineId: string) => {
    setShadowLineId((cur) => (cur === lineId ? null : lineId));
  }, []);

  // Initialize YouTube player
  useEffect(() => {
    if (!video || video.platform !== "youtube" || !iframeRef.current) return;
    const ytVideoId = video.embed_url.match(/embed\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!ytVideoId) return;

    let cancelled = false;

    const initPlayer = () => {
      if (cancelled || playerRef.current || !iframeRef.current) return;
      playerRef.current = new window.YT.Player(iframeRef.current, {
        videoId: ytVideoId,
        playerVars: { enablejsapi: 1, modestbranding: 1, rel: 0 },
        events: {
          onStateChange: (event: any) => {
            if (event.data === 1) {
              setIsYouTubePlaying(true);
              // Apply current playback speed when video starts
              playerRef.current?.setPlaybackRate?.(playbackSpeedRef.current);
              if (intervalRef.current) clearInterval(intervalRef.current);
              // 100ms keeps the subtitle highlight tight; anything precise
              // (phrase-end pauses) reads the player clock directly instead
              // of waiting on this state.
              intervalRef.current = setInterval(() => {
                if (playerRef.current?.getCurrentTime) {
                  setCurrentTimeMs(playerRef.current.getCurrentTime() * 1000);
                }
              }, 100);
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

    loadYouTubeIframeAPI().then(initPlayer);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [video]);

  // Apply speed changes to YouTube player
  useEffect(() => {
    if (playerRef.current?.setPlaybackRate) {
      playerRef.current.setPlaybackRate(playbackSpeed);
    }
  }, [playbackSpeed]);

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

  const stopSlowListen = useCallback(() => {
    if (slowListenTimerRef.current) {
      clearInterval(slowListenTimerRef.current);
      slowListenTimerRef.current = null;
    }
    const a = slowListenAudioRef.current;
    if (a && !a.paused) a.pause();
    setIsSlowListening(false);
  }, []);

  // Drop the slow-listen element with its source, so a stale element can
  // never keep playing the previous video's audio.
  useEffect(() => {
    return () => {
      stopSlowListen();
      slowListenAudioRef.current = null;
    };
  }, [tiktokAudioUrl, stopSlowListen]);

  // Timer-based playback for legacy TikTok without uploaded audio. Always
  // real time — the synced players only ever run at 1x now.
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
      if (!isAuthenticated || !user) {
        toast.error("Please log in to save words");
        return;
      }
      try {
        // Best-effort: clip the sentence audio from the source video so the
        // flashcard plays with native audio. If native audio isn't available
        // (typical for YouTube videos without an extracted track), fall back
        // to TTS so the flashcard is always saved with playable audio.
        let sentenceAudioUrl: string | undefined;
        let wordAudioUrl: string | undefined;
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

        // TTS fallback for sentence + word (routed to native dialect voice).
        const dialectHint = (video as any)?.dialect ?? null;
        if (!sentenceAudioUrl && word.sentenceText) {
          sentenceAudioUrl =
            (await synthesizeAndUploadTTS(word.sentenceText, user.id, dialectHint, "sentence")) ?? undefined;
        }
        if (!wordAudioUrl && word.arabic) {
          wordAudioUrl =
            (await synthesizeAndUploadTTS(word.arabic, user.id, dialectHint, "word")) ?? undefined;
        }

        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          sentence_text: word.sentenceText,
          sentence_english: word.sentenceEnglish,
          sentence_audio_url: sentenceAudioUrl,
          word_audio_url: wordAudioUrl,
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

  const allLines = useMemo(
    () => ((video?.transcript_lines as any[]) ?? []) as TranscriptLine[],
    [video],
  );
  // The transcript is what was SAID. Overlays live in `visual_timeline` now,
  // but rows analysed before that column existed still carry theirs inline, so
  // they are filtered back out here before anything reads the transcript.
  const lines = useMemo(() => splitTranscriptLines(allLines).spoken, [allLines]);
  const screenText = useMemo(() => screenTextFor(video), [video]);

  // Most of the Discover library was analysed before the Fusha pass existed,
  // so the row is filled in on demand the first time a learner asks for it.
  const { fushaFor, status: fushaStatus } = useFushaLines(
    lines,
    showFusha,
    video?.dialect ?? "Gulf",
  );

  // For YouTube: find active line by time. For others: use manual index.
  const isYouTube = video?.platform === "youtube";
  const isTikTok = video?.platform === "tiktok";
  const horizontalVideoMaxHeightClass = "max-h-[min(45vh,calc(100dvh-15rem))]";
  const verticalVideoMaxHeightClass = "max-h-[min(72vh,calc(100dvh-13rem))]";

  useEffect(() => {
    return () => {
      if (shadowPollRef.current) clearInterval(shadowPollRef.current);
    };
  }, []);

  // Drives shadow-clip playback through the MAIN video's already-existing YT
  // player instead of a fresh iframe. A brand new hidden iframe created only
  // for shadowing has no prior engagement with the browser's autoplay policy,
  // so its first programmatic playVideo() gets silently blocked until some
  // other YouTube embed on the page has already played — this is why
  // shadowing previously required pressing play on the main video first.
  // Reusing the main player, which is already proven to play, avoids that.
  const mainYouTubeShadowController = useMemo<ExternalYouTubeController | null>(() => {
    if (!isYouTube) return null;
    return {
      play: async (startSec, endSec, rate, onEnded) => {
        const p = playerRef.current;
        if (!p?.seekTo || !p?.playVideo) return false;
        if (shadowPollRef.current) {
          clearInterval(shadowPollRef.current);
          shadowPollRef.current = null;
        }
        isSeekingRef.current = true;
        setTimeout(() => { isSeekingRef.current = false; }, 1200);
        try {
          p.setPlaybackRate?.(rate);
        } catch {
          /* not all rates supported */
        }
        p.seekTo(startSec, true);
        p.playVideo();

        // Confirm playback actually STARTED (currentTime advancing inside the
        // clip, or player state === PLAYING) before reporting success. If it
        // never starts within the watchdog window, resolve false so the panel
        // recovers instead of hanging forever on "Listening…".
        return await new Promise<boolean>((resolve) => {
          const startedAt = Date.now();
          let confirmed = false;
          let lastCur = -1;
          let settled = false;
          const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
          shadowPollRef.current = setInterval(() => {
            const cur = p.getCurrentTime?.() ?? 0;
            if (!confirmed) {
              const advancing = lastCur >= 0 && cur > lastCur + 0.01;
              const isPlaying = p.getPlayerState?.() === 1; // YT.PlayerState.PLAYING
              if ((isPlaying || advancing) && cur >= startSec - 0.3 && cur < endSec) {
                confirmed = true;
                settle(true);
              } else if (Date.now() - startedAt > 5000) {
                if (shadowPollRef.current) {
                  clearInterval(shadowPollRef.current);
                  shadowPollRef.current = null;
                }
                try { p.pauseVideo?.(); } catch { /* ignore */ }
                settle(false);
                return;
              }
            }
            lastCur = cur;
            if (confirmed && cur >= endSec - 0.05) {
              try { p.pauseVideo?.(); } catch { /* ignore */ }
              if (shadowPollRef.current) {
                clearInterval(shadowPollRef.current);
                shadowPollRef.current = null;
              }
              try {
                p.setPlaybackRate?.(playbackSpeedRef.current);
              } catch {
                /* not all rates supported */
              }
              onEnded();
            }
          }, 100);
        });
      },
      pause: () => {
        if (shadowPollRef.current) {
          clearInterval(shadowPollRef.current);
          shadowPollRef.current = null;
        }
        playerRef.current?.pauseVideo?.();
      },
    };
  }, [isYouTube]);

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
    : activeLine ?? lines[lineControlIndex] ?? null;

  // Everything the assistant is told about this video. The transcript is the
  // point: the tutor used to get one subtitle line, so "what did he mean
  // earlier?" had nothing behind it. All of this is already loaded to render
  // the page, so publishing it costs no extra fetch.
  const lineIndexOfDisplay = useMemo(
    () => (displayLine ? lines.findIndex((l) => l.id === displayLine.id) : -1),
    [lines, displayLine],
  );

  usePageAiContext(
    useMemo(() => {
      if (!video) return null;
      const vocabulary = Array.isArray(video.vocabulary)
        ? (video.vocabulary as Array<{ word?: string; arabic?: string; translation?: string; english?: string }>)
            .map((v) => ({
              arabic: String(v.arabic ?? v.word ?? "").trim(),
              english: (v.english ?? v.translation) ? String(v.english ?? v.translation).trim() : undefined,
            }))
            .filter((v) => v.arabic)
        : undefined;
      const grammarPoints = Array.isArray(video.grammar_points)
        ? (video.grammar_points as Array<string | { title?: string; point?: string; explanation?: string }>)
            .map((g) =>
              typeof g === "string" ? g : [g.title ?? g.point, g.explanation].filter(Boolean).join(" — "),
            )
            .filter((g) => g.length > 0)
        : undefined;

      return {
        kind: "video" as const,
        title: video.title,
        summary: `Watching a ${video.dialect} dialect video${video.cefr_level ? ` (${video.cefr_level})` : ""} with tap-to-translate subtitles.`,
        content: displayLine
          ? `${displayLine.arabic}${displayLine.translation ? ` — ${displayLine.translation}` : ""}`
          : undefined,
        document: {
          label: "Full transcript of this video",
          sourceUrl: video.source_url ?? undefined,
          sourceId: video.id,
          lines: lines.map((line, i) => ({
            index: i + 1,
            arabic: line.arabic,
            english: line.translation ?? undefined,
            atSeconds: line.startMs !== undefined ? line.startMs / 1000 : undefined,
          })),
        },
        meta: {
          level: video.cefr_level ?? undefined,
          dialect: video.dialect,
          vocabulary,
          grammarPoints,
          culturalContext: video.cultural_context ?? undefined,
          // What is burned into the frame right now — captions, POV lines,
          // title cards. Subtitles tell the tutor what was said; this is the
          // half of a meme that is never spoken aloud.
          visualContext: visualContextAt(
            video.visual_timeline,
            displayLine?.startMs !== undefined ? displayLine.startMs / 1000 : undefined,
          ),
        },
        position: {
          index: lineIndexOfDisplay >= 0 ? lineIndexOfDisplay + 1 : undefined,
          total: lines.length,
          atSeconds: displayLine?.startMs !== undefined ? displayLine.startMs / 1000 : undefined,
          durationSeconds: video.duration_seconds ?? undefined,
        },
      };
    }, [video, displayLine, lines, lineIndexOfDisplay]),
  );
  const displayLineShadowClip = useMemo(
    () => (displayLine ? buildShadowClipForLine(displayLine, video ?? undefined, shadowAudioUrl) : null),
    [displayLine, video, shadowAudioUrl],
  );

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
      cancelPendingAudioStart();
      tiktokAudioRef.current?.pause();
    }
    const currentLine = lines[lineControlIndex];
    if (currentLine) {
      phraseStartMsRef.current = currentLine.startMs ?? null;
      phraseEndMsRef.current = currentLine.endMs ?? null;
    }
  }, [playbackMode, isYouTube, isTikTok, cancelPendingAudioStart]); // intentionally exclude lines/lineControlIndex — only fire on mode switch

  // Phrase-end auto-pause, on a fine-grained clock. This used to ride
  // currentTimeMs state, which advances only as fast as `timeupdate` fires
  // (~250ms) or the YouTube poll ticked — every phrase bled a syllable of the
  // next line before pausing. Reading the real media clock on a 40ms interval
  // stops within a frame or two of the boundary.
  useEffect(() => {
    if (playbackMode !== "line") return;
    const usingTimer = isTikTok && !tiktokAudioReady;
    const isPlaying = isYouTube
      ? isYouTubePlaying
      : isTikTok
        ? (usingTimer ? timerPlaying : isTiktokAudioPlaying)
        : false;
    if (!isPlaying) return;

    const readNowMs = () => {
      if (isYouTube) return (playerRef.current?.getCurrentTime?.() ?? 0) * 1000;
      if (usingTimer) return timerMsRef.current;
      return (tiktokAudioRef.current?.currentTime ?? 0) * 1000;
    };

    const id = setInterval(() => {
      const endMs = phraseEndMsRef.current;
      if (endMs == null) return;
      const nowMs = readNowMs();

      if (isSeekingRef.current) {
        const startMs = phraseStartMsRef.current;
        if (startMs != null && nowMs >= startMs && nowMs < endMs) {
          isSeekingRef.current = false;
        }
        return;
      }

      if (nowMs >= endMs) {
        if (isYouTube) {
          playerRef.current?.pauseVideo?.();
          setIsYouTubePlaying(false);
        } else if (usingTimer) {
          setTimerPlaying(false);
        } else {
          tiktokAudioRef.current?.pause();
        }
      }
    }, 40);
    return () => clearInterval(id);
  }, [playbackMode, isYouTube, isTikTok, isYouTubePlaying, isTiktokAudioPlaying, tiktokAudioReady, timerPlaying]);

  // Auto-scroll to active line
  useEffect(() => {
    if (!activeLineId) return;
    const el = lineRefs.current.get(activeLineId);
    if (el && transcriptContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineId]);

  // Track view progress for personalized feed (throttled every 10s, marks complete at >=85%)
  const lastReportedRef = useRef<{ s: number; completed: boolean }>({ s: 0, completed: false });
  useEffect(() => {
    if (!videoId || !user) return;
    // Use the real media clock (currentTimeMs) whenever one drives playback:
    // YouTube, native html5, and TikTok with an extracted audio track. Only the
    // legacy manual-timer TikTok fallback relies on timerMs. Reading timerMs on
    // the TikTok-audio path left watched_seconds at 0 and never recorded a view.
    const usingRealClock =
      isYouTube || video?.platform === "html5" || (isTikTok && tiktokAudioReady);
    const seconds = Math.floor((usingRealClock ? currentTimeMs : timerMs) / 1000);
    if (seconds <= 0) return;
    const duration = video?.duration_seconds ?? 0;
    const completed = duration > 0 && seconds / duration >= 0.85;
    const last = lastReportedRef.current;
    if (seconds - last.s < 10 && completed === last.completed) return;
    lastReportedRef.current = { s: seconds, completed };
    recordView.mutate({ videoId, watchedSeconds: seconds, completed });
  }, [currentTimeMs, timerMs, videoId, user, video?.duration_seconds, video?.platform, isYouTube, isTikTok, tiktokAudioReady, recordView]);


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
  //
  // The mute MUST come from the URL param, spelled `muted` (an earlier `mute=1`
  // was ignored, leaving the player audible). But muting alone isn't enough: a
  // cross-origin iframe won't honour a postMessage("play") until it has had a
  // real user gesture INSIDE it, so the first press of our external red button
  // could never start the frame (tapping the video directly did, because that
  // is an in-iframe gesture).
  //
  // `autoplay=1` is what breaks that deadlock: the player is allowed to start
  // muted on its own (muted autoplay needs no gesture), and once it has started
  // it accepts our play/pause/seek commands for the rest of the session. We
  // immediately park it (seek 0 + pause) on that first autoplay tick — see the
  // priming branch in the message listener — so it sits warmed-up and ready
  // without running ahead of the audio.
  const tiktokIframeUrl = useMemo(() => {
    if (!video || video.platform !== "tiktok") return "";
    // rel=0 disables TikTok's "more videos" related-videos overlay. Without it,
    // once the primed frame is sitting paused the player covers it with a grid
    // of other clips instead of the still poster frame.
    const params = "?autoplay=1&muted=1&music_info=0&description=0&rel=0";
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

  // Robust, self-correcting sync of the muted TikTok video to a desired play
  // state. A single fire-and-forget postMessage("play") races the iframe
  // player's initialization and is silently dropped — which is why pressing
  // the custom (red) play button below the video used to start the audio but
  // leave the video frozen. Here we re-send the command until the player
  // confirms the target state via onStateChange (1 = playing, 2 = paused,
  // 0 = ended), or we exhaust a short retry budget.
  const tiktokPlayerReadyRef = useRef(false);
  // One-time autoplay "priming": the muted frame is allowed to start on its own
  // (muted autoplay needs no gesture); once it has, later play commands land. We
  // park it immediately so it doesn't run ahead of the audio. mountedAt bounds
  // priming to that initial autoplay, so a much later in-iframe tap isn't parked.
  const tiktokPrimedRef = useRef(false);
  const tiktokMountedAtRef = useRef(0);
  // Whether the frame has already been aligned to the audio for the current
  // play run. Guards against re-seeking on every "playing" event — buffering
  // recovery (state 3 → 1) mid-clip otherwise re-seeks and makes motion choppy.
  const tiktokAlignedRef = useRef(false);
  const tiktokObservedStateRef = useRef<number | null>(null);
  const tiktokVideoSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ensureTikTokVideoPlaying = useCallback((desired: boolean) => {
    if (tiktokVideoSyncTimerRef.current) {
      clearInterval(tiktokVideoSyncTimerRef.current);
      tiktokVideoSyncTimerRef.current = null;
    }
    // Only the player/v1 iframe accepts inbound postMessage control. When we
    // never resolved a numeric TikTok video id the iframe falls back to a plain
    // embed URL that ignores these commands, so there's nothing to drive — ask
    // the user to tap the video's own play button instead.
    if (!resolvedTikTokVideoId) {
      if (desired) setTiktokNeedsManualPlay(true);
      return;
    }
    const reachedTarget = () =>
      desired
        ? tiktokObservedStateRef.current === 1
        : tiktokObservedStateRef.current === 2 || tiktokObservedStateRef.current === 0;
    if (reachedTarget()) {
      if (desired) setTiktokNeedsManualPlay(false);
      return;
    }
    // Align the muted video to the hidden audio (our master clock) before we
    // start it, so the frame and the sound begin from the same position.
    if (desired) {
      const audio = tiktokAudioRef.current;
      if (audio) sendTikTokCommand("seekTo", audio.currentTime);
    }
    const attempt = () => {
      // Re-assert mute (defense in depth) then drive to the desired state.
      sendTikTokCommand("mute");
      sendTikTokCommand(desired ? "play" : "pause");
    };
    attempt();
    // Retry on a time budget rather than a fixed count: the player can take a
    // second or two to finish initializing, and commands sent before its
    // onPlayerReady are silently dropped. Keep re-asserting until the player
    // confirms the target state via onStateChange, or ~4s elapse.
    const startedAt = Date.now();
    tiktokVideoSyncTimerRef.current = setInterval(() => {
      if (reachedTarget()) {
        if (desired) setTiktokNeedsManualPlay(false);
        if (tiktokVideoSyncTimerRef.current) {
          clearInterval(tiktokVideoSyncTimerRef.current);
          tiktokVideoSyncTimerRef.current = null;
        }
        return;
      }
      if (Date.now() - startedAt > 4000) {
        if (tiktokVideoSyncTimerRef.current) {
          clearInterval(tiktokVideoSyncTimerRef.current);
          tiktokVideoSyncTimerRef.current = null;
        }
        // The frame never reported "playing" — muted cross-origin autoplay is
        // not guaranteed even with autoplay permission. Surface a manual-tap
        // hint so the user can start the video with a real in-iframe gesture.
        if (desired && tiktokObservedStateRef.current !== 1) {
          setTiktokNeedsManualPlay(true);
        }
        return;
      }
      attempt();
    }, 300);
  }, [sendTikTokCommand, resolvedTikTokVideoId]);

  /**
   * Start the hidden audio (the master clock) and the muted TikTok frame
   * together, video first.
   *
   * Seeking the local <audio> is near-instant while the cross-origin iframe
   * takes several hundred ms to seek and start — so starting the audio first
   * put the sound ahead of the picture on every phrase jump. When the frame is
   * controllable and currently paused, drive the VIDEO first and hold the
   * audio: the moment the player confirms "playing", the message listener
   * below sees the paused audio and starts it (the same path that handles taps
   * inside the iframe). A watchdog starts the audio anyway if the frame never
   * confirms, so sound is never hostage to the iframe.
   */
  const startTikTokPlayback = useCallback((startMs?: number) => {
    const audio = tiktokAudioRef.current;
    if (!audio || !tiktokAudioReady) return;
    stopSlowListen();
    cancelPendingAudioStart();
    if (typeof startMs === "number") {
      audio.currentTime = Math.max(0, startMs / 1000);
    }
    const videoIsPlaying = tiktokObservedStateRef.current === 1;
    const canDeferAudio =
      tiktokAudioEverPlayedRef.current && // Safari: first play must ride the gesture
      !!resolvedTikTokVideoId &&
      tiktokPrimedRef.current;
    if (videoIsPlaying || !canDeferAudio) {
      // Audio-first: either the frame is already rolling (the state listener
      // re-aligns it once on the next playing tick) or we can't defer safely.
      audio.play().catch(() => toast.error("Audio playback failed"));
      return;
    }
    ensureTikTokVideoPlaying(true);
    pendingAudioStartRef.current = setTimeout(() => {
      pendingAudioStartRef.current = null;
      if (audio.paused) audio.play().catch(() => {});
    }, 1500);
  }, [tiktokAudioReady, resolvedTikTokVideoId, ensureTikTokVideoPlaying, cancelPendingAudioStart, stopSlowListen]);

  /**
   * Replay the current phrase's audio at a reduced rate — listening only.
   *
   * Deliberately NOT the synced player: it runs on its own <audio> element
   * with the real playback (hidden audio + muted frame) paused, because the
   * TikTok iframe accepts no rate command and slowing only the master audio
   * clock dragged the picture out of sync a little more every second.
   */
  const playSlowListen = useCallback((rate: number) => {
    const line = displayLine;
    if (!tiktokAudioUrl || !line || line.startMs === undefined) return;
    stopSlowListen();
    // Park the synced pair first; the audio's pause handler stops the frame.
    cancelPendingAudioStart();
    const mainAudio = tiktokAudioRef.current;
    if (mainAudio && !mainAudio.paused) mainAudio.pause();

    let a = slowListenAudioRef.current;
    if (!a) {
      a = new Audio(tiktokAudioUrl);
      a.preload = "auto";
      slowListenAudioRef.current = a;
    }
    const clip = a;
    clip.playbackRate = rate;
    clip.currentTime = line.startMs / 1000;
    const endMs = line.endMs;
    clip
      .play()
      .then(() => {
        setIsSlowListening(true);
        slowListenTimerRef.current = setInterval(() => {
          const curMs = (clip.currentTime || 0) * 1000;
          if (clip.paused || clip.ended || (endMs !== undefined && curMs >= endMs)) {
            stopSlowListen();
          }
        }, 50);
      })
      .catch(() => {
        setIsSlowListening(false);
        toast.error("Audio playback failed");
      });
  }, [tiktokAudioUrl, displayLine, stopSlowListen, cancelPendingAudioStart]);

  const handleSeek = useCallback((ms: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(ms / 1000, true);
      playerRef.current.playVideo?.();
      return;
    }
    if (tiktokAudioRef.current && tiktokAudioReady) {
      startTikTokPlayback(ms);
    }
  }, [startTikTokPlayback, tiktokAudioReady]);

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
          startTikTokPlayback(targetLine.startMs);
        } else {
          // Legacy TikTok without uploaded source audio: run the manual timer
          // from this line so phrase mode still plays and auto-pauses.
          setTimerMs(targetLine.startMs);
          setTimerPlaying(true);
        }
      }
    },
    [handleSeek, startTikTokPlayback, isYouTube, isTikTok, lines, tiktokAudioReady],
  );

  // Pressing play again after a phrase auto-paused used to be a dead button:
  // playback resumed exactly AT the stored phrase end, and the stop logic
  // paused it again on the next tick. Treat a fresh start at/after the phrase
  // boundary as "play this phrase again" instead — this covers the main play
  // button, taps inside the TikTok/YouTube frame, everything.
  useEffect(() => {
    const isPlaying = isYouTube ? isYouTubePlaying : (isTikTok && isTiktokAudioPlaying);
    const wasPlaying = phraseWasPlayingRef.current;
    phraseWasPlayingRef.current = isPlaying;
    if (playbackMode !== "line" || !isPlaying || wasPlaying) return;
    if (isSeekingRef.current) return;
    const endMs = phraseEndMsRef.current;
    if (endMs == null) return;
    const nowMs = isYouTube
      ? (playerRef.current?.getCurrentTime?.() ?? 0) * 1000
      : (tiktokAudioRef.current?.currentTime ?? 0) * 1000;
    if (nowMs >= endMs - 50) {
      playLineByIndex(lineControlIndex);
    }
  }, [isYouTubePlaying, isTiktokAudioPlaying, playbackMode, isYouTube, isTikTok, lineControlIndex, playLineByIndex]);

  // Stop any pending retry loop when the video changes or the page unmounts,
  // so a stray timer never posts commands to a torn-down iframe.
  useEffect(() => {
    setTiktokNeedsManualPlay(false);
    tiktokPrimedRef.current = false;
    tiktokMountedAtRef.current = Date.now();
    tiktokAlignedRef.current = false;
    return () => {
      cancelPendingAudioStart();
      if (tiktokVideoSyncTimerRef.current) {
        clearInterval(tiktokVideoSyncTimerRef.current);
        tiktokVideoSyncTimerRef.current = null;
      }
    };
  }, [video?.id, cancelPendingAudioStart]);

  // Listen for TikTok player state changes so pressing play/pause INSIDE the
  // TikTok iframe also drives our hidden audio (and therefore the transcript
  // + translation sync). Without this, tapping play on the TikTok video
  // itself leaves the audio + subtitles frozen.
  useEffect(() => {
    if (!isTikTok || !tiktokIframeUrl) return;
    const onMessage = (e: MessageEvent) => {
      const data = e?.data as { type?: string; value?: any; "x-tiktok-player"?: boolean } | undefined;
      if (!data || data["x-tiktok-player"] !== true) return;
      // Re-assert mute whenever the player talks to us (defense in depth).
      const audio = tiktokAudioRef.current;
      switch (data.type) {
        case "onPlayerReady":
          tiktokPlayerReadyRef.current = true;
          sendTikTokCommand("mute");
          break;
        case "onStateChange":
        case "onPlay":
        case "play": {
          sendTikTokCommand("mute");
          const state =
            data.type === "onStateChange" && typeof data.value === "number"
              ? data.value
              : null;
          if (state !== null) {
            // Record the player's real state so ensureTikTokVideoPlaying's
            // retry loop can stop once the video actually reaches the target.
            tiktokObservedStateRef.current = state;
            // The frame is actually playing now — clear any manual-tap hint.
            if (state === 1) setTiktokNeedsManualPlay(false);
          }
          // "Playing" = an explicit state 1, or a bare onPlay/play with no value.
          const startedPlaying = state === 1 || state === null;

          // Priming: the very first "playing" comes from autoplay=1, before the
          // user pressed play. Park the muted video at the start (paused, warmed
          // up) so later play commands are honoured — and do NOT start the audio.
          if (
            startedPlaying &&
            !tiktokPrimedRef.current &&
            Date.now() - tiktokMountedAtRef.current < 6000 &&
            (!audio || audio.paused)
          ) {
            tiktokPrimedRef.current = true;
            sendTikTokCommand("seekTo", 0);
            sendTikTokCommand("pause");
            break;
          }

          if (!audio || !tiktokAudioReady) break;
          // Mirror the player's real state onto the hidden audio (master clock).
          if (state === 2) {
            tiktokAlignedRef.current = false; // real pause — next play re-aligns
            cancelPendingAudioStart();
            if (!audio.paused) audio.pause();
          } else if (state === 0) {
            tiktokAlignedRef.current = false;
            cancelPendingAudioStart();
            audio.pause();
          } else if (startedPlaying) {
            if (audio.paused) {
              // Started from inside the iframe (a direct tap): align the frame
              // to the audio and start the audio so the two run together.
              sendTikTokCommand("seekTo", audio.currentTime);
              audio.play().catch(() => {});
              tiktokAlignedRef.current = true;
            } else if (!tiktokAlignedRef.current) {
              // First "playing" of this run after a red-button start: align the
              // frame to the audio ONCE. Do NOT repeat on buffering recovery
              // (state 3 → 1) — re-seeking mid-clip is what makes motion choppy.
              sendTikTokCommand("seekTo", audio.currentTime);
              tiktokAlignedRef.current = true;
            }
          }
          break;
        }
        case "onPause":
        case "pause":
          cancelPendingAudioStart();
          if (audio && !audio.paused) audio.pause();
          break;
        case "onCurrentTime":
        case "currentTime":
          // Intentionally no continuous re-seeking. The frame and the hidden
          // audio are the same media, both always at 1x (the synced speed
          // control is YouTube-only), so aligning once when playback starts
          // (and on explicit scrubs via the audio's onSeeked handler)
          // keeps them together. Seeking the iframe on every tick to shave
          // sub-second drift made the video visibly choppy — and tended to feed
          // itself, since a fresh seek briefly reports a transitional position
          // that reads as more drift.
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isTikTok, tiktokIframeUrl, tiktokAudioReady, sendTikTokCommand, cancelPendingAudioStart]);

  // Keep the TikTok iframe visual-only. Sound is driven exclusively by our
  // hidden <audio> element via the extracted source track. (The legacy
  // blockquote embed path has been removed — the iframe is the only renderer.)

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
    // This page is also the feed's inline overlay, where browser-back is not
    // an obvious escape — a bare "Video not found" was a dead end with no way
    // out. `.single()` throws for a missing row and a failed fetch alike, so
    // offer the retry either way; a genuinely deleted clip just fails again.
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-lg font-semibold text-foreground">
          {videoError ? "This clip didn't load" : "Video not found"}
        </p>
        <p className="text-sm text-muted-foreground">
          {videoError
            ? "It may have been removed, or the connection dropped."
            : "It may have been removed."}
        </p>
        <div className="flex gap-2.5">
          {videoError && (
            <Button variant="outline" onClick={() => refetchVideo()}>
              Try again
            </Button>
          )}
          <Button onClick={() => (onBack ? onBack() : navigate("/discover"))}>
            {onBack ? "Back to the feed" : "Browse clips"}
          </Button>
        </div>
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
            onClick={() => (onBack ? onBack() : navigate("/discover"))}
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
                  {tiktokIframeUrl ? (
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
                  {/* Fallback prompt when the muted iframe never confirms it
                      started. pointer-events-none is essential: the hint must
                      never intercept the tap meant for TikTok's own play button
                      sitting underneath it. */}
                  {tiktokNeedsManualPlay && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
                      <span className="rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white shadow-elegant">
                        Tap the video to start it
                      </span>
                    </div>
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
                style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
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
              sendTikTokCommand("mute");
            }}
            onTimeUpdate={(e) => setCurrentTimeMs((e.currentTarget.currentTime || 0) * 1000)}
            onPlay={() => {
              tiktokAudioEverPlayedRef.current = true;
              // Synced playback resumed (a tap inside the iframe counts too) —
              // a still-running slow-listen clip would talk over it.
              stopSlowListen();
              cancelPendingAudioStart();
              setIsTiktokAudioPlaying(true);
              ensureTikTokVideoPlaying(true);
            }}
            onPause={() => { setIsTiktokAudioPlaying(false); ensureTikTokVideoPlaying(false); }}
            onSeeked={(e) => { sendTikTokCommand("mute"); sendTikTokCommand("seekTo", e.currentTarget.currentTime); }}
            onEnded={() => { setIsTiktokAudioPlaying(false); sendTikTokCommand("pause"); }}
          />
          {lines.length > 0 && (
            <div className="px-4 py-2 border-b border-border/50 bg-card/50 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant={isTiktokAudioPlaying ? "secondary" : "default"}
                size="sm"
                className="gap-2"
                onClick={() => {
                  const audio = tiktokAudioRef.current;
                  if (!audio) return;
                  if (isTiktokAudioPlaying) {
                    cancelPendingAudioStart();
                    audio.pause();
                    ensureTikTokVideoPlaying(false);
                  } else if (playbackMode === "line") {
                    // Phrase mode: same action as the phrase button — play the
                    // current line from its start. Resuming from wherever the
                    // clock stopped (usually exactly ON the phrase boundary)
                    // is what made this button look dead: the phrase-end stop
                    // paused it again on the very next tick.
                    playLineByIndex(lineControlIndex);
                  } else {
                    startTikTokPlayback();
                  }
                }}
                disabled={!tiktokAudioReady}
              >
                {isTiktokAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isTiktokAudioPlaying ? "Pause" : playbackMode === "line" ? "Play phrase" : "Play"}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.floor(currentTimeMs / 1000)}s
              </span>
              {/* Separate from playback on purpose: slows one phrase, listen-only. */}
              <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => (isSlowListening ? stopSlowListen() : playSlowListen(slowListenRate))}
                disabled={!tiktokAudioReady || !displayLine || displayLine.startMs === undefined}
              >
                <Turtle className="h-4 w-4" />
                {isSlowListening ? "Stop" : `Slow ${slowListenRate}x`}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-7 px-0 text-muted-foreground"
                    aria-label="Slow listen speed"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[100px]">
                  {([0.75, 0.5] as const).map((rate) => (
                    <DropdownMenuItem
                      key={rate}
                      onClick={() => setSlowListenRate(rate)}
                      className={cn("text-sm", slowListenRate === rate && "font-bold text-primary")}
                    >
                      {rate}x
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label="About slow listening"
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 text-xs leading-relaxed text-muted-foreground">
                  Slow listening is separate from the video. It replays the
                  current phrase's audio at a slower speed — the video won't
                  follow along, so you can only listen.
                </PopoverContent>
              </Popover>
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
                "hover:bg-muted active:scale-[0.98]",
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
                    style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
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
                  {showFusha && (
                    fushaFor(displayLine) ? (
                      <FushaLine
                        dialect={displayLine.arabic}
                        fusha={fushaFor(displayLine)}
                        variant="inline"
                      />
                    ) : fushaStatus === "loading" ? (
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 text-center">
                        Converting to فصحى…
                      </p>
                    ) : null
                  )}
                  {showTranslations && displayLine.translation && (
                    <>
                      <p
                        className="text-sm text-muted-foreground leading-relaxed"
                        style={{ fontFamily: "'Open Sans', sans-serif" }}
                      >
                        {displayLine.translation}
                      </p>
                    </>
                  )}
                  {showLiteral && displayLine.literal && (
                    <p
                      className="text-xs italic text-muted-foreground/80 leading-relaxed"
                      style={{ fontFamily: "'Open Sans', sans-serif" }}
                    >
                      <span className="not-italic uppercase tracking-wide text-[10px] mr-1.5 text-muted-foreground/60">
                        Literal
                      </span>
                      {displayLine.literal}
                    </p>
                  )}
                  {displayLine.arabic && (
                    <div className="flex flex-wrap justify-center gap-2 mt-2">
                      <AskAISentence
                        arabic={displayLine.arabic}
                        english={displayLine.translation}
                        variant="chip"
                        className="h-8 px-3 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                      />
                      {displayLineShadowClip && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleShadow(displayLine.id)}
                          className={cn(
                            "h-8 px-3 gap-1.5 rounded-full text-xs font-medium",
                            shadowLineId === displayLine.id
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                          )}
                        >
                          <Mic className="h-3.5 w-3.5" />
                          {shadowLineId === displayLine.id ? "Close" : "Practice shadowing"}
                        </Button>
                      )}
                    </div>
                  )}
                  {shadowLineId === displayLine.id && displayLineShadowClip && (
                    <div className="mx-auto max-w-xl text-left" onClick={(e) => e.stopPropagation()}>
                      <InlineLineShadow
                        clip={displayLineShadowClip}
                        audioUrl={shadowAudioUrl ?? null}
                        startMs={displayLine.startMs}
                        endMs={displayLine.endMs}
                        externalYouTubeController={mainYouTubeShadowController}
                        onClose={() => handleToggleShadow(displayLine.id)}
                      />
                    </div>
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
                "hover:bg-muted active:scale-[0.98]",
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
          {/* Speed control — YouTube only, where the IFrame API slows picture
              and sound together and the transcript stays in sync at any rate.
              TikTok's slow-down is the listen-only phrase control by its play
              button, because its iframe cannot be rate-controlled. */}
          {isYouTube && (
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
          )}
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
          <span className="text-xs text-muted-foreground ml-2">Literal</span>
          <Switch
            checked={showLiteral}
            onCheckedChange={setShowLiteral}
          />
          <span className="text-xs text-muted-foreground ml-2">Fusha</span>
          <Switch
            checked={showFusha}
            onCheckedChange={setShowFusha}
            aria-label="Show Fusha (MSA) line"
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

      {/* What the video shows, above what it says. */}
      <OnScreenTextPanel
        lines={screenText}
        showTranslations={showTranslations}
        onSeek={(seconds) => handleSeek(seconds * 1000)}
      />

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
              showLiteral={showLiteral}
              fusha={showFusha ? fushaFor(line) : undefined}
              onSave={isAuthenticated ? handleSaveToMyWords : undefined}
              savedWords={savedWords}
              lineRef={(el) => {
                if (el) lineRefs.current.set(line.id, el);
                else lineRefs.current.delete(line.id);
              }}
              onSeek={handleSeek}
              video={video}
              shadowAudioUrl={shadowAudioUrl}
              isShadowing={shadowLineId === line.id}
              onToggleShadow={handleToggleShadow}
              externalYouTubeController={mainYouTubeShadowController}
            />
          ))}
        </div>
      )}

      {/* Vocabulary, grammar & cultural context footer */}
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
                  <span dir="rtl" className="font-medium text-foreground" style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}>
                    {v.arabic}
                  </span>
                  <span className="text-muted-foreground text-xs truncate">{v.english}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <GrammarNotesSection
          videoId={video.id}
          points={(video.grammar_points as any[]) ?? []}
          videoDifficulty={video.difficulty}
        />


        {video.cultural_context && (
          <details className="group" open={!!video.is_meme}>
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
              {video.is_meme ? "Meme Insight" : "Cultural Context"}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {video.cultural_context}
            </p>
          </details>
        )}

        {/* Video Rating */}
        <VideoRating videoId={video.id} userId={user?.id} />
      </div>
    </div>

  );
};

export default DiscoverVideo;
