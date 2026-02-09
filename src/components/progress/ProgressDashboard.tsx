import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Stage, STAGE_LABELS, STAGE_COLORS, STAGE_ORDER } from "@/lib/stageRepetition";
import { Flame, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressData {
  stageCounts: Record<Stage, number>;
  totalReviewed: number;
  totalCorrect: number;
  streak: number;
  longestStreak: number;
}

function useProgressStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['progress-stats', user?.id],
    queryFn: async (): Promise<ProgressData | null> => {
      if (!user) return null;

      const stageCounts: Record<Stage, number> = {
        NEW: 0, STAGE_1: 0, STAGE_2: 0, STAGE_3: 0, STAGE_4: 0, STAGE_5: 0,
      };

      // Count curriculum word stages
      const { data: reviews } = await supabase
        .from('word_reviews')
        .select('stage, review_count, correct_count')
        .eq('user_id', user.id);

      let totalReviewed = 0;
      let totalCorrect = 0;

      for (const r of (reviews || [])) {
        const stage = ((r as any).stage as Stage) || 'NEW';
        if (stageCounts[stage] !== undefined) stageCounts[stage]++;
        totalReviewed += (r as any).review_count || 0;
        totalCorrect += (r as any).correct_count || 0;
      }

      // Count user vocabulary stages
      const { data: userWords } = await supabase
        .from('user_vocabulary')
        .select('stage, review_count, correct_count')
        .eq('user_id', user.id);

      for (const w of (userWords || [])) {
        const stage = ((w as any).stage as Stage) || 'NEW';
        if (stageCounts[stage] !== undefined) stageCounts[stage]++;
        totalReviewed += (w as any).review_count || 0;
        totalCorrect += (w as any).correct_count || 0;
      }

      // Count curriculum words with no review yet as NEW
      const { count: totalCurriculum } = await supabase
        .from('vocabulary_words')
        .select('*', { count: 'exact', head: true });

      const reviewedCurriculumCount = reviews?.length || 0;
      const unreviewedCount = (totalCurriculum || 0) - reviewedCurriculumCount;
      stageCounts.NEW += unreviewedCount;

      // Get streak
      const { data: streak } = await supabase
        .from('review_streaks')
        .select('current_streak, longest_streak')
        .eq('user_id', user.id)
        .maybeSingle();

      return {
        stageCounts,
        totalReviewed,
        totalCorrect,
        streak: (streak as any)?.current_streak || 0,
        longestStreak: (streak as any)?.longest_streak || 0,
      };
    },
    enabled: !!user,
  });
}

export function ProgressDashboard() {
  const { data: stats, isLoading } = useProgressStats();

  if (isLoading || !stats) return null;

  const totalCards = Object.values(stats.stageCounts).reduce((a, b) => a + b, 0);
  const accuracy = stats.totalReviewed > 0
    ? Math.round((stats.totalCorrect / stats.totalReviewed) * 100)
    : 0;

  return (
    <div className="rounded-xl bg-card border border-border p-5 mb-6">
      {/* Streak & Accuracy row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-accent" />
          <span className="text-lg font-bold text-foreground">{stats.streak}</span>
          <span className="text-sm text-muted-foreground">day streak</span>
        </div>
        {stats.totalReviewed > 0 && (
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold text-foreground">{accuracy}%</span>
            <span className="text-sm text-muted-foreground">accuracy</span>
          </div>
        )}
      </div>

      {/* Stage breakdown bar */}
      {totalCards > 0 && (
        <div>
          <div className="flex rounded-full overflow-hidden h-3 mb-2">
            {STAGE_ORDER.map((stage) => {
              const count = stats.stageCounts[stage];
              if (count === 0) return null;
              const pct = (count / totalCards) * 100;
              return (
                <div
                  key={stage}
                  className="transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: STAGE_COLORS[stage],
                    minWidth: count > 0 ? '4px' : '0',
                  }}
                />
              );
            })}
          </div>

          {/* Stage labels */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {STAGE_ORDER.map((stage) => {
              const count = stats.stageCounts[stage];
              if (count === 0) return null;
              return (
                <div key={stage} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: STAGE_COLORS[stage] }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {STAGE_LABELS[stage]}: {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
