import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
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
  image_url: string | null;
  dialect: string;
  sentence_text: string | null;
  sentence_english: string | null;
  sentence_audio_url: string | null;
  word_audio_url: string | null;
}

export const useUserVocabulary = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["user-vocabulary", user?.id, mixAll ? "all" : activeDialect],
    queryFn: async () => {
      if (!user) return [];
      
      let query = supabase
        .from("user_vocabulary")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }) as any;

      if (!mixAll) {
        query = query.eq("dialect", activeDialect);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as UserVocabularyWord[];
    },
    enabled: !!user,
  });
};

export const useUserVocabularyDueCount = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["user-vocabulary-due", user?.id, mixAll ? "all" : activeDialect],
    queryFn: async () => {
      if (!user) return { dueCount: 0, totalCount: 0 };
      
      const now = new Date().toISOString();
      
      let dueQuery = supabase
        .from("user_vocabulary")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .lte("next_review_at", now) as any;
      if (!mixAll) dueQuery = dueQuery.eq("dialect", activeDialect);

      const { count: dueCount, error: dueError } = await dueQuery;
      if (dueError) throw dueError;

      let totalQuery = supabase
        .from("user_vocabulary")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id) as any;
      if (!mixAll) totalQuery = totalQuery.eq("dialect", activeDialect);

      const { count: totalCount, error: totalError } = await totalQuery;
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
  const { activeDialect } = useDialect();

  return useMutation({
    mutationFn: async (word: { 
      word_arabic: string; 
      word_english: string; 
      root?: string;
      source?: string;
      sentence_text?: string;
      sentence_english?: string;
      sentence_audio_url?: string;
      dialect?: string;
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
          dialect: word.dialect || activeDialect,
        } as any)
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
      stability,
      difficulty,
      intervalDays,
      repetitions,
      nextReviewAt,
    }: {
      wordId: string;
      stability: number;
      difficulty: number;
      intervalDays: number;
      repetitions: number;
      nextReviewAt: Date;
    }) => {
      const { error } = await supabase
        .from("user_vocabulary")
        .update({
          ease_factor: stability,
          interval_days: Math.max(0, Math.round(intervalDays)),
          repetitions,
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
