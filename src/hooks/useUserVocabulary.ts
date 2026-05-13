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

      const { count: recogDueCount, error: dueError } = await dueQuery;
      if (dueError) throw dueError;

      let prodDueQuery = supabase
        .from("user_vocabulary")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("production_next_review_at", "is", null)
        .lte("production_next_review_at", now) as any;
      if (!mixAll) prodDueQuery = prodDueQuery.eq("dialect", activeDialect);

      const { count: prodDueCount, error: prodErr } = await prodDueQuery;
      if (prodErr) throw prodErr;

      const dueCount = (recogDueCount || 0) + (prodDueCount || 0);

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
      word_audio_url?: string;
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
          word_audio_url: word.word_audio_url || null,
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

export type ReviewCardType = "recognition" | "production";

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
      cardType = "recognition",
      rating,
      productionLocked,
    }: {
      wordId: string;
      stability: number;
      difficulty: number;
      intervalDays: number;
      repetitions: number;
      nextReviewAt: Date;
      cardType?: ReviewCardType;
      rating?: string;
      productionLocked?: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> =
        cardType === "production"
          ? {
              production_ease_factor: stability,
              production_interval_days: Math.max(0, Math.round(intervalDays)),
              production_repetitions: repetitions,
              production_next_review_at: nextReviewAt.toISOString(),
              production_last_reviewed_at: nowIso,
            }
          : {
              ease_factor: stability,
              interval_days: Math.max(0, Math.round(intervalDays)),
              repetitions,
              next_review_at: nextReviewAt.toISOString(),
              last_reviewed_at: nowIso,
            };

      // Unlock production card on first successful recognition rating (Good/Easy)
      if (
        cardType === "recognition" &&
        productionLocked &&
        (rating === "good" || rating === "easy")
      ) {
        update.production_next_review_at = nowIso;
      }

      const { error } = await supabase
        .from("user_vocabulary")
        .update(update as any)
        .eq("id", wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
      // Note: do NOT invalidate "user-vocabulary-due-words" here — the review
      // page advances its own currentIndex; refetching mid-session would shift
      // the array out from under us and skip cards.
    },
  });
};

export const useUpdateUserVocabularyImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wordId, imageUrl }: { wordId: string; imageUrl: string }) => {
      const { error } = await supabase
        .from("user_vocabulary")
        .update({ image_url: imageUrl } as any)
        .eq("id", wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
    },
  });
};

export interface BulkVocabInput {
  word_arabic: string;
  word_english: string;
  root?: string | null;
  source?: string;
  word_audio_url?: string | null;
  image_url?: string | null;
  dialect?: string;
}

/**
 * Bulk-add words to the user's vocabulary, skipping duplicates per
 * (user_id, word_arabic, dialect). Returns counts so callers can show a toast.
 */
export const useBulkAddUserVocabulary = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useMutation({
    mutationFn: async (
      args: { words: BulkVocabInput[]; source?: string; dialect?: string },
    ): Promise<{ added: number; skipped: number; total: number }> => {
      if (!user) throw new Error("Must be logged in");
      const dialect = args.dialect || activeDialect;
      const source = args.source || "picture_scene";
      const total = args.words.length;
      if (total === 0) return { added: 0, skipped: 0, total: 0 };

      const rows = args.words.map((w) => ({
        user_id: user.id,
        word_arabic: w.word_arabic,
        word_english: w.word_english,
        root: w.root ?? null,
        source: w.source ?? source,
        word_audio_url: w.word_audio_url ?? null,
        image_url: w.image_url ?? null,
        dialect: w.dialect || dialect,
      }));

      const { data, error } = await supabase
        .from("user_vocabulary")
        .upsert(rows as any, {
          onConflict: "user_id,word_arabic,dialect",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw error;
      const added = data?.length ?? 0;
      return { added, skipped: total - added, total };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
    },
  });
};
