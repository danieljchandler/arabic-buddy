import { useEffect, useState } from "react";

/**
 * Theme preference — light (default), dark ("night majlis"), or follow the
 * system. The `.dark` token block in index.css has existed for a long time;
 * this is the provider it never had. The preference is applied as a class on
 * <html>, which is what every `dark:` variant and the token block key off.
 *
 * Light stays the default on purpose: the warm-sand identity is the brand,
 * and dark is an opt-in reading mode rather than a second first-class theme.
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

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(getThemePref);

  const setPref = (next: ThemePref) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort persistence
    }
    setPrefState(next);
    applyTheme(next);
  };

  // While following the system, track live changes to its preference.
  useEffect(() => {
    if (pref !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [pref]);

  return { pref, setPref, resolved: resolveTheme(pref) };
}
