import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveWeights, FSRS6_DEFAULT_WEIGHTS } from "@/lib/spacedRepetition";

export interface FsrsWeightsState {
  /** The learner's fitted FSRS-6 weights, or null when none are stored or the stored ones are unusable. */
  weights: readonly number[] | null;
  fittedAt: string | null;
  /** How many reviews the fit rested on. */
  reviews: number | null;
  isLoading: boolean;
}

export const FSRS_WEIGHTS_QUERY_KEY = "fsrs-weights";

/**
 * The learner's own FSRS-6 weights (profiles.fsrs_weights), clamped on read.
 *
 * Every scheduler call site reads this beside desired retention, so a fit
 * changes real intervals. `weights` is null — not the defaults — when nothing
 * usable is stored, so callers can tell "fitted" from "stock" (the calibration
 * multiplier steps aside for a fitted vector; see useFsrsCalibration). A
 * vector of the wrong length or with a bad entry is rejected whole by
 * resolveWeights, so a hand-edited row schedules on the defaults, never on a
 * half-trusted set. Signed-out learners and fetch failures get null — the
 * scheduler must never wait on, or break because of, a preference read.
 */
export function useFsrsWeights(): FsrsWeightsState {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: [FSRS_WEIGHTS_QUERY_KEY, user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Omit<FsrsWeightsState, "isLoading">> => {
      const none = { weights: null, fittedAt: null, reviews: null };
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("fsrs_weights, fsrs_weights_fitted_at, fsrs_weights_reviews")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error || !profile) return none;
      const raw = profile.fsrs_weights;
      const candidate = Array.isArray(raw) ? (raw as unknown[]).map((v) => (typeof v === "number" ? v : Number.NaN)) : null;
      const resolved = candidate ? resolveWeights(candidate) : FSRS6_DEFAULT_WEIGHTS;
      // resolveWeights hands back the defaults for anything unusable; only a
      // vector it returned *as given* counts as fitted.
      const weights = candidate && resolved === candidate ? candidate : null;
      return {
        weights,
        fittedAt: weights ? profile.fsrs_weights_fitted_at ?? null : null,
        reviews: weights ? profile.fsrs_weights_reviews ?? null : null,
      };
    },
  });
  return {
    weights: data?.weights ?? null,
    fittedAt: data?.fittedAt ?? null,
    reviews: data?.reviews ?? null,
    isLoading: !!user && isLoading,
  };
}
