import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";
import {
  buildSRSForecast,
  computeSRSRetentionRate,
  createEmptyStageBreakdown,
  getSRSStageByStability,
  type SRSForecastPoint,
  type SRSStageBreakdown,
} from "@/lib/srsStats";

interface WordReviewSRSRow extends Pick<
  Database["public"]["Tables"]["word_reviews"]["Row"],
  "repetitions" | "next_review_at" | "interval_days" | "ease_factor" | "last_reviewed_at"
> {
  lapses?: number | null;
}

type UserVocabularySRSRow = Pick<
  Database["public"]["Tables"]["user_vocabulary"]["Row"],
  | "repetitions"
  | "next_review_at"
  | "production_next_review_at"
  | "production_repetitions"
  | "interval_days"
  | "production_interval_days"
  | "lapses"
  | "production_lapses"
  | "ease_factor"
  | "production_ease_factor"
  | "last_reviewed_at"
  | "production_last_reviewed_at"
>;

/**
 * How far back a card's activity counts toward the *calibration* measure.
 * The all-time figure never forgets: a learner who lapsed heavily as a
 * beginner kept compressed intervals long after their memory improved. Sixty
 * days of recently-touched cards approximates "recall as it is now" without
 * a new event table.
 */
export const CALIBRATION_WINDOW_DAYS = 60;

export interface SRSStats {
  totalDueNow: number;
  curriculumDue: number;
  myWordsDue: number;
  stageBreakdown: SRSStageBreakdown;
  forecast: SRSForecastPoint[];
  retentionRate: number;
  /**
   * Successful reviews behind `retentionRate`, summed over every card. It is
   * the sample size that measurement rests on, which decides how far the FSRS
   * calibration is allowed to move (see calibrationMultiplier).
   */
  reviewedCount: number;
  /**
   * `retentionRate` restricted to cards touched in the last
   * CALIBRATION_WINDOW_DAYS — what the FSRS calibration actually reads, so a
   * rough first month stops compressing intervals forever. The all-time
   * figure stays for display.
   */
  recentRetentionRate: number;
  /** Sample size behind `recentRetentionRate`. */
  recentReviewedCount: number;
  totalCards: number;
  curriculumCards: number;
  myWordsCards: number;
}

const getDefaultStats = (): SRSStats => ({
  totalDueNow: 0,
  curriculumDue: 0,
  myWordsDue: 0,
  stageBreakdown: createEmptyStageBreakdown(),
  forecast: buildSRSForecast([]),
  retentionRate: 0,
  reviewedCount: 0,
  recentRetentionRate: 0,
  recentReviewedCount: 0,
  totalCards: 0,
  curriculumCards: 0,
  myWordsCards: 0,
});

export const useSRSStats = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["srs-stats", user?.id],
    queryFn: async (): Promise<SRSStats> => {
      if (!user) return getDefaultStats();

      const now = new Date();

      // Paged, not unbounded. PostgREST returns the first 1000 rows of an
      // unbounded select with no error, so every number on this screen — due
      // now, retention, the forecast, the card totals — silently truncated for
      // exactly the learners who have studied most. The retention half is
      // worse than cosmetic: useFsrsCalibration reads it and scales real
      // review intervals by it.
      const [wordReviews, userVocabulary] = await Promise.all([
        fetchAllRows<WordReviewSRSRow>((from, to) =>
          supabase
            .from("word_reviews")
            .select("repetitions, next_review_at, interval_days, ease_factor, lapses, last_reviewed_at")
            .eq("user_id", user.id)
            .range(from, to),
        ),
        fetchAllRows<UserVocabularySRSRow>((from, to) =>
          supabase
            .from("user_vocabulary")
            .select("repetitions, next_review_at, production_next_review_at, production_repetitions, interval_days, production_interval_days, lapses, production_lapses, ease_factor, production_ease_factor, last_reviewed_at, production_last_reviewed_at")
            .eq("user_id", user.id)
            .range(from, to),
        ),
      ]);

      const stageBreakdown = createEmptyStageBreakdown();
      const forecastDates: string[] = [];
      const retentionInputs: Array<{ repetitions: number; lapses: number }> = [];
      // The calibration window's subset — see CALIBRATION_WINDOW_DAYS.
      const recentInputs: Array<{ repetitions: number; lapses: number }> = [];
      const recentCutoffMs = now.getTime() - CALIBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const isRecent = (lastReviewedAt: string | null | undefined) =>
        !!lastReviewedAt && new Date(lastReviewedAt).getTime() >= recentCutoffMs;

      let curriculumDue = 0;
      let myWordsDue = 0;
      let curriculumCards = 0;
      let myWordsCards = 0;

      wordReviews.forEach((review) => {
        curriculumCards += 1;
        const repetitions = review.repetitions ?? 0;
        stageBreakdown[getSRSStageByStability(repetitions, review.ease_factor ?? 0)] += 1;
        retentionInputs.push({ repetitions, lapses: review.lapses ?? 0 });
        if (isRecent(review.last_reviewed_at)) {
          recentInputs.push({ repetitions, lapses: review.lapses ?? 0 });
        }
        forecastDates.push(review.next_review_at);

        if (new Date(review.next_review_at) <= now) {
          curriculumDue += 1;
        }
      });

      userVocabulary.forEach((word) => {
        const recognitionRepetitions = word.repetitions ?? 0;
        myWordsCards += 1;
        stageBreakdown[getSRSStageByStability(recognitionRepetitions, word.ease_factor ?? 0)] += 1;
        retentionInputs.push({ repetitions: recognitionRepetitions, lapses: word.lapses ?? 0 });
        if (isRecent(word.last_reviewed_at)) {
          recentInputs.push({ repetitions: recognitionRepetitions, lapses: word.lapses ?? 0 });
        }
        forecastDates.push(word.next_review_at);

        if (new Date(word.next_review_at) <= now) {
          myWordsDue += 1;
        }

        // Narrow the timestamp itself rather than a separate boolean, so the
        // non-null value flows through (this previously needed an `as string`).
        const productionDueAt = word.production_next_review_at;
        if (productionDueAt) {
          const productionRepetitions = word.production_repetitions ?? 0;
          myWordsCards += 1;
          stageBreakdown[getSRSStageByStability(productionRepetitions, word.production_ease_factor ?? 0)] += 1;
          retentionInputs.push({ repetitions: productionRepetitions, lapses: word.production_lapses ?? 0 });
          if (isRecent(word.production_last_reviewed_at)) {
            recentInputs.push({ repetitions: productionRepetitions, lapses: word.production_lapses ?? 0 });
          }
          forecastDates.push(productionDueAt);

          if (new Date(productionDueAt) <= now) {
            myWordsDue += 1;
          }
        }
      });

      const totalDueNow = curriculumDue + myWordsDue;

      return {
        totalDueNow,
        curriculumDue,
        myWordsDue,
        stageBreakdown,
        forecast: buildSRSForecast(forecastDates, now),
        retentionRate: computeSRSRetentionRate(retentionInputs),
        reviewedCount: retentionInputs.reduce(
          (sum, r) => sum + Math.max(0, r.repetitions),
          0,
        ),
        recentRetentionRate: computeSRSRetentionRate(recentInputs),
        recentReviewedCount: recentInputs.reduce(
          (sum, r) => sum + Math.max(0, r.repetitions),
          0,
        ),
        totalCards: curriculumCards + myWordsCards,
        curriculumCards,
        myWordsCards,
      };
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
};
