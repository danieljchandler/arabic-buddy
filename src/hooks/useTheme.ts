import { useSyncExternalStore } from "react";

/**
 * Theme preference — light (default), dark ("night majlis"), or follow the
 * system. The `.dark` token block in index.css has existed for a long time;
 * this is the provider it never had. The preference is applied as a class on
 * <html>, which is what every `dark:` variant and the token block key off.
 *
 * Light stays the default on purpose: the warm-sand identity is the brand,
 * and dark is an opt-in reading mode rather than a second first-class theme.
 *
 * Built on one module-level store rather than per-instance useState: the
 * Settings toggle and the app-wide pieces that render themed UI outside it
 * (the toaster, most of all) must see the same value at the same moment, or
 * a theme switch leaves them rendering the old palette for the session.
 */
export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "hakiya_theme";

export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "dark" || raw === "system" || raw === "light") return raw;
  } catch {
    // storage unavailable (private mode) — fall through
  }
  return "light";
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** Stamp the resolved theme onto <html>. Called at boot (main.tsx) and on
 *  every preference change. */
export function applyTheme(pref: ThemePref): void {
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
}

const subscribers = new Set<() => void>();

export function setThemePref(next: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // best-effort persistence
  }
  applyTheme(next);
  subscribers.forEach((fn) => fn());
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);

  // Track the device preference too, so `resolved` stays live while the
  // learner follows the system. Registered per subscriber and always (not
  // only while pref === 'system') — the handler itself checks.
  let mql: MediaQueryList | undefined;
  let onMedia: (() => void) | undefined;
  if (typeof window.matchMedia === "function") {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
    onMedia = () => {
      if (getThemePref() === "system") applyTheme("system");
      onChange();
    };
    mql.addEventListener?.("change", onMedia);
  }

  return () => {
    subscribers.delete(onChange);
    if (mql && onMedia) mql.removeEventListener?.("change", onMedia);
  };
}

/** Snapshot as a value-equal string so React only re-renders on real change. */
function snapshot(): string {
  const pref = getThemePref();
  return `${pref}|${resolveTheme(pref)}`;
}

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, snapshot);
  const [pref, resolved] = snap.split("|") as [ThemePref, "light" | "dark"];
  return { pref, setPref: setThemePref, resolved };
}
