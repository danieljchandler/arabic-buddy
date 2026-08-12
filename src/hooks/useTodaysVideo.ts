import { useMemo } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useUserLevel } from "./useUserLevel";
import { useDiscoverVideos, difficultyWindow, type DiscoverVideo } from "./useDiscoverVideos";

/**
 * The one clip the home page leads with.
 *
 * Watching native video is the thing this app is for, so the home page opens
 * with a single clip rather than a browse list — one decision, already made for
 * the learner. Three rules shape which clip that is:
 *
 * 1. It is dialect-first. A Gulf learner gets Gulf.
 * 2. It is never empty when the library is not. A dialect we have not filmed
 *    much of yet, or a level window with nothing in it, must not blank the
 *    card — the learner would just see a home page with no video on it and
 *    conclude the feature does not exist. Each filter falls back to the wider
 *    pool instead of returning nothing.
 * 3. It rotates daily. "Today's video" that is the same video all week is not
 *    today's anything; the pick is keyed to the local date so it changes at
 *    midnight and stays put across reloads within a day.
 */

/**
 * Days since the epoch in *local* time.
 *
 * Local rather than UTC to match `lib/todayCompletion`, which keys completions
 * by the local date — a UTC day boundary would roll the pick over while the
 * "watched today" tick was still set from the evening before.
 */
function localDayIndex(now: Date = new Date()): number {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return Math.floor(local.getTime() / 86_400_000);
}

const sameDifficulty = (a: string | null | undefined, b: string) =>
  (a ?? "").toLowerCase() === b.toLowerCase();

export interface TodaysVideo {
  /** The clip to lead with, or null when the library has nothing published. */
  video: DiscoverVideo | null;
  /** True when the active dialect had nothing and this came from another one. */
  isFromAnotherDialect: boolean;
  isLoading: boolean;
}

export function useTodaysVideo(): TodaysVideo {
  const { activeDialect } = useDialect();
  const { placementLevel } = useUserLevel();

  const inDialect = useDiscoverVideos({ dialect: activeDialect });
  const dialectIsEmpty = inDialect.isSuccess && (inDialect.data?.length ?? 0) === 0;
  // Only asked for once the dialect-scoped read has come back empty, so the
  // common case stays a single request.
  const anyDialect = useDiscoverVideos(undefined, { enabled: dialectIsEmpty });

  const pool = useMemo(
    () => (inDialect.data?.length ? inDialect.data : (anyDialect.data ?? [])),
    [inDialect.data, anyDialect.data],
  );

  const video = useMemo(() => {
    if (pool.length === 0) return null;

    // Difficulty is written by hand in a few places and arrives in both cases,
    // so it is compared case-insensitively rather than filtered server-side —
    // an `in.()` on "Beginner" silently drops every row stored as "beginner",
    // which reads as an empty library.
    const window = difficultyWindow(placementLevel);
    const atLevel = window
      ? pool.filter((v) => window.some((d) => sameDifficulty(v.difficulty, d)))
      : pool;
    const candidates = atLevel.length > 0 ? atLevel : pool;

    return candidates[localDayIndex() % candidates.length];
  }, [pool, placementLevel]);

  return {
    video,
    isFromAnotherDialect: !!video && video.dialect !== activeDialect,
    isLoading: inDialect.isLoading || (dialectIsEmpty && anyDialect.isLoading),
  };
}
