import { getThumbnailCandidates, type ThumbnailSources } from "@/lib/videoEmbed";
import { isEphemeralThumbnailUrl } from "../../supabase/functions/_shared/thumbnailUrlCore";

/** The columns a backfill needs off a video row. */
export interface BackfillableVideo extends ThumbnailSources {
  id: string;
  title: string;
  platform?: string | null;
  thumbnail_url?: string | null;
}

/**
 * Videos showing no picture, or about to stop showing one.
 *
 * Two separate faults, one list. A row with nothing to render has been blank
 * since it was created. A row holding a *signed* still — TikTok's oEmbed hands
 * back a URL with about forty-eight hours on it — renders for two days and
 * then goes blank, which is why thumbnails kept "dropping out" after being
 * added. Both are fixed the same way, by asking the server for one and keeping
 * a copy of our own, so both belong on the same button.
 */
export function needsThumbnail(video: BackfillableVideo): boolean {
  if (isEphemeralThumbnailUrl(video.thumbnail_url)) return true;
  return getThumbnailCandidates(video.thumbnail_url, video).length === 0;
}

export type ThumbnailOutcome =
  /** Worked out from the row's own URL — no network, always available. */
  | { status: "derived"; thumbnailUrl: string }
  /** The server found one, copied it somewhere permanent, and stored it. */
  | { status: "refreshed"; thumbnailUrl: string }
  /** Nothing to do; the row already has one that will not expire. */
  | { status: "present" }
  /** Nothing can be done without a human. */
  | { status: "unavailable"; reason: string };

export interface BackfillReport {
  filled: number;
  alreadyHad: number;
  /** Rows a still could not be found for, and why — this is the to-do list. */
  unresolved: Array<{ id: string; title: string; reason: string }>;
  /** Rows that resolved but whose write failed. */
  failedToSave: Array<{ id: string; title: string; reason: string }>;
}

/** What the server answers when asked to give one video a durable still. */
export interface RefreshResult {
  thumbnailUrl?: string | null;
  error?: string | null;
}

export interface ResolveDeps {
  /**
   * Ask the server for a still and have it stored.
   *
   * Not something the browser can do itself: the platform CDNs serve their
   * stills without `Access-Control-Allow-Origin`, so a page can display those
   * bytes but cannot read them to keep a copy — and a copy is the whole point,
   * since the URL they hand out expires. The edge function holds the service
   * role, does the copy, and writes the row, so what comes back here is
   * already saved.
   */
  refresh: (videoId: string) => Promise<RefreshResult>;
}

/**
 * Find a still for one video that has none, or a lasting one for a video whose
 * still is on loan.
 *
 * The order matters: deriving from the row's own URL is free and cannot fail,
 * so it is tried first and covers every YouTube video. Only what is left over
 * costs a network call.
 */
export async function resolveThumbnail(
  video: BackfillableVideo,
  { refresh }: ResolveDeps,
): Promise<ThumbnailOutcome> {
  // An expiring still counts as missing: it is the reason this row is here.
  if (video.thumbnail_url && !isEphemeralThumbnailUrl(video.thumbnail_url)) {
    return { status: "present" };
  }

  const [derived] = getThumbnailCandidates(null, video);
  if (derived) return { status: "derived", thumbnailUrl: derived };

  if (!video.source_url) {
    return { status: "unavailable", reason: "no source URL to work from" };
  }

  const result = await refresh(video.id);
  if (result.thumbnailUrl) return { status: "refreshed", thumbnailUrl: result.thumbnailUrl };
  return { status: "unavailable", reason: result.error || "no thumbnail could be found" };
}

interface BackfillDeps extends ResolveDeps {
  /** Writes one thumbnail back, rejecting or returning an error message. */
  save: (id: string, thumbnailUrl: string) => Promise<{ error?: string | null } | void>;
  /** Called after each row so a long run can show progress. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Walk a list of videos, find a still for each one that needs one, and save it.
 *
 * Sequential on purpose: this runs from an admin's browser and each refresh is
 * a platform call the server makes on our behalf. A burst of parallel requests
 * to a public oEmbed endpoint is the shape of traffic that gets rate-limited.
 * The list is a few hundred rows at worst.
 */
export async function backfillThumbnails(
  videos: BackfillableVideo[],
  { save, onProgress, ...resolveDeps }: BackfillDeps,
): Promise<BackfillReport> {
  const report: BackfillReport = { filled: 0, alreadyHad: 0, unresolved: [], failedToSave: [] };

  for (const [index, video] of videos.entries()) {
    const outcome = await resolveThumbnail(video, resolveDeps);

    if (outcome.status === "present") {
      report.alreadyHad += 1;
    } else if (outcome.status === "unavailable") {
      report.unresolved.push({ id: video.id, title: video.title, reason: outcome.reason });
    } else if (outcome.status === "refreshed") {
      // Already written, by the function that made the copy. Writing it again
      // from here would be a second round trip to say the same thing.
      report.filled += 1;
    } else {
      try {
        const result = await save(video.id, outcome.thumbnailUrl);
        if (result && result.error) throw new Error(result.error);
        report.filled += 1;
      } catch (error) {
        report.failedToSave.push({
          id: video.id,
          title: video.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    onProgress?.(index + 1, videos.length);
  }

  return report;
}
