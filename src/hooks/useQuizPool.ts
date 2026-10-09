import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** A word the quiz can offer as a wrong option. */
export interface QuizPoolEntry {
  arabic: string;
  english: string;
  /** Its picture, for the picture question's wrong options. */
  imageUrl?: string | null;
  /** Its recording, so a wrong Arabic option can be played. */
  audioUrl?: string | null;
}

/** Enough to draw three wrong options from without repeating a session. */
const POOL_SIZE = 300;

function usable(
  rows: Array<{ arabic: string | null; english: string | null; imageUrl?: string | null; audioUrl?: string | null }>,
): QuizPoolEntry[] {
  return rows
    .map((row) => ({
      arabic: (row.arabic ?? "").trim(),
      english: (row.english ?? "").trim(),
      imageUrl: row.imageUrl ?? null,
      audioUrl: row.audioUrl ?? null,
    }))
    .filter((row) => row.arabic !== "" && row.english !== "");
}

/**
 * Wrong options for the quiz's choice questions, from beyond the due cards.
 *
 * A session of two due cards cannot offer four options from itself, and
 * falling back to the flip card for every small session would make the quiz
 * something only learners with a backlog ever saw. So each deck draws its
 * distractors from the wider deck it belongs to: the dialect's curriculum,
 * or everything the learner has saved. Read only while the quiz style is on
 * (`enabled`), so the flashcards pay nothing for it. A failed read is an
 * empty pool — the frame then falls back card by card — never an error on
 * the review loop.
 */
export function useCurriculumWordPool(dialect: string, mixAll: boolean, enabled = true) {
  return useQuery({
    queryKey: ["quiz-pool", "curriculum", mixAll ? "all" : dialect],
    enabled,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("vocabulary_words")
        .select("word_arabic, word_english, image_url, audio_url")
        .order("display_order")
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect_module", dialect);
      const { data, error } = await query;
      if (error) return [];
      return usable(
        (data ?? []).map((row) => ({
          arabic: row.word_arabic,
          english: row.word_english,
          imageUrl: row.image_url,
          audioUrl: row.audio_url,
        })),
      );
    },
  });
}

export function useSavedWordPool(dialect: string, mixAll: boolean, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["quiz-pool", "my-words", user?.id, mixAll ? "all" : dialect],
    enabled: enabled && !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("user_vocabulary")
        .select("word_arabic, word_english, image_url, word_audio_url")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect", dialect);
      const { data, error } = await query;
      if (error) return [];
      return usable(
        (data ?? []).map((row) => ({
          arabic: row.word_arabic,
          english: row.word_english,
          imageUrl: row.image_url,
          audioUrl: row.word_audio_url,
        })),
      );
    },
  });
}

export function useSavedPhrasePool(dialect: string, mixAll: boolean, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["quiz-pool", "my-phrases", user?.id, mixAll ? "all" : dialect],
    enabled: enabled && !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<QuizPoolEntry[]> => {
      let query = supabase
        .from("user_phrases")
        .select("phrase_arabic, phrase_english")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(POOL_SIZE);
      if (!mixAll) query = query.eq("dialect", dialect);
      const { data, error } = await query;
      if (error) return [];
      return usable((data ?? []).map((row) => ({ arabic: row.phrase_arabic, english: row.phrase_english })));
    },
  });
}
