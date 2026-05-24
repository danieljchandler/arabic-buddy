import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";
import {
  buildSRSForecast,
  computeSRSRetentionRate,
  createEmptyStageBreakdown,
  getSRSStageByRepetitions,
  type SRSForecastPoint,
  type SRSStageBreakdown,
} from "@/lib/srsStats";

interface WordReviewSRSRow extends Pick<
  Database["public"]["Tables"]["word_reviews"]["Row"],
  "repetitions" | "next_review_at" | "interval_days" | "ease_factor"
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
>;

export interface SRSStats {
  totalDueNow: number;
  curriculumDue: number;
  myWordsDue: number;
  stageBreakdown: SRSStageBreakdown;
  forecast: SRSForecastPoint[];
  retentionRate: number;
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

      const [wordReviewsRes, userVocabularyRes] = await Promise.all([
        supabase
          .from("word_reviews")
          .select("repetitions, next_review_at, interval_days, ease_factor, lapses")
          .eq("user_id", user.id),
        supabase
          .from("user_vocabulary")
          .select("repetitions, next_review_at, production_next_review_at, production_repetitions, interval_days, production_interval_days, lapses, production_lapses")
          .eq("user_id", user.id),
      ]);

      if (wordReviewsRes.error) throw wordReviewsRes.error;
      if (userVocabularyRes.error) throw userVocabularyRes.error;

      const wordReviews = (wordReviewsRes.data ?? []) as WordReviewSRSRow[];
      const userVocabulary = (userVocabularyRes.data ?? []) as UserVocabularySRSRow[];

      const stageBreakdown = createEmptyStageBreakdown();
      const forecastDates: string[] = [];
      const retentionInputs: Array<{ repetitions: number; lapses: number }> = [];

      let curriculumDue = 0;
      let myWordsDue = 0;
      let curriculumCards = 0;
      let myWordsCards = 0;

      wordReviews.forEach((review) => {
        curriculumCards += 1;
        const repetitions = review.repetitions ?? 0;
        stageBreakdown[getSRSStageByRepetitions(repetitions)] += 1;
        retentionInputs.push({ repetitions, lapses: review.lapses ?? 0 });
        forecastDates.push(review.next_review_at);

        if (new Date(review.next_review_at) <= now) {
          curriculumDue += 1;
        }
      });

      userVocabulary.forEach((word) => {
        const recognitionRepetitions = word.repetitions ?? 0;
        myWordsCards += 1;
        stageBreakdown[getSRSStageByRepetitions(recognitionRepetitions)] += 1;
        retentionInputs.push({ repetitions: recognitionRepetitions, lapses: word.lapses ?? 0 });
        forecastDates.push(word.next_review_at);

        if (new Date(word.next_review_at) <= now) {
          myWordsDue += 1;
        }

        const hasProductionCard = !!word.production_next_review_at;
        if (hasProductionCard) {
          const productionRepetitions = word.production_repetitions ?? 0;
          myWordsCards += 1;
          stageBreakdown[getSRSStageByRepetitions(productionRepetitions)] += 1;
          retentionInputs.push({ repetitions: productionRepetitions, lapses: word.production_lapses ?? 0 });
          forecastDates.push(word.production_next_review_at);

          if (new Date(word.production_next_review_at as string) <= now) {
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
        totalCards: curriculumCards + myWordsCards,
        curriculumCards,
        myWordsCards,
      };
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
};
