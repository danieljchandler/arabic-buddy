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

  // retentionRate is a 0–100 integer for display; the curve wants 0..1.
  const observed = stats ? stats.retentionRate / 100 : undefined;
  return calibrationMultiplier(observed, desiredRetention, stats?.reviewedCount ?? 0);
}
