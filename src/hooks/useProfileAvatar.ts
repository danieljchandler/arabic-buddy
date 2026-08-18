import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * The signed-in learner's picture, for the chrome that has to show it.
 *
 * Picking an avatar in Settings writes `profiles.avatar_url` and every page
 * that already loads a profile row picked it up — Profile, Friends, the
 * leaderboard. The shell did not, because the shell never loads a profile: the
 * emblem in the corner was a static image. So choosing a picture appeared to
 * do nothing on the screens people actually spend their time on.
 *
 * This is deliberately its own tiny query rather than a slice of the Profile
 * page's fetch. The emblem is mounted on nearly every route, so what it reads
 * has to be one narrow, long-cached row rather than a page-sized payload; and
 * the Profile page's fetch lives inside that page's component, which the shell
 * cannot reach anyway.
 */

export interface ProfileAvatar {
  avatarUrl: string | null;
  displayName: string | null;
}

/** Shared so a writer (Settings) can invalidate exactly what the shell reads. */
export const profileAvatarQueryKey = (userId?: string | null) =>
  ["profile-avatar", userId ?? null] as const;

/**
 * Drop the cached picture for a user, so the emblem repaints after a change.
 *
 * Exported as a helper because the writers are plain `supabase.update()` calls
 * in Settings rather than react-query mutations, and a bare `invalidateQueries`
 * there would have to restate the key.
 */
export function invalidateProfileAvatar(client: QueryClient, userId?: string | null) {
  return client.invalidateQueries({ queryKey: profileAvatarQueryKey(userId) });
}

export function useProfileAvatar() {
  const { user } = useAuth();

  return useQuery({
    queryKey: profileAvatarQueryKey(user?.id),
    queryFn: async (): Promise<ProfileAvatar> => {
      if (!user) return { avatarUrl: null, displayName: null };

      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url, display_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      return {
        avatarUrl: data?.avatar_url ?? null,
        displayName: data?.display_name ?? null,
      };
    },
    enabled: !!user,
    // A picture changes about once. Long enough that the emblem costs one
    // query a session, short enough that a change lands without a reload even
    // if the invalidation below is missed.
    staleTime: 5 * 60 * 1000,
  });
}
