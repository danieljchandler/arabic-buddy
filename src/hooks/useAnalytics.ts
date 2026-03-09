import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AnalyticsData {
  totalWords: number;
  masteredWords: number;
  learningWords: number;
  newWords: number;
  totalReviews: number;
  accuracy: number;
  currentStreak: number;
  longestStreak: number;
  totalXP: number;
  level: number;
  stageBreakdown: { stage: string; count: number }[];
  dailyActivity: { date: string; reviews: number }[];
  challengeStreak: number;
  challengesCompleted: number;
}

const STAGE_ORDER = ["NEW", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5"];
const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  STAGE_1: "Learning",
  STAGE_2: "Familiar",
  STAGE_3: "Practiced",
  STAGE_4: "Strong",
  STAGE_5: "Mastered",
};

export function useLearningAnalytics() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["learning-analytics", user?.id],
    queryFn: async (): Promise<AnalyticsData> => {
      if (!user) throw new Error("Not authenticated");

      // Fetch all data in parallel
      const [
        wordReviewsRes,
        userVocabRes,
        streakRes,
        xpRes,
        challengeRes,
      ] = await Promise.all([
        supabase
          .from("word_reviews")
          .select("stage, review_count, correct_count, last_reviewed_at")
          .eq("user_id", user.id),
        supabase
          .from("user_vocabulary")
          .select("stage, review_count, correct_count, last_reviewed_at")
          .eq("user_id", user.id),
        supabase
          .from("review_streaks")
          .select("current_streak, longest_streak")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("user_xp")
          .select("total_xp, level")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("daily_challenge_completions" as any)
          .select("challenge_date, score, max_score")
          .eq("user_id", user.id)
          .order("challenge_date", { ascending: false }),
      ]);

      // Combine word_reviews + user_vocabulary
      const allWords = [
        ...(wordReviewsRes.data || []),
        ...(userVocabRes.data || []),
      ];

      const totalWords = allWords.length;
      const totalReviews = allWords.reduce((sum, w) => sum + (w.review_count || 0), 0);
      const totalCorrect = allWords.reduce((sum, w) => sum + (w.correct_count || 0), 0);
      const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;

      // Stage breakdown
      const stageCounts: Record<string, number> = {};
      STAGE_ORDER.forEach((s) => (stageCounts[s] = 0));
      allWords.forEach((w) => {
        const stage = w.stage || "NEW";
        if (stageCounts[stage] !== undefined) {
          stageCounts[stage]++;
        } else {
          stageCounts["NEW"]++;
        }
      });

      const stageBreakdown = STAGE_ORDER.map((stage) => ({
        stage: STAGE_LABELS[stage] || stage,
        count: stageCounts[stage] || 0,
      }));

      const masteredWords = stageCounts["STAGE_5"] || 0;
      const newWords = stageCounts["NEW"] || 0;
      const learningWords = totalWords - masteredWords - newWords;

      // Daily activity (last 14 days)
      const dailyMap: Record<string, number> = {};
      const today = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dailyMap[d.toISOString().split("T")[0]] = 0;
      }

      allWords.forEach((w) => {
        if (w.last_reviewed_at) {
          const dateStr = new Date(w.last_reviewed_at).toISOString().split("T")[0];
          if (dailyMap[dateStr] !== undefined) {
            dailyMap[dateStr]++;
          }
        }
      });

      const dailyActivity = Object.entries(dailyMap).map(([date, reviews]) => ({
        date,
        reviews,
      }));

      // Challenge stats
      const challenges = (challengeRes.data as any[]) || [];

      return {
        totalWords,
        masteredWords,
        learningWords,
        newWords,
        totalReviews,
        accuracy,
        currentStreak: streakRes.data?.current_streak || 0,
        longestStreak: streakRes.data?.longest_streak || 0,
        totalXP: xpRes.data?.total_xp || 0,
        level: xpRes.data?.level || 1,
        stageBreakdown,
        dailyActivity,
        challengeStreak: 0,
        challengesCompleted: challenges.length,
      };
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

export { STAGE_LABELS };
