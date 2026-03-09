import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface LeaderboardEntry {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  total_xp: number;
  level: number;
  xp_this_week: number;
  rank: number;
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  show_on_leaderboard: boolean;
}

export function useWeeklyLeaderboard(limit = 20) {
  return useQuery({
    queryKey: ["leaderboard", "weekly", limit],
    queryFn: async () => {
      // Get profiles that allow leaderboard display
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .eq("show_on_leaderboard", true);

      if (profilesError) throw profilesError;

      const userIds = profiles?.map((p) => p.user_id) || [];

      if (userIds.length === 0) return [];

      // Get XP data for those users
      const { data: xpData, error: xpError } = await supabase
        .from("user_xp")
        .select("user_id, total_xp, level, xp_this_week")
        .in("user_id", userIds)
        .order("xp_this_week", { ascending: false })
        .limit(limit);

      if (xpError) throw xpError;

      // Merge profiles with XP data
      const entries: LeaderboardEntry[] = (xpData || []).map((xp, index) => {
        const profile = profiles?.find((p) => p.user_id === xp.user_id);
        return {
          user_id: xp.user_id,
          display_name: profile?.display_name || "Anonymous",
          avatar_url: profile?.avatar_url || null,
          total_xp: xp.total_xp,
          level: xp.level,
          xp_this_week: xp.xp_this_week,
          rank: index + 1,
        };
      });

      return entries;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useAllTimeLeaderboard(limit = 20) {
  return useQuery({
    queryKey: ["leaderboard", "all-time", limit],
    queryFn: async () => {
      // Get profiles that allow leaderboard display
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .eq("show_on_leaderboard", true);

      if (profilesError) throw profilesError;

      const userIds = profiles?.map((p) => p.user_id) || [];

      if (userIds.length === 0) return [];

      // Get XP data for those users
      const { data: xpData, error: xpError } = await supabase
        .from("user_xp")
        .select("user_id, total_xp, level, xp_this_week")
        .in("user_id", userIds)
        .order("total_xp", { ascending: false })
        .limit(limit);

      if (xpError) throw xpError;

      // Merge profiles with XP data
      const entries: LeaderboardEntry[] = (xpData || []).map((xp, index) => {
        const profile = profiles?.find((p) => p.user_id === xp.user_id);
        return {
          user_id: xp.user_id,
          display_name: profile?.display_name || "Anonymous",
          avatar_url: profile?.avatar_url || null,
          total_xp: xp.total_xp,
          level: xp.level,
          xp_this_week: xp.xp_this_week,
          rank: index + 1,
        };
      });

      return entries;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useMyProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      // Create profile if doesn't exist
      if (!data) {
        const { data: newProfile, error: insertError } = await supabase
          .from("profiles")
          .insert({
            user_id: user.id,
            display_name: user.email?.split("@")[0] || "User",
          })
          .select()
          .single();

        if (insertError) throw insertError;
        return newProfile as Profile;
      }

      return data as Profile;
    },
    enabled: !!user,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (updates: Partial<Profile>) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useMyRank() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-rank", user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get user's XP
      const { data: myXP, error: myXPError } = await supabase
        .from("user_xp")
        .select("total_xp, xp_this_week")
        .eq("user_id", user.id)
        .single();

      if (myXPError || !myXP) return { weeklyRank: null, allTimeRank: null };

      // Count users with more XP
      const { count: higherXPCount } = await supabase
        .from("user_xp")
        .select("*", { count: "exact", head: true })
        .gt("total_xp", myXP.total_xp);

      const { count: higherWeeklyCount } = await supabase
        .from("user_xp")
        .select("*", { count: "exact", head: true })
        .gt("xp_this_week", myXP.xp_this_week);

      return {
        weeklyRank: (higherWeeklyCount || 0) + 1,
        allTimeRank: (higherXPCount || 0) + 1,
      };
    },
    enabled: !!user,
  });
}
