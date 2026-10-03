import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { celebrate, claimStreakCelebration } from "@/lib/celebrations";

/**
 * Fire the streak celebration when the learner's review streak lands on a
 * milestone (3, 7, 14, 30 … days) that this device hasn't celebrated yet in
 * the current run.
 *
 * Nothing in the client detects streak milestones otherwise: `review_streaks`
 * is written server-side, and the app only ever reads it for display. So this
 * watches the same `["review-streak", uid]` query StreakDisplay, MajlisWelcome
 * and the feed read (they select different columns; every one includes
 * `current_streak`, which is all this needs). `useCheckAchievements` refreshes
 * that cache with the row it already fetches after each rated card, so the
 * moment a review moves the streak onto a milestone, this sees it.
 *
 * Mounted once, inside `CelebrationHost`.
 */
export function useStreakMilestoneCelebration() {
  const { user } = useAuth();

  const { data: streak } = useQuery({
    queryKey: ["review-streak", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("review_streaks")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const userId = user?.id;
  const current = streak?.current_streak ?? 0;

  useEffect(() => {
    if (!userId || current <= 0) return;
    if (claimStreakCelebration(userId, current)) {
      celebrate({ kind: "streak", detail: current });
    }
  }, [userId, current]);
}
