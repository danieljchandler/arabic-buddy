import { EDGE_BUILD } from "../../supabase/functions/_shared/edgeBuild";

/**
 * Whether the deployed edge functions match the app that is talking to them.
 *
 * The frontend redeploys on merge; the edge functions do not. On Lovable Cloud
 * the Supabase project is managed, so there is no access token to hand CI and
 * deploying stays a separate manual step. The two halves can therefore
 * disagree for as long as nobody notices — and "nobody notices" is the
 * expensive part. A transcription bug was chased through three rounds of
 * "still broken" against a backend still serving the previous copy of the fix.
 *
 * `EDGE_BUILD` is compiled into both halves from one file, so comparing what a
 * function reports against what this bundle was built with answers the
 * question outright, rather than leaving it to be inferred from symptoms.
 */

/** What this build of the app expects the backend to be running. */
export { EDGE_BUILD };

export type EdgeBuildState =
  /** The deployed functions match this app. */
  | "current"
  /** The functions are running an older build than this app was built from. */
  | "stale"
  /**
   * The function did not report a build at all — an older deployment, from
   * before it knew how to answer. Stale by definition: the marker is the
   * newer thing.
   */
  | "unknown"
  /** The probe could not be made — offline, refused, or not a content manager. */
  | "unreachable";

export interface EdgeBuildStatus {
  state: EdgeBuildState;
  /** What the backend says it is running, when it said anything. */
  deployed: string | null;
  /** What this app was built expecting. */
  expected: string;
  /** Whether an admin should be told to deploy. */
  needsDeploy: boolean;
}

/**
 * Compare a probe reply against this bundle.
 *
 * `reply` is whatever `process-approved-video` answered to `{ probe: true }`,
 * or null when the call failed.
 */
export function readEdgeBuildStatus(
  reply: { build?: unknown } | null,
  expected: string = EDGE_BUILD,
): EdgeBuildStatus {
  if (reply === null) {
    // Unreachable is not the same as stale, and must not be reported as it:
    // a network blip would otherwise tell an admin to redeploy a backend that
    // is perfectly current.
    return { state: "unreachable", deployed: null, expected, needsDeploy: false };
  }

  const deployed = typeof reply.build === "string" && reply.build.trim() ? reply.build.trim() : null;
  if (deployed === null) {
    return { state: "unknown", deployed: null, expected, needsDeploy: true };
  }
  if (deployed === expected) {
    return { state: "current", deployed, expected, needsDeploy: false };
  }
  return { state: "stale", deployed, expected, needsDeploy: true };
}

/**
 * What to tell an admin who cannot deploy Supabase themselves.
 *
 * The names are the point: "redeploy the edge functions" is not actionable
 * when there are 119 of them and the person reading it has to ask someone
 * else to do it.
 */
export function deployInstruction(functions: readonly string[]): string {
  const names = functions.join(" and ");
  return `Ask Lovable to deploy ${names}. Merging does not deploy them.`;
}

/** The functions the transcription pipeline needs deployed together. */
export const PIPELINE_FUNCTIONS = ["process-approved-video", "analyze-gulf-arabic"] as const;
