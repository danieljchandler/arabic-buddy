/**
 * monologueTasks — how long a self-recorded monologue should be, by level.
 *
 * The lengths implement the research verdict rather than a hunch
 * (docs/plateau-research-2026-09.md §5): ~60 seconds of speech already
 * carries most of the fluency signal, reliability comes more from several
 * short prompts on different topics than from one long ramble, and low-level
 * speakers demonstrably cannot fill even 45-120 seconds — a fixed 3-5 minute
 * ask would produce abandonment exactly where our beginners sit. So targets
 * scale with placement: short paired prompts at A, a couple of minutes at B,
 * and the long free-form monologue only at C.
 *
 * Targets are *targets*, not gates. Stopping early is allowed and recorded —
 * that a learner ran dry at 20 seconds is itself the finding.
 */

export type MonologueBand = "beginner" | "intermediate" | "advanced";

export interface MonologueTaskSpec {
  band: MonologueBand;
  /** Prompts a full session suggests — several short beats one long. */
  promptCount: number;
  /** What to aim for per prompt, in seconds. */
  targetSeconds: number;
  /** Recorder hard cap per prompt — a ceiling, comfortably past the target. */
  hardCapSeconds: number;
}

const SPECS: Record<MonologueBand, MonologueTaskSpec> = {
  // ~60s of speech per prompt is where the signal already lives; two short
  // prompts beat one longer one and stay fillable at A-level.
  beginner: { band: "beginner", promptCount: 2, targetSeconds: 45, hardCapSeconds: 120 },
  intermediate: { band: "intermediate", promptCount: 2, targetSeconds: 90, hardCapSeconds: 210 },
  // The 3-5 minute free-form monologue is defensible only here.
  advanced: { band: "advanced", promptCount: 1, targetSeconds: 240, hardCapSeconds: 360 },
};

/**
 * The task spec for a CEFR placement level. Unknown or missing levels get the
 * beginner spec — the safe direction, since an over-long ask is the failure
 * mode with evidence behind it.
 */
export function taskSpecForLevel(cefrLevel: string | null | undefined): MonologueTaskSpec {
  switch (cefrLevel?.toUpperCase()) {
    case "B1":
    case "B2":
      return SPECS.intermediate;
    case "C1":
    case "C2":
      return SPECS.advanced;
    default:
      return SPECS.beginner;
  }
}

/** 95 → "1:35". For the recorder clock and the target label. */
export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The change worth showing next to a metric: the latest attempt against the
 * mean of the earlier ones. Null until there is something to compare —
 * showing a delta against nothing invites reading noise as progress.
 */
export function latestDelta(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length < 2) return null;
  const latest = clean[clean.length - 1];
  const earlier = clean.slice(0, -1);
  const mean = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  return Math.round((latest - mean) * 100) / 100;
}

/**
 * The metrics the trend view charts, with how to read each one.
 *
 * Deliberately not a composite score, and repairs are deliberately absent
 * from anything scored: repair counts are non-linear across proficiency
 * levels, and no Arabic norms exist to band any of this against — trends over
 * the learner's own attempts are the honest v1.
 */
export interface TrendMetricDef {
  key: "speechRateSylPerSec" | "articulationRateSylPerSec" | "meanLengthOfRunWords" | "pausesPerMinute";
  label: string;
  unit: string;
  /** Which direction usually reads as progress. */
  goodDirection: "up" | "down";
}

export const TREND_METRICS: TrendMetricDef[] = [
  { key: "speechRateSylPerSec", label: "Speech rate", unit: "syl/s", goodDirection: "up" },
  { key: "articulationRateSylPerSec", label: "Articulation rate", unit: "syl/s", goodDirection: "up" },
  { key: "meanLengthOfRunWords", label: "Words per run", unit: "words", goodDirection: "up" },
  { key: "pausesPerMinute", label: "Pauses", unit: "/min", goodDirection: "down" },
];

/** A metric value out of the stored attempt jsonb, defensively. */
export function metricValue(metrics: unknown, key: TrendMetricDef["key"]): number | null {
  const value = (metrics as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
