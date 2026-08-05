import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * LoadingEmblem — the looping dallah-and-finjan mark shown during long waits.
 *
 * The artwork composites onto whatever is behind it: no plate, no background.
 * H.264 can't carry alpha and an actual alpha channel doesn't compress for line
 * art of this kind (VP9-alpha came out at 2.4MB against 364KB here, animated
 * WebP at 6.4MB), so the clip ships as dark line art on a **white** matte and
 * `#hakiya-emblem-alpha` in index.html turns luminance into alpha.
 *
 * A blend mode would be the obvious alternative and it does not work: AppShell's
 * content wrapper carries `animate-fade-up`, whose `both` fill-mode leaves a
 * persistent transform — a stacking context, so an isolation boundary — and that
 * wrapper has no background. Inside a card `mix-blend-mode: multiply` is flawless;
 * directly in the wrapper, as on the ReadingPractice loading screen, it has
 * nothing to blend against and the white rectangle shows through.
 *
 * Decorative only: `aria-hidden`. LoadingPanel carries the announced text.
 */

const EMBLEM_MP4 = "/assets/loading-emblem.mp4";
const EMBLEM_WEBM = "/assets/loading-emblem.webm";
const EMBLEM_POSTER = "/assets/loading-emblem-poster.webp";

/** The clip is 5:4, so these are ~0.8x as tall as they are wide. */
const SIZES = {
  sm: "w-[150px]",
  md: "w-[210px]",
  lg: "w-[260px]",
} as const;

/** Defined in index.html; see the note there on why the region is pinned. */
const ALPHA_FILTER = { filter: "url(#hakiya-emblem-alpha)" } as const;

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
    <div aria-hidden="true" className={cn(SIZES[size], className)}>
      {still ? (
        <img
          src={EMBLEM_POSTER}
          alt=""
          className="block w-full"
          style={ALPHA_FILTER}
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
          className="block w-full"
          style={ALPHA_FILTER}
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
