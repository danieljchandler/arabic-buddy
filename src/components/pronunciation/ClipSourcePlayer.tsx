/**
 * ClipSourcePlayer — plays a native-speaker clip from either:
 *   - YouTube (via IFrame API, seek + stop-at-end)
 *   - Direct audio URL (HTMLAudioElement)
 *
 * Exposes an imperative handle: play(rate), pause(). Calls onEnded when the
 * clip naturally reaches its end timestamp (NOT when paused manually).
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ShadowClip } from "@/hooks/useShadowQueue";
import { loadYouTubeIframeAPI } from "@/lib/youtubeIframeApi";

export interface ClipSourcePlayerHandle {
  play: (rate?: number) => Promise<void>;
  pause: () => void;
  isReady: () => boolean;
}

interface Props {
  clip: ShadowClip;
  onEnded: () => void;
  onError?: (msg: string) => void;
  className?: string;
}

interface YTPlayer {
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  setPlaybackRate: (r: number) => void;
  destroy: () => void;
}

export const ClipSourcePlayer = forwardRef<ClipSourcePlayerHandle, Props>(
  ({ clip, onEnded, onError, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const ytPlayerRef = useRef<YTPlayer | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const endedCalledRef = useRef(false);
    const [ready, setReady] = useState(clip.source === "audio");

    // Reset endedCalled when clip changes
    useEffect(() => {
      endedCalledRef.current = false;
    }, [clip.id]);

    // Mount YouTube player
    useEffect(() => {
      if (clip.source !== "youtube" || !clip.youtubeId) return;
      let cancelled = false;
      let player: YTPlayer | null = null;
      loadYouTubeIframeAPI().then(() => {
        if (cancelled || !containerRef.current) return;
        const YT = (window as unknown as { YT: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer } }).YT;
        const div = document.createElement("div");
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(div);
        player = new YT.Player(div, {
          videoId: clip.youtubeId,
          width: "100%",
          height: "100%",
          playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1, disablekb: 1, fs: 0 },
          events: {
            onReady: () => setReady(true),
            onError: () => onError?.("Video failed to load"),
          },
        });
        ytPlayerRef.current = player;
      });
      return () => {
        cancelled = true;
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        try {
          player?.destroy();
        } catch {
          /* ignore */
        }
        ytPlayerRef.current = null;
        setReady(false);
      };
    }, [clip.id, clip.youtubeId, clip.source, onError]);

    useImperativeHandle(ref, () => ({
      isReady: () => {
        if (clip.source === "youtube") return !!ytPlayerRef.current && ready;
        return !!audioRef.current;
      },
      play: async (rate = 1) => {
        endedCalledRef.current = false;
        if (clip.source === "youtube") {
          const p = ytPlayerRef.current;
          if (!p) return;
          p.seekTo(clip.startSec, true);
          try {
            p.setPlaybackRate(rate);
          } catch {
            /* not all rates supported */
          }
          p.playVideo();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = setInterval(() => {
            const cur = p.getCurrentTime();
            if (cur >= clip.endSec - 0.05) {
              p.pauseVideo();
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              if (!endedCalledRef.current) {
                endedCalledRef.current = true;
                onEnded();
              }
            }
          }, 80);
        } else {
          const a = audioRef.current;
          if (!a) return;
          a.playbackRate = rate;
          a.currentTime = clip.startSec;
          const onTime = () => {
            if (a.currentTime >= clip.endSec - 0.05) {
              a.pause();
              a.removeEventListener("timeupdate", onTime);
              if (!endedCalledRef.current) {
                endedCalledRef.current = true;
                onEnded();
              }
            }
          };
          a.addEventListener("timeupdate", onTime);
          try {
            await a.play();
          } catch (e) {
            a.removeEventListener("timeupdate", onTime);
            onError?.(e instanceof Error ? e.message : "Audio playback failed");
          }
        }
      },
      pause: () => {
        if (clip.source === "youtube") {
          ytPlayerRef.current?.pauseVideo();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        } else {
          audioRef.current?.pause();
        }
      },
    }), [clip, ready, onEnded, onError]);

    if (clip.source === "audio") {
      return (
        <div className={className}>
          <audio ref={audioRef} src={clip.audioUrl} preload="auto" />
        </div>
      );
    }
    return <div ref={containerRef} className={className} />;
  }
);
ClipSourcePlayer.displayName = "ClipSourcePlayer";
