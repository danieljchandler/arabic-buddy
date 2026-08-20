import { useSRSStats } from "@/hooks/useSRSStats";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { calibrationMultiplier } from "@/lib/spacedRepetition";

/**
 * The learner's own FSRS interval correction.
 *
 * Everything it needs is already in the react-query cache — `useSRSStats`
 * measures recall from the same `repetitions`/`lapses` the review screen
 * writes — so this costs no network and no new storage. It returns exactly 1
 * until the learner has reviewed enough for the measurement to mean anything,
 * which is the whole population on day one.
 */
export function useFsrsCalibration(): number {
  const { data: stats } = useSRSStats();
  const desiredRetention = useDesiredRetention();

  // The windowed measure, not the lifetime one: all-time retention never
  // forgets, so a learner who lapsed heavily as a beginner kept compressed
  // intervals long after their memory improved. Cards untouched for
  // CALIBRATION_WINDOW_DAYS drop out of the sample (and the shrinkage inside
  // calibrationMultiplier already handles the smaller count conservatively).
  // The rate is a 0–100 integer for display; the curve wants 0..1.
  const observed = stats ? stats.recentRetentionRate / 100 : undefined;
  return calibrationMultiplier(observed, desiredRetention, stats?.recentReviewedCount ?? 0);
}
