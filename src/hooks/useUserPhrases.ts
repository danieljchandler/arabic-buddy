import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface UserPhrase {
  id: string;
  user_id: string;
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string | null;
  notes: string | null;
  source: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useUserPhrases = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-phrases", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_phrases")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UserPhrase[];
    },
    enabled: !!user,
  });
};

export const useAddUserPhrase = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (phrase: {
      phrase_arabic: string;
      phrase_english: string;
      transliteration?: string;
      notes?: string;
      source?: string;
    }) => {
      if (!user) throw new Error("Must be logged in");

      const { data, error } = await supabase
        .from("user_phrases")
        .insert({
          user_id: user.id,
          phrase_arabic: phrase.phrase_arabic,
          phrase_english: phrase.phrase_english,
          transliteration: phrase.transliteration || null,
          notes: phrase.notes || null,
          source: phrase.source || "how-do-i-say",
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("هذه العبارة موجودة بالفعل في قائمتك");
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-phrases"] });
    },
  });
};

export const useDeleteUserPhrase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (phraseId: string) => {
      const { error } = await supabase
        .from("user_phrases")
        .delete()
        .eq("id", phraseId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-phrases"] });
    },
  });
};
