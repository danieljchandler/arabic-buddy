import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useAuth } from "@/hooks/useAuth";
import { FSRS_WEIGHTS_QUERY_KEY } from "@/hooks/useFsrsWeights";
import { fitFromLog, MIN_REVIEWS_TO_FIT, type FitResult, type ReviewLogRow } from "@/lib/fsrsFit";

/**
 * Fit this learner's FSRS-6 weights from their review_log, on their own
 * device, and keep the result only if it beats the stock weights on history
 * it was not trained on (fsrsFit.fitFromLog).
 *
 * The log is owner-readable and trigger-written, so the fit rests on rows
 * the learner could not have authored. Nothing leaves the browser but the
 * 21 numbers that won.
 */
export interface FsrsFitState {
  /** Rated reviews in the log — what a fit would rest on. */
  reviewCount: number | null;
  eligible: boolean;
  isCounting: boolean;
  isFitting: boolean;
  result: FitResult | null;
  error: string | null;
  fit: () => Promise<FitResult | null>;
}

const REVIEW_LOG_SELECT = "deck, card_id, direction, rating, reviewed_at";

export function useFsrsFit(): FsrsFitState {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isFitting, setIsFitting] = useState(false);
  const [result, setResult] = useState<FitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = useQuery({
    queryKey: ["review-log-count", user?.id],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { count: n, error: e } = await supabase
        .from("review_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .not("rating", "is", null);
      if (e) throw e;
      return n ?? 0;
    },
  });

  const fit = useCallback(async (): Promise<FitResult | null> => {
    if (!user) return null;
    setIsFitting(true);
    setError(null);
    try {
      const rows = await fetchAllRows<ReviewLogRow>((from, to) =>
        supabase
          .from("review_log")
          .select(REVIEW_LOG_SELECT)
          .eq("user_id", user.id)
          .order("reviewed_at", { ascending: true })
          .range(from, to),
      );
      const outcome = fitFromLog(rows);
      if (outcome.status === "fitted" && outcome.weights) {
        const { error: e } = await supabase
          .from("profiles")
          .update({
            fsrs_weights: outcome.weights,
            fsrs_weights_fitted_at: new Date().toISOString(),
            fsrs_weights_reviews: outcome.reviews,
          })
          .eq("user_id", user.id);
        if (e) throw e;
        await qc.invalidateQueries({ queryKey: [FSRS_WEIGHTS_QUERY_KEY] });
      }
      setResult(outcome);
      return outcome;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fit");
      return null;
    } finally {
      setIsFitting(false);
    }
  }, [user, qc]);

  const reviewCount = count.data ?? null;
  return {
    reviewCount,
    eligible: (reviewCount ?? 0) >= MIN_REVIEWS_TO_FIT,
    isCounting: !!user && count.isLoading,
    isFitting,
    result,
    error,
    fit,
  };
}
