import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * LoadingEmblem — the looping dallah-and-finjan mark shown during long waits.
 *
 * The source clip is a dark-red line illustration whose background is a flat
 * cream matching `--card-cream`, baked in at encode time. That's deliberate:
 * H.264 can't carry alpha, and no CSS blend mode can isolate a mid-tone
 * background, so the emblem sits on a cream plate and the seam disappears. The
 * plate stays cream in dark mode too (`--card-cream` is not redefined there) —
 * it reads as a lit page, which suits the motif, and is dimmed slightly so it
 * doesn't glare.
 *
 * Decorative only: `aria-hidden`. LoadingPanel carries the announced text.
 */

const EMBLEM_MP4 = "/assets/loading-emblem.mp4";
const EMBLEM_WEBM = "/assets/loading-emblem.webm";
const EMBLEM_POSTER = "/assets/loading-emblem-poster.webp";

const SIZES = {
  sm: "w-[180px]",
  md: "w-[260px]",
  lg: "w-[320px]",
} as const;

export interface LoadingEmblemProps {
  size?: keyof typeof SIZES;
  className?: string;
}

export function LoadingEmblem({ size = "md", className }: LoadingEmblemProps) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reduced motion skips the video entirely rather than pausing it — no decode
  // cost, no download. The poster is the same artwork, held still.
  const still = reduced || failed;

  useEffect(() => {
    if (still) return;
    const el = videoRef.current;
    if (!el) return;

    // `muted` has to be set as a real DOM property, not just the JSX attribute,
    // or Safari's autoplay policy rejects the play(). autoPlay alone is also
    // unreliable when the element mounts inside a conditional subtree.
    el.muted = true;
    void el.play()?.catch(() => setFailed(true));

    // Most browsers pause hidden video for us; Android WebView doesn't always,
    // and a 10s loop decoding behind a background tab is real battery.
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else void el.play()?.catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [still]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-2xl bg-card-cream ring-1 ring-border shadow-soft dark:opacity-90",
        SIZES[size],
        className,
      )}
    >
      {still ? (
        <img src={EMBLEM_POSTER} alt="" className="block w-full" />
      ) : (
        <video
          ref={videoRef}
          poster={EMBLEM_POSTER}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          disablePictureInPicture
          tabIndex={-1}
          className="block w-full"
        >
          {/*
            H.264 first: every mainstream browser plays it, so almost nobody
            fetches the WebM. The VP9 sibling is for builds that ship without
            proprietary codecs — distro Chromium and Firefox on Linux, and the
            headless Chromium our e2e suite runs on. Declaring `type` means an
            unsupported source is skipped without downloading it.
          */}
          <source src={EMBLEM_MP4} type='video/mp4; codecs="avc1.4D401E"' />
          {/*
            onError sits on the last candidate only — the browser walks the list
            in order and this is the one that fires when nothing playable is
            left. (A blocked autoplay is a rejected play(), handled above.)
          */}
          <source
            src={EMBLEM_WEBM}
            type='video/webm; codecs="vp9"'
            onError={() => setFailed(true)}
          />
        </video>
      )}
    </div>
  );
}
