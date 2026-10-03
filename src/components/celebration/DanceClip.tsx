import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/uiPrefs";
import { sceneAssets, type DanceScene } from "@/lib/celebrations";

/**
 * The dancer on a celebration screen: a few seconds of watercolor dance that
 * plays once and then holds on its last frame.
 *
 * LoopingMedallion's sibling rather than a use of it, because the two want
 * opposite things from the clip: page artwork loops forever and never asks to
 * be watched, while this is a moment that plays, *stops*, and can be asked to
 * go again. The frame (rounded box, ring, Safari clip-path) and the autoplay
 * workarounds are the same — see useLoopingVideo for why each exists.
 *
 * The last fraction of a second plays at half speed so the dancer settles
 * into the final pose instead of halting mid-step. Under reduced motion the
 * clip is never downloaded; the poster — the clip's first frame, a finished
 * painting in its own right — stands in for it.
 */

const ROUNDED: CSSProperties = {
  clipPath: "inset(0 round 2rem)",
  WebkitClipPath: "inset(0 round 2rem)",
};

/** How long before the end the clip slows into its final pose. */
export const SETTLE_SECONDS = 0.6;

export interface DanceClipProps {
  scene: DanceScene;
  className?: string;
}

export function DanceClip({ scene, className }: DanceClipProps) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { mp4, webm, poster } = sceneAssets(scene.id);
  const still = reduced || failed;

  useEffect(() => {
    if (still) return;
    const el = videoRef.current;
    if (!el) return;
    // A real DOM property, or Safari's autoplay policy rejects the play().
    el.muted = true;
    void el.play()?.catch(() => setFailed(true));
  }, [still]);

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    if (el.duration - el.currentTime <= SETTLE_SECONDS && el.playbackRate !== 0.5) {
      el.playbackRate = 0.5;
    }
  };

  const replay = () => {
    const el = videoRef.current;
    if (!el) return;
    setEnded(false);
    el.playbackRate = 1;
    el.currentTime = 0;
    void el.play()?.catch(() => setFailed(true));
  };

  return (
    <div
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-[2rem]",
        "bg-card-cream shadow-elegant ring-1 ring-desert-red/20",
        className,
      )}
    >
      {still ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="block h-full w-full select-none object-cover"
          style={ROUNDED}
        />
      ) : (
        <video
          ref={videoRef}
          aria-hidden="true"
          poster={poster}
          autoPlay
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          onTimeUpdate={onTimeUpdate}
          onEnded={() => setEnded(true)}
          className="block h-full w-full object-cover"
          style={ROUNDED}
        >
          {/* Same order and reasoning as LoopingMedallion: H.264 first, VP9
              for builds without proprietary codecs (and the e2e Chromium). */}
          <source src={mp4} type='video/mp4; codecs="avc1.4D401E"' />
          <source src={webm} type='video/webm; codecs="vp9"' onError={() => setFailed(true)} />
        </video>
      )}
      {!still && ended && (
        <button
          type="button"
          onClick={replay}
          aria-label={`Watch the ${scene.nameEn} again`}
          className="absolute bottom-3 end-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/85 text-foreground shadow-soft ring-1 ring-border transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring animate-scale-in"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
