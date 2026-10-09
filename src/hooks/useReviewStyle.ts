import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  isReviewStyle,
  loadReviewStyle,
  saveReviewStyle,
  subscribeReviewStyle,
  type ReviewStyle,
} from "@/lib/reviewStyle";

const QUERY_KEY = "review-style";

/**
 * Reactive hook for "how you review": flashcards or quiz.
 *
 * The device cache (src/lib/reviewStyle.ts) answers first, from the state
 * initialiser, so a review page never renders a flip card and then swaps it
 * for a question once the profile arrives. The profile is the source of truth
 * across devices: when it carries a style, it is written into the cache,
 * which re-renders every mounted consumer through the subscription. A profile
 * with nothing chosen (null) never overrides the device — that is also the
 * state while the migration adding `profiles.review_style` has not been
 * applied to the live project, where the column read fails and the write
 * below fails with it. Both are swallowed: a preference read must never block
 * or break the review loop, and the device keeps its own answer.
 */
export function useReviewStyle() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [style, setStyleState] = useState<ReviewStyle>(loadReviewStyle);

  useEffect(() => subscribeReviewStyle(() => setStyleState(loadReviewStyle())), []);

  const { data: remote } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ReviewStyle | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("review_style" as never)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) return null;
      const value = (data as { review_style?: unknown } | null)?.review_style;
      return isReviewStyle(value) ? value : null;
    },
  });

  // The profile wins over the device, but only when it has an answer.
  useEffect(() => {
    if (remote && remote !== loadReviewStyle()) saveReviewStyle(remote);
  }, [remote]);

  const setStyle = useCallback(
    (value: ReviewStyle) => {
      setStyleState(value);
      saveReviewStyle(value);
      if (!user) return;
      // Pin the cache so a refetch racing this write cannot flip the device
      // back to the stale value in between.
      queryClient.setQueryData([QUERY_KEY, user.id], value);
      void supabase
        .from("profiles")
        .update({ review_style: value } as never)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) console.warn("Couldn't sync the review style to the profile:", error.message);
        });
    },
    [user, queryClient],
  );

  return { style, setStyle };
}
