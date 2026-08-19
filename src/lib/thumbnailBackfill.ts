import { getThumbnailCandidates, type ThumbnailSources } from "@/lib/videoEmbed";

/** The columns a backfill needs off a video row. */
export interface BackfillableVideo extends ThumbnailSources {
  id: string;
  title: string;
  platform?: string | null;
  thumbnail_url?: string | null;
}

export type ThumbnailOutcome =
  /** Worked out from the row's own URL — no network, always available. */
  | { status: "derived"; thumbnailUrl: string }
  /** Asked the platform for it. */
  | { status: "fetched"; thumbnailUrl: string }
  /** Nothing to do; the row already has one. */
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

/**
 * TikTok's oEmbed, which is public, unauthenticated and CORS-open — the same
 * call the video form makes when an admin presses "Fetch thumbnail".
 *
 * Instagram has an oEmbed too, but it needs a Facebook app token, so there is
 * no equivalent here and Instagram rows come back `unavailable`.
 */
export async function fetchTikTokThumbnail(sourceUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.thumbnail_url === "string" && data.thumbnail_url ? data.thumbnail_url : null;
  } catch {
    // A deleted or private video 404s, and the network can simply fail. Either
    // way this row is one for the report, not for an exception.
    return null;
  }
}

interface ResolveDeps {
  fetchTikTok?: (sourceUrl: string) => Promise<string | null>;
}

/**
 * Find a still for one video that has none.
 *
 * The order matters: deriving from the row's own URL is free and cannot fail,
 * so it is tried first and covers every YouTube video. Only what is left over
 * costs a network call.
 */
export async function resolveThumbnail(
  video: BackfillableVideo,
  { fetchTikTok = fetchTikTokThumbnail }: ResolveDeps = {},
): Promise<ThumbnailOutcome> {
  if (video.thumbnail_url) return { status: "present" };

  const [derived] = getThumbnailCandidates(null, video);
  if (derived) return { status: "derived", thumbnailUrl: derived };

  const sourceUrl = video.source_url;
  if (!sourceUrl) {
    return { status: "unavailable", reason: "no source URL to work from" };
  }

  if (video.platform === "tiktok" || sourceUrl.includes("tiktok.com")) {
    const fetched = await fetchTikTok(sourceUrl);
    return fetched
      ? { status: "fetched", thumbnailUrl: fetched }
      : { status: "unavailable", reason: "TikTok returned no thumbnail — the video may be private or gone" };
  }

  return {
    status: "unavailable",
    // The honest answer for Instagram, and for anything else that turns up:
    // the still has to come off the video itself, which is the upload path the
    // video form already has.
    reason: `no public thumbnail for ${video.platform || "this platform"} — upload the video file and capture a frame`,
  };
}

interface BackfillDeps extends ResolveDeps {
  /** Writes one thumbnail back, rejecting or returning an error message. */
  save: (id: string, thumbnailUrl: string) => Promise<{ error?: string | null } | void>;
  /** Called after each row so a long run can show progress. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Walk a list of videos, find a still for each one that has none, and save it.
 *
 * Sequential on purpose: this runs from an admin's browser against a public
 * oEmbed endpoint, and a burst of parallel requests to TikTok is the shape of
 * traffic that gets rate-limited. The list is a few hundred rows at worst.
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
