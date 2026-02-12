import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { TranscriptLine, VocabItem } from "@/types/transcript";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

const DiscoverVideo = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { data: video, isLoading } = useDiscoverVideo(videoId);
  const { isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLDivElement>(null);

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
        playerVars: {
          enablejsapi: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onStateChange: (event: any) => {
            // Playing
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

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [video]);

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
    [isAuthenticated, addUserVocabulary]
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!video) {
    return (
      <AppShell>
        <HomeButton />
        <p className="text-center text-muted-foreground py-16">Video not found</p>
      </AppShell>
    );
  }

  const lines = (video.transcript_lines as any[] ?? []) as TranscriptLine[];

  return (
    <AppShell>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/discover")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back to Discover
        </Button>
      </div>

      {/* Video embed */}
      <div className="rounded-xl overflow-hidden bg-foreground/5 mb-4">
        {video.platform === "youtube" ? (
          <div className="aspect-video">
            <div ref={iframeRef} className="w-full h-full" />
          </div>
        ) : (
          <div className="aspect-video">
            <iframe
              src={video.embed_url}
              className="w-full h-full"
              allowFullScreen
              allow="autoplay; encrypted-media"
            />
          </div>
        )}
      </div>

      {/* Title & metadata */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-foreground mb-2">{video.title}</h1>
        {video.title_arabic && (
          <p className="text-base font-arabic text-foreground/80 mb-2" dir="rtl">
            {video.title_arabic}
          </p>
        )}
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="outline">{video.dialect}</Badge>
          <Badge variant="outline">{video.difficulty}</Badge>
          <Badge variant="outline" className="capitalize">{video.platform}</Badge>
        </div>
      </div>

      {/* Synced transcript */}
      {lines.length > 0 && (
        <LineByLineTranscript
          lines={lines}
          currentTimeMs={currentTimeMs}
          onSaveToMyWords={isAuthenticated ? handleSaveToMyWords : undefined}
          savedWords={savedWords}
        />
      )}

      {/* Cultural context */}
      {video.cultural_context && (
        <div className="mt-6 p-4 rounded-xl bg-card border border-border">
          <h3 className="font-semibold text-foreground mb-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            Cultural Context
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{video.cultural_context}</p>
        </div>
      )}
    </AppShell>
  );
};

export default DiscoverVideo;
