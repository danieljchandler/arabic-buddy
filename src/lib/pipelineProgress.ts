/**
 * Reading the transcription pipeline's own progress note off a video row.
 *
 * `process-approved-video` writes where it has got to into
 * `engines_used.pipeline` on every stage boundary and every heartbeat. This
 * turns that into something the admin page can show, because "it spins
 * forever" is the same report whether the cause is a dead worker, a refused
 * stage hop, a slow analysis, or an old copy of the function still being
 * served — and an admin watching a spinner has no way to tell those apart.
 *
 * Three things it deliberately surfaces:
 *
 *   - the **step**, so a stall has a location rather than just a duration;
 *   - how long since the run last moved, which is what separates a slow step
 *     from a dead one (a live run touches the row every 30s);
 *   - the **build** of the deployed function, so a run showing a build nobody
 *     recognises answers "did the deploy land?" before anything else in the
 *     report is worth reading.
 */

export interface PipelineNote {
  stage?: unknown;
  note?: unknown;
  attempt?: unknown;
  hop?: unknown;
  build?: unknown;
  at?: unknown;
}

export interface PipelineProgress {
  /** The step being worked on, in the admin's words. */
  step: string;
  /** How the run reached this stage: normal, or degraded to running inline. */
  inline: boolean;
  /** Which build of the edge function wrote this, when it said. */
  build: string | null;
  /** Milliseconds since the run last said anything, or null if it never has. */
  quietForMs: number | null;
  /** Nothing has been heard for longer than a live run ever goes quiet. */
  looksStalled: boolean;
}

/**
 * A live run writes at least every 30 seconds, so silence past twice that is
 * a run that is no longer running. Matched to `pipelineResume`'s own window,
 * which is what actually asks the function to pick the run back up.
 */
export const QUIET_BEFORE_STALLED_MS = 2 * 60 * 1000;

const STEP_LABELS: Record<string, string> = {
  asr: "Transcribing the audio",
  analyze: "Analysing the transcript",
  finalize: "Saving the transcript",
  done: "Finishing up",
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Pull the pipeline's note out of a row's `engines_used`, or null when the
 * run predates progress reporting (or never started).
 */
export function readPipelineNote(enginesUsed: unknown): PipelineNote | null {
  if (!enginesUsed || typeof enginesUsed !== "object") return null;
  const pipeline = (enginesUsed as Record<string, unknown>).pipeline;
  if (!pipeline || typeof pipeline !== "object") return null;
  return pipeline as PipelineNote;
}

export function describePipelineProgress(
  enginesUsed: unknown,
  now: number = Date.now(),
): PipelineProgress | null {
  const note = readPipelineNote(enginesUsed);
  if (!note) return null;

  // The free-text note is the specific one ("waiting for the analysis (90s)");
  // the stage label is the fallback for a build that only wrote a stage.
  const stage = asString(note.stage);
  const step = asString(note.note) ?? (stage ? STEP_LABELS[stage] ?? stage : null) ?? "Working";

  const at = asString(note.at);
  const wroteAt = at ? Date.parse(at) : Number.NaN;
  const quietForMs = Number.isFinite(wroteAt) ? Math.max(0, now - wroteAt) : null;

  return {
    step,
    inline: (asString(note.hop) ?? "").startsWith("inline"),
    build: asString(note.build),
    quietForMs,
    looksStalled: quietForMs !== null && quietForMs > QUIET_BEFORE_STALLED_MS,
  };
}

/** "just now", "2m ago" — for the one line the banner has room for. */
export function describeQuietFor(quietForMs: number | null): string | null {
  if (quietForMs === null) return null;
  if (quietForMs < 60_000) return "just now";
  const minutes = Math.floor(quietForMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
