import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useLoopingVideo } from "@/hooks/useLoopingVideo";

/**
 * CaravanMedallion — the looping caravan clip that anchors the landing hero.
 *
 * A watercolour desert of Arabic-text dunes at sunset, with a camel train
 * crossing it. The caravan enters a couple of seconds in and is gone again by
 * the end, so the loop reads as a road that keeps being walked rather than as a
 * clip that restarts.
 *
 * The source is square (1440x1440, downscaled to 720), which is why the frame
 * below is an aspect-square box rather than a fixed height.
 *
 * Decorative only: `aria-hidden`. The hero copy beside it carries the meaning.
 */

const CARAVAN_MP4 = "/assets/caravan-hero.mp4";
const CARAVAN_WEBM = "/assets/caravan-hero.webm";
const CARAVAN_POSTER = "/assets/caravan-hero-poster.webp";

/**
 * clip-path rather than `rounded-* overflow-hidden` on the wrapper: Safari has
 * a long-standing bug where border-radius plus overflow fails to clip a <video>,
 * leaving square corners. The radius here has to be kept in step with the
 * wrapper's `rounded-[2rem]` by hand — clip-path can't read it.
 */
const ROUNDED: CSSProperties = {
  clipPath: "inset(0 round 2rem)",
  WebkitClipPath: "inset(0 round 2rem)",
};

export interface CaravanMedallionProps {
  className?: string;
}

export function CaravanMedallion({ className }: CaravanMedallionProps) {
  const { videoRef, still, onSourceError } = useLoopingVideo();

  return (
    <div
      aria-hidden="true"
      className={cn(
        "aspect-square w-full max-w-[300px] overflow-hidden rounded-[2rem]",
        "shadow-elegant ring-1 ring-desert-red/20",
        className,
      )}
    >
      {still ? (
        <img
          src={CARAVAN_POSTER}
          alt=""
          className="block h-full w-full object-cover"
          style={ROUNDED}
        />
      ) : (
        <video
          ref={videoRef}
          poster={CARAVAN_POSTER}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          disablePictureInPicture
          tabIndex={-1}
          className="block h-full w-full object-cover"
          style={ROUNDED}
        >
          {/*
            H.264 first: every mainstream browser plays it, so almost nobody
            fetches the WebM. The VP9 sibling is for builds that ship without
            proprietary codecs — distro Chromium and Firefox on Linux, and the
            headless Chromium our e2e suite runs on. Declaring `type` means an
            unsupported source is skipped without downloading it.
          */}
          <source src={CARAVAN_MP4} type='video/mp4; codecs="avc1.4D401E"' />
          {/* onError sits on the last candidate only — see useLoopingVideo. */}
          <source
            src={CARAVAN_WEBM}
            type='video/webm; codecs="vp9"'
            onError={onSourceError}
          />
        </video>
      )}
    </div>
  );
}
