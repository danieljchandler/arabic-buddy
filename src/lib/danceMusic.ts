import { isSoundEnabled } from "@/lib/uiPrefs";

/**
 * Music under the dance: a few seconds of the dance's own music, looped for as
 * long as the celebration plays, cut on the beat the scene is timed to
 * (scripts/celebrations/make_dance_loop.py).
 *
 * For testing only so far. The loops come from recordings whose rights are
 * not cleared (docs/celebrations.md, "Music"), so a learner hears them only
 * after switching the test flag on with `?dancemusic=on` (and off again with
 * `?dancemusic=off`); a `?celebrate=` preview always plays them. The app's
 * sound switch silences them like every other sound.
 */

export const DANCE_MUSIC_PARAM = "dancemusic";
export const DANCE_MUSIC_KEY = "hikaya:dance-music";

/** How loud the loop plays: under the chime and the voice, not over them. */
export const DANCE_MUSIC_VOLUME = 0.6;
/** The fade when the celebration closes, so the loop never stops mid-stroke. */
export const DANCE_MUSIC_FADE_MS = 250;
/**
 * How long the scene waits for the music to start before dancing without it.
 * The scene's clock starts with the music so the first pose falls on the first
 * beat; a slow or refused load must not freeze the dancers.
 */
export const DANCE_MUSIC_START_TIMEOUT_MS = 400;

/** `?dancemusic=on` → true, `?dancemusic=off` → false, anything else → null. */
export function parseDanceMusicParam(search: string): boolean | null {
  const raw = new URLSearchParams(search).get(DANCE_MUSIC_PARAM)?.trim().toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") return true;
  if (raw === "off" || raw === "0" || raw === "false") return false;
  return null;
}

export function isDanceMusicTestOn(): boolean {
  try {
    return window.localStorage.getItem(DANCE_MUSIC_KEY) === "on";
  } catch {
    return false;
  }
}

export function setDanceMusicTestOn(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DANCE_MUSIC_KEY, "on");
    else window.localStorage.removeItem(DANCE_MUSIC_KEY);
  } catch {
    // Storage can be refused (a private window); the flag then lasts nowhere.
  }
}

/** Whether a celebration plays its dance's music: always in a preview, otherwise only with the test flag on. */
export function shouldPlayDanceMusic(preview: boolean): boolean {
  return isSoundEnabled() && (preview || isDanceMusicTestOn());
}
