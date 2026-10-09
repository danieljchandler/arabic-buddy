import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/uiPrefs";
import type { StoredAnimation } from "../../../supabase/functions/_shared/wordAnimation";

interface QuizAnimationProps {
  animation: StoredAnimation;
  /**
   * Show the poster instead of the moving clip. The picture question holds a
   * clip still when it would be the only option moving, so motion never
   * points at an answer.
   */
  still?: boolean;
  /** Classes for the picture or the clip itself (its fit within the frame). */
  className?: string;
}

/**
 * An action word's animation where its picture would be: a short looping clip
 * in the Ink style (quiz Phase 5, `kind: "animation"` in the shared store).
 *
 * It plays muted, looped and inline, as a picture does nothing but sit there:
 * no controls, no sound (the word's own audio is the card's, not the clip's),
 * and never full screen. Its poster — the still the clip starts and ends on —
 * is on screen before the first frame arrives, and is all that is shown when:
 *
 * - the learner asked for reduced motion (`prefers-reduced-motion`, read live,
 *   so turning it on mid-session stills a clip already playing);
 * - the caller holds it `still`;
 * - the clip cannot be loaded or played, which leaves the question as good as
 *   one asked from a picture.
 *
 * Decorative like the pictures it stands in for (`alt=""`): the question is
 * the same with or without it, and a screen reader is read the word.
 */
export const QuizAnimation = ({ animation, still = false, className }: QuizAnimationProps) => {
  const reduced = useReducedMotion();
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const showStill = still || reduced || failedFor === animation.clip;

  useEffect(() => {
    const video = ref.current;
    if (!video || showStill) return;
    // Set on the element, not only as a prop: React does not always write the
    // `muted` attribute, and a browser plays an unmuted clip by itself only
    // after the learner has touched the page.
    video.muted = true;
    video.defaultMuted = true;
    try {
      void Promise.resolve(video.play()).catch(() => {
        // Autoplay refused (a power saver, a data saver): the poster stays.
      });
    } catch {
      // Same.
    }
  }, [showStill, animation.clip]);

  if (showStill) {
    return <img src={animation.poster} alt="" className={className} data-testid="quiz-animation-still" />;
  }
  return (
    <video
      ref={ref}
      src={animation.clip}
      poster={animation.poster}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      className={className}
      onError={() => setFailedFor(animation.clip)}
      data-testid="quiz-animation"
    />
  );
};
