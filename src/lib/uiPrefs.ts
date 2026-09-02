/**
 * Cross-app UI preferences for sound + motion.
 * - Sound: user toggle, persisted in localStorage (default on).
 * - Motion: respects `prefers-reduced-motion` media query.
 */
import { useEffect, useState } from "react";

const SOUND_KEY = "hakiya:ui:sound";
const VOICE_ERROR_CAPTURE_KEY = "hakiya:ui:voice-error-capture";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SOUND_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function setSoundEnabled(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_KEY, v ? "1" : "0");
    window.dispatchEvent(new CustomEvent("hakiya:ui-sound-changed"));
  } catch {
    /* ignore */
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** React hook for sound preference. */
export function useSoundPref(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isSoundEnabled());
  useEffect(() => {
    const handler = () => setEnabled(isSoundEnabled());
    window.addEventListener("hakiya:ui-sound-changed", handler);
    return () => window.removeEventListener("hakiya:ui-sound-changed", handler);
  }, []);
  return [
    enabled,
    (v: boolean) => {
      setSoundEnabled(v);
      setEnabled(v);
    },
  ];
}

/** React hook for reduced-motion preference (live). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

/**
 * Whether the realtime voice tutor may feed the learner's mistakes into the
 * mistake drill (extract-learner-errors, source "voice").
 *
 * Off by default, deliberately. The evidence for the drill is strong; the
 * evidence that a *voice* "error" is the learner's rather than the
 * transcriber's is not — dialect ASR runs at 60%+ word error rate
 * (docs/language-learning-research-2026-09.md §5). Until that lane has been
 * checked against real transcripts it stays opt-in, so a learner who turns it
 * on is choosing the noise knowingly. The text tutor's lane needs no gate: the
 * learner typed what they meant.
 */
export function isVoiceErrorCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(VOICE_ERROR_CAPTURE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVoiceErrorCaptureEnabled(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VOICE_ERROR_CAPTURE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
