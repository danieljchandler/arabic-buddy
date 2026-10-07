import { useEffect, useState } from "react";
import {
  DANCE_MUSIC_FADE_MS,
  DANCE_MUSIC_START_TIMEOUT_MS,
  DANCE_MUSIC_VOLUME,
} from "@/lib/danceMusic";

/**
 * Plays a dance's music loop while the component is mounted, and fades it out
 * when it unmounts.
 *
 * Returns whether the dance may start: true once the music is playing, or
 * once it has failed, been refused (Safari outside a tap) or not started
 * within DANCE_MUSIC_START_TIMEOUT_MS. With no music it is true at once. The
 * scene starts its clock on it, so the first pose lands on the first beat
 * rather than a fetch's latency ahead of it.
 */
export function useDanceMusic(src: string | null | undefined): boolean {
  const [started, setStarted] = useState(!src);

  useEffect(() => {
    if (!src) {
      setStarted(true);
      return;
    }
    setStarted(false);
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = DANCE_MUSIC_VOLUME;
    const go = () => setStarted(true);
    audio.addEventListener("playing", go);
    audio.addEventListener("error", go);
    const timeout = window.setTimeout(go, DANCE_MUSIC_START_TIMEOUT_MS);
    Promise.resolve(audio.play()).catch(go);

    return () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("playing", go);
      audio.removeEventListener("error", go);
      // Fade rather than cut, so the loop never stops mid-stroke.
      const steps = 10;
      let step = 0;
      const fade = window.setInterval(() => {
        step += 1;
        audio.volume = Math.max(0, DANCE_MUSIC_VOLUME * (1 - step / steps));
        if (step >= steps) {
          window.clearInterval(fade);
          audio.pause();
        }
      }, DANCE_MUSIC_FADE_MS / steps);
    };
  }, [src]);

  return started;
}
