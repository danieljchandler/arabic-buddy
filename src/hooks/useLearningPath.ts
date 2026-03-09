import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface LearningPath {
  id: string;
  user_id: string;
  goal_type: string;
  goal_description: string;
  target_dialect: string;
  target_level: string;
  timeline_weeks: number;
  curriculum: any;
  current_week: number;
  status: string;
  started_at: string;
  last_activity_at: string | null;
}

export interface WeeklyRecommendation {
  id: string;
  user_id: string;
  learning_path_id: string | null;
  week_start: string;
  performance_summary: any;
  focus_areas: any;
  suggested_content: any;
  vocab_to_review: any;
  motivation_message: string | null;
  motivation_message_arabic: string | null;
  difficulty_adjustment: string | null;
  viewed_at: string | null;
}

export function useLearningPath() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["learning-path", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("learning_paths")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as LearningPath | null;
    },
    enabled: !!user,
  });
}

export function useWeeklyRecommendation(pathId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["weekly-recommendation", user?.id, pathId],
    queryFn: async () => {
      if (!user || !pathId) return null;
      const { data, error } = await supabase
        .from("weekly_recommendations")
        .select("*")
        .eq("user_id", user.id)
        .eq("learning_path_id", pathId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as WeeklyRecommendation | null;
    },
    enabled: !!user && !!pathId,
  });
}

export function useCreateLearningPath() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      goal_type: string;
      goal_description: string;
      target_dialect: string;
      target_level: string;
      timeline_weeks: number;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Generate curriculum via AI
      const { data: fnData, error: fnError } = await supabase.functions.invoke("generate-learning-path", {
        body: params,
      });

      if (fnError) throw fnError;
      if (fnData?.error) throw new Error(fnData.error);

      // Save to database
      const { data, error } = await supabase
        .from("learning_paths")
        .insert({
          user_id: user.id,
          goal_type: params.goal_type,
          goal_description: params.goal_description,
          target_dialect: params.target_dialect,
          target_level: params.target_level,
          timeline_weeks: params.timeline_weeks,
          curriculum: fnData,
        })
        .select()
        .single();

      if (error) throw error;

      // Also ensure user_difficulty record exists
      await supabase.from("user_difficulty").upsert(
        { user_id: user.id },
        { onConflict: "user_id" }
      ).select();

      return data as LearningPath;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-path"] });
      toast.success("Learning path created!");
    },
    onError: (err: any) => {
      toast.error("Failed to create path", { description: err.message });
    },
  });
}

export function useRequestCoaching() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (learning_path_id: string) => {
      const { data, error } = await supabase.functions.invoke("weekly-coach", {
        body: { learning_path_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-recommendation"] });
      toast.success("Weekly coaching updated!");
    },
    onError: (err: any) => {
      toast.error("Coaching failed", { description: err.message });
    },
  });
}

export function useAdvanceWeek() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pathId: string) => {
      const { data: path } = await supabase
        .from("learning_paths")
        .select("current_week, timeline_weeks")
        .eq("id", pathId)
        .single();

      if (!path) throw new Error("Path not found");

      const newWeek = path.current_week + 1;
      const updates: any = {
        current_week: newWeek,
        last_activity_at: new Date().toISOString(),
      };

      if (newWeek > path.timeline_weeks) {
        updates.status = "completed";
        updates.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("learning_paths")
        .update(updates)
        .eq("id", pathId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-path"] });
    },
  });
}
