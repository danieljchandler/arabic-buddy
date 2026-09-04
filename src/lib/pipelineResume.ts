/**
 * When a video's transcription run should be nudged back to life.
 *
 * The pipeline behind Approve runs as a chain of edge-function requests, each
 * checkpointing before it hands over (see `process-approved-video`). The
 * platform can still tear a worker down mid-stage with no error raised, and
 * when that happens nothing is left running to send the next request. The
 * server-side reaper only *fails* such a row, twelve minutes later. The admin
 * pages that poll a mid-run row are better placed: they can see the row has
 * stopped moving and ask the function to continue from its checkpoint —
 * `{ videoId, resume: true }` — which costs nothing when the run is merely
 * slow (the function answers "already running" and does nothing).
 *
 * Pure decision here; the hook that acts on it is `usePipelineResume`.
 */

export interface ResumeCandidate {
  id: string;
  transcription_status?: string | null;
  updated_at?: string | null;
}

/**
 * How long a row may sit still before its run is assumed dead, by status.
 *
 * A live run touches the row at least every 30s (each stage writes to it, and
 * the analysis wait heartbeats), so two minutes of silence on `processing` is
 * a dead worker, not a slow engine. `analysis_complete` should be picked up
 * within seconds by whichever of the pipeline's poll and the analysis's own
 * callback gets there first. `pending` is deliberately patient: the admin form
 * holds a row on pending for as long as it takes to extract, upload and read
 * the frames of a large file, and a nudge in the middle of that would start a
 * second run on top of the real one.
 */
export const STALE_AFTER_MS: Record<string, number> = {
  processing: 2 * 60 * 1000,
  analysis_complete: 45 * 1000,
  pending: 10 * 60 * 1000,
};

/** Give a nudged run this long to show signs of life before nudging again. */
export const NUDGE_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * Past this a row is not mid-run in any meaningful sense — a run that old was
 * failed by the reaper long ago, or the reaper is not running and the row is a
 * relic. The stale controls on the edit page are the way back in for those.
 */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Whether to ask the pipeline to resume `video` now.
 *
 * `lastNudgedAt` is when this client last asked for this video, or null.
 */
export function shouldResumePipeline(
  video: ResumeCandidate,
  now: number,
  lastNudgedAt: number | null,
): boolean {
  const status = video.transcription_status ?? "";
  const staleAfter = STALE_AFTER_MS[status];
  if (staleAfter === undefined) return false;

  const updatedAt = video.updated_at ? Date.parse(video.updated_at) : Number.NaN;
  if (!Number.isFinite(updatedAt)) return false;

  const idleFor = now - updatedAt;
  if (idleFor < staleAfter || idleFor > GIVE_UP_AFTER_MS) return false;

  if (lastNudgedAt !== null && now - lastNudgedAt < NUDGE_COOLDOWN_MS) return false;
  return true;
}
