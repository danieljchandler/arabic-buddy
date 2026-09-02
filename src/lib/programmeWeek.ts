/**
 * Where a learner is in a fixed-length programme, counted from first use.
 *
 * For pronunciation training the evidence has a threshold: programmes of one
 * to four weeks measured essentially nothing (g = 0.07), five to eight weeks
 * measured a large gain (g = 1.01) — docs/language-learning-research-2026-09.md
 * §5. A learner who stops at week three got nothing measurable, so the
 * surface says which week this is, and the metrics carry it, so retention
 * past week five becomes a number we watch rather than a hope.
 */

export const PRONUNCIATION_PROGRAMME_WEEKS = 5;
const FIRST_USE_KEY = "hakiya:pronunciation:first-use";
const WEEK_MS = 7 * 86_400_000;

export interface ProgrammeWeek {
  /** 1-based week since first use; never above `of`. */
  week: number;
  of: number;
  /** True from the start of the week after the last programme week. */
  complete: boolean;
  firstUse: string | null;
}

/** Pure: which week `now` falls in, counted from `firstUseIso`. */
export function programmeWeek(firstUseIso: string | null | undefined, now: Date, of = PRONUNCIATION_PROGRAMME_WEEKS): ProgrammeWeek {
  const first = firstUseIso ? Date.parse(firstUseIso) : Number.NaN;
  if (!Number.isFinite(first)) return { week: 1, of, complete: false, firstUse: null };
  const elapsedWeeks = Math.floor(Math.max(0, now.getTime() - first) / WEEK_MS);
  return {
    week: Math.min(of, elapsedWeeks + 1),
    of,
    complete: elapsedWeeks >= of,
    firstUse: new Date(first).toISOString(),
  };
}

/** Record first use if not already recorded; return the stored ISO date. */
export function recordPronunciationFirstUse(now: Date = new Date()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(FIRST_USE_KEY);
    if (existing && Number.isFinite(Date.parse(existing))) return existing;
    const iso = now.toISOString();
    window.localStorage.setItem(FIRST_USE_KEY, iso);
    return iso;
  } catch {
    return null;
  }
}

export function pronunciationFirstUse(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(FIRST_USE_KEY);
    return v && Number.isFinite(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}
