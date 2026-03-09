import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface UserXP {
  id: string;
  user_id: string;
  total_xp: number;
  level: number;
  xp_this_week: number;
  week_start_date: string;
}

export interface Achievement {
  id: string;
  name: string;
  name_arabic: string;
  description: string;
  icon: string;
  xp_reward: number;
  requirement_type: string;
  requirement_value: number | null;
}

export interface UserAchievement {
  id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface WeeklyGoal {
  id: string;
  user_id: string;
  week_start_date: string;
  target_reviews: number;
  completed_reviews: number;
  target_xp: number;
  earned_xp: number;
}

// Calculate level from XP (every 500 XP = 1 level)
export function calculateLevel(xp: number): number {
  return Math.floor(xp / 500) + 1;
}

// XP needed for next level
export function xpForNextLevel(currentLevel: number): number {
  return currentLevel * 500;
}

// XP progress within current level
export function xpProgressInLevel(totalXp: number): { current: number; needed: number; percent: number } {
  const level = calculateLevel(totalXp);
  const xpAtLevelStart = (level - 1) * 500;
  const current = totalXp - xpAtLevelStart;
  const needed = 500;
  return { current, needed, percent: Math.round((current / needed) * 100) };
}

export function useUserXP() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-xp", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("user_xp")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      // Create initial XP record if none exists
      if (!data) {
        const { data: newData, error: insertError } = await supabase
          .from("user_xp")
          .insert({ user_id: user.id })
          .select()
          .single();

        if (insertError) throw insertError;
        return newData as UserXP;
      }

      return data as UserXP;
    },
    enabled: !!user,
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ["achievements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("achievements")
        .select("*")
        .order("display_order");

      if (error) throw error;
      return data as Achievement[];
    },
  });
}

export function useUserAchievements() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-achievements", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_achievements")
        .select(`
          *,
          achievement:achievements(*)
        `)
        .eq("user_id", user.id)
        .order("earned_at", { ascending: false });

      if (error) throw error;
      return data as (UserAchievement & { achievement: Achievement })[];
    },
    enabled: !!user,
  });
}

export function useWeeklyGoal() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["weekly-goal", user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get current week's Monday
      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("weekly_goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("week_start_date", weekStart)
        .maybeSingle();

      if (error) throw error;

      // Create weekly goal if none exists
      if (!data) {
        const { data: newData, error: insertError } = await supabase
          .from("weekly_goals")
          .insert({ user_id: user.id, week_start_date: weekStart })
          .select()
          .single();

        if (insertError) throw insertError;
        return newData as WeeklyGoal;
      }

      return data as WeeklyGoal;
    },
    enabled: !!user,
  });
}

export function useAddXP() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ amount, reason }: { amount: number; reason: string }) => {
      if (!user) throw new Error("Not authenticated");

      // Get current XP
      const { data: currentXP } = await supabase
        .from("user_xp")
        .select("*")
        .eq("user_id", user.id)
        .single();

      const oldLevel = currentXP ? calculateLevel(currentXP.total_xp) : 1;
      const newTotalXP = (currentXP?.total_xp || 0) + amount;
      const newLevel = calculateLevel(newTotalXP);

      // Upsert XP
      const { error } = await supabase
        .from("user_xp")
        .upsert({
          user_id: user.id,
          total_xp: newTotalXP,
          level: newLevel,
          xp_this_week: (currentXP?.xp_this_week || 0) + amount,
        }, { onConflict: "user_id" });

      if (error) throw error;

      // Update weekly goal
      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split("T")[0];

      const { data: weeklyGoal } = await supabase
        .from("weekly_goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("week_start_date", weekStart)
        .single();

      if (weeklyGoal) {
        await supabase
          .from("weekly_goals")
          .update({ earned_xp: weeklyGoal.earned_xp + amount })
          .eq("id", weeklyGoal.id);
      }

      return { newTotalXP, levelUp: newLevel > oldLevel, newLevel };
    },
    onSuccess: (result, { amount, reason }) => {
      queryClient.invalidateQueries({ queryKey: ["user-xp"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-goal"] });

      // Show XP earned toast
      toast({
        title: `+${amount} XP`,
        description: reason === "review" ? "Review completed!" : "Keep it up!",
        duration: 2000,
      });

      if (result.levelUp) {
        setTimeout(() => {
          toast({
            title: `🎉 Level Up!`,
            description: `You've reached Level ${result.newLevel}!`,
          });
        }, 500);
      }
    },
  });
}

export function useIncrementReviews() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split("T")[0];

      const { data: weeklyGoal } = await supabase
        .from("weekly_goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("week_start_date", weekStart)
        .maybeSingle();

      if (weeklyGoal) {
        await supabase
          .from("weekly_goals")
          .update({ completed_reviews: weeklyGoal.completed_reviews + 1 })
          .eq("id", weeklyGoal.id);
      } else {
        await supabase
          .from("weekly_goals")
          .insert({ 
            user_id: user.id, 
            week_start_date: weekStart,
            completed_reviews: 1
          });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-goal"] });
    },
  });
}

// Check and award achievements based on user progress
export function useCheckAchievements() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      if (!user) return [];

      // Get all achievements and user's earned ones
      const [{ data: achievements }, { data: userAchievements }, { data: streak }, { data: weeklyGoal }] = await Promise.all([
        supabase.from("achievements").select("*"),
        supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
        supabase.from("review_streaks").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("weekly_goals").select("*").eq("user_id", user.id).order("week_start_date", { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (!achievements) return [];

      const earnedIds = new Set(userAchievements?.map(ua => ua.achievement_id) || []);
      const newlyEarned: Achievement[] = [];

      // Get user stats
      const { count: totalReviews } = await supabase
        .from("word_reviews")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const { count: wordsLearned } = await supabase
        .from("word_reviews")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("repetitions", 1);

      const currentStreak = streak?.current_streak || 0;
      const completedReviews = weeklyGoal?.completed_reviews || 0;

      // Check each achievement
      for (const achievement of achievements) {
        if (earnedIds.has(achievement.id)) continue;

        let earned = false;
        const value = achievement.requirement_value || 0;

        switch (achievement.requirement_type) {
          case "reviews_completed":
            earned = (totalReviews || 0) >= value;
            break;
          case "words_learned":
            earned = (wordsLearned || 0) >= value;
            break;
          case "streak_days":
            earned = currentStreak >= value;
            break;
          default:
            break;
        }

        if (earned) {
          const { error } = await supabase
            .from("user_achievements")
            .insert({ user_id: user.id, achievement_id: achievement.id });

          if (!error) {
            newlyEarned.push(achievement as Achievement);
            
            // Award XP for achievement
            const { data: currentXP } = await supabase
              .from("user_xp")
              .select("total_xp")
              .eq("user_id", user.id)
              .single();

            await supabase
              .from("user_xp")
              .upsert({
                user_id: user.id,
                total_xp: (currentXP?.total_xp || 0) + achievement.xp_reward,
                level: calculateLevel((currentXP?.total_xp || 0) + achievement.xp_reward),
              }, { onConflict: "user_id" });
          }
        }
      }

      return newlyEarned;
    },
    onSuccess: (newlyEarned) => {
      if (newlyEarned.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["user-achievements"] });
        queryClient.invalidateQueries({ queryKey: ["user-xp"] });

        // Show toast for each new achievement
        newlyEarned.forEach((achievement) => {
          toast({
            title: `${achievement.icon} Achievement Unlocked!`,
            description: `${achievement.name} — +${achievement.xp_reward} XP`,
          });
        });
      }
    },
  });
}
