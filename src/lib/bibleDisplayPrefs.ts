/**
 * Bible Lessons display preferences.
 * Persisted in localStorage; synced across components in the same tab via a
 * custom event, and across tabs via the native `storage` event.
 */

export type BibleDisplayPrefs = {
  showArabic: boolean;   // dialect verse text
  showTashkil: boolean;  // keep Arabic diacritics
  showFormal: boolean;   // formal Arabic (MSA) row
  showEnglish: boolean;  // English translation row
};

const STORAGE_KEY = "lahja:bible-display-prefs";
const EVENT = "lahja:bible-display-prefs-changed";

export const DEFAULT_BIBLE_DISPLAY_PREFS: BibleDisplayPrefs = {
  showArabic: true,
  showTashkil: true,
  showFormal: false,
  showEnglish: false,
};

export function loadBibleDisplayPrefs(): BibleDisplayPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BIBLE_DISPLAY_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BIBLE_DISPLAY_PREFS, ...parsed };
  } catch {
    return DEFAULT_BIBLE_DISPLAY_PREFS;
  }
}

export function saveBibleDisplayPrefs(prefs: BibleDisplayPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeBibleDisplayPrefs(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}

/** Strip Arabic diacritics (tashkil) and tatweel from text. */
export function stripTashkil(text: string): string {
  if (!text) return text;
  // U+0610–U+061A, U+064B–U+065F, U+0670, U+06D6–U+06ED, U+0640 (tatweel)
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
}
