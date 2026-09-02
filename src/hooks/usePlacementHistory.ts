import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";

export interface PlacementRow {
  id: string;
  cefr_level: string;
  confidence: number | null;
  reviews_at_time: number | null;
  taken_at: string;
}

/** Days after a placement before a re-check is worth asking for. */
export const REPLACEMENT_AFTER_DAYS = 90;
/** Rated reviews since the last placement before a re-check is worth asking for. */
export const REPLACEMENT_AFTER_REVIEWS = 300;

export const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const cefrOrdinal = (level: string): number => Math.max(0, CEFR_ORDER.indexOf(level as (typeof CEFR_ORDER)[number]));

export interface PlacementHistoryState {
  history: PlacementRow[];
  latest: PlacementRow | null;
  /** Rated reviews logged since the latest placement (0 when none). */
  reviewsSinceLatest: number;
  /** Old enough, and enough practice since, for a re-check to say something new. */
  replacementDue: boolean;
  isLoading: boolean;
}

/**
 * The learner's placements in the active dialect, oldest first, and whether
 * it is time to take the quiz again.
 *
 * Placement used to happen once and never be revisited (product audit C4).
 * A re-check is offered only when both clocks have moved — time *and*
 * practice — because a level retaken after a quiet quarter measures the
 * quiet quarter, not the learning.
 */
export function usePlacementHistory(now: Date = new Date()): PlacementHistoryState {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  const history = useQuery({
    queryKey: ["placement-history", user?.id, activeDialect],
    enabled: !!user,
    queryFn: async (): Promise<PlacementRow[]> => {
      const { data, error } = await supabase
        .from("placement_results")
        .select("id, cefr_level, confidence, reviews_at_time, taken_at")
        .eq("user_id", user!.id)
        .eq("dialect", activeDialect)
        .order("taken_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlacementRow[];
    },
  });

  const latest = history.data && history.data.length > 0 ? history.data[history.data.length - 1] : null;

  const since = useQuery({
    queryKey: ["reviews-since", user?.id, latest?.taken_at ?? null],
    enabled: !!user && !!latest,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("review_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .not("rating", "is", null)
        .gte("reviewed_at", latest!.taken_at);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const reviewsSinceLatest = since.data ?? 0;
  const ageDays = latest ? (now.getTime() - Date.parse(latest.taken_at)) / 86_400_000 : 0;
  const replacementDue = !!latest && ageDays >= REPLACEMENT_AFTER_DAYS && reviewsSinceLatest >= REPLACEMENT_AFTER_REVIEWS;

  return {
    history: history.data ?? [],
    latest,
    reviewsSinceLatest,
    replacementDue,
    isLoading: !!user && (history.isLoading || (!!latest && since.isLoading)),
  };
}
