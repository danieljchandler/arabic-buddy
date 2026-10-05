/**
 * User preference: whether finishing a lesson, a video, a debrief or the day's
 * tasks plays a personalised celebration song. Default on; each song is a
 * generation the learner's daily allowance pays for, so it is easy to turn off.
 */
const KEY = "hakiya:celebration-songs-enabled";
const EVENT = "hakiya:celebration-prefs-changed";

export function loadCelebrationSongsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveCelebrationSongsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeCelebrationPrefs(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}
