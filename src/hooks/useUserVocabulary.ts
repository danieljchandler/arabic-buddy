import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface UserVocabularyWord {
  id: string;
  user_id: string;
  word_arabic: string;
  word_english: string;
  root: string | null;
  source: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useUserVocabulary = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-vocabulary", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UserVocabularyWord[];
    },
    enabled: !!user,
  });
};

export const useUserVocabularyDueCount = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-vocabulary-due", user?.id],
    queryFn: async () => {
      if (!user) return { dueCount: 0, totalCount: 0 };
      
      const now = new Date().toISOString();
      
      const { count: dueCount, error: dueError } = await supabase
        .from("user_vocabulary")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .lte("next_review_at", now);

      if (dueError) throw dueError;

      const { count: totalCount, error: totalError } = await supabase
        .from("user_vocabulary")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (totalError) throw totalError;

      return { 
        dueCount: dueCount || 0, 
        totalCount: totalCount || 0 
      };
    },
    enabled: !!user,
  });
};

export const useAddUserVocabulary = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (word: { 
      word_arabic: string; 
      word_english: string; 
      root?: string;
      source?: string;
      sentence_text?: string;
      sentence_english?: string;
      sentence_audio_url?: string;
    }) => {
      if (!user) throw new Error("Must be logged in");

      const { data, error } = await supabase
        .from("user_vocabulary")
        .insert({
          user_id: user.id,
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          root: word.root || null,
          source: word.source || "transcription",
          sentence_text: word.sentence_text || null,
          sentence_english: word.sentence_english || null,
          sentence_audio_url: word.sentence_audio_url || null,
        })
        .select()
        .single();

      if (error) {
        // Handle duplicate word
        if (error.code === "23505") {
          throw new Error("هذه الكلمة موجودة بالفعل في قائمتك");
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
    },
  });
};

export const useDeleteUserVocabulary = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (wordId: string) => {
      const { error } = await supabase
        .from("user_vocabulary")
        .delete()
        .eq("id", wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
    },
  });
};

export const useUpdateUserVocabularyReview = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      wordId, 
      easeFactor, 
      intervalDays, 
      repetitions, 
      nextReviewAt 
    }: {
      wordId: string;
      easeFactor: number;
      intervalDays: number;
      repetitions: number;
      nextReviewAt: Date;
    }) => {
      const { error } = await supabase
        .from("user_vocabulary")
        .update({
          ease_factor: easeFactor,
          interval_days: Math.max(0, Math.round(intervalDays)),
          repetitions: repetitions,
          next_review_at: nextReviewAt.toISOString(),
          last_reviewed_at: new Date().toISOString(),
        })
        .eq("id", wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
    },
  });
};
