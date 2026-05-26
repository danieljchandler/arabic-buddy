import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface SiblingWord {
  id: string;
  word_arabic: string;
  word_english: string;
  root: string | null;
  stage: string;
  image_url: string | null;
  word_audio_url: string | null;
  next_review_at: string;
}

/**
 * Fetch other vocabulary words owned by the user that share the same root
 * as the current word (same dialect, excluding self). Used to surface
 * morphological siblings during review (#12 sibling card linking).
 */
export const useSiblingWords = (params: {
  root: string | null | undefined;
  excludeId: string;
  dialect: string;
  enabled?: boolean;
}) => {
  const { user } = useAuth();
  const { root, excludeId, dialect, enabled = true } = params;
  const cleanRoot = (root ?? "").trim();

  return useQuery({
    queryKey: ["sibling-words", user?.id, dialect, cleanRoot, excludeId],
    queryFn: async (): Promise<SiblingWord[]> => {
      if (!user || !cleanRoot) return [];
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select(
          "id, word_arabic, word_english, root, stage, image_url, word_audio_url, next_review_at",
        )
        .eq("user_id", user.id)
        .eq("dialect", dialect)
        .eq("root", cleanRoot)
        .neq("id", excludeId)
        .order("stage", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as SiblingWord[];
    },
    enabled: enabled && !!user && !!cleanRoot,
    staleTime: 60_000,
  });
};
