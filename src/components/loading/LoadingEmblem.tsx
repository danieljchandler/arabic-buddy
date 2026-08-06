import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * LoadingEmblem — the looping dallah-and-finjan mark shown during long waits.
 *
 * The clip is shown exactly as supplied, cropped to a circular medallion. Its own
 * warm background is part of the design, so there is no keying, no alpha and no
 * blend mode here — an earlier revision needed all three to fake transparency
 * against a grey matte, and none of it survives.
 *
 * The source is square (a 700x700 crop centred on the subject, verified so that
 * nothing crosses the inscribed circle in any frame), which is why the size
 * classes below are diameters.
 *
 * Decorative only: `aria-hidden`. LoadingPanel carries the announced text.
 */

const EMBLEM_MP4 = "/assets/loading-emblem.mp4";
const EMBLEM_WEBM = "/assets/loading-emblem.webm";
const EMBLEM_POSTER = "/assets/loading-emblem-poster.webp";

/** Diameters — the asset is square. */
const SIZES = {
  sm: "w-[140px]",
  md: "w-[190px]",
  lg: "w-[230px]",
} as const;

/**
 * clip-path rather than `rounded-full overflow-hidden` on the wrapper: Safari has
 * a long-standing bug where border-radius plus overflow fails to clip a <video>,
 * leaving square corners. clip-path clips it reliably.
 */
const CIRCLE: CSSProperties = {
  clipPath: "circle(50%)",
  WebkitClipPath: "circle(50%)",
};

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
    // and an 8s loop decoding behind a background tab is real battery.
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
        "aspect-square overflow-hidden rounded-full ring-1 ring-border/60",
        SIZES[size],
        className,
      )}
    >
      {still ? (
        <img
          src={EMBLEM_POSTER}
          alt=""
          className="block h-full w-full object-cover"
          style={CIRCLE}
        />
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
          className="block h-full w-full object-cover"
          style={CIRCLE}
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
