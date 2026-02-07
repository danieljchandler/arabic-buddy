import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface WordWithTopic {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  display_order: number;
  topic_id: string;
  topic_name: string;
  topic_name_arabic: string;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Fetches all vocabulary words across topics, shuffled.
 * Optionally filters to only "new" (unreviewed) words for logged-in users.
 */
export const useAllWords = (onlyNew = false) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['all-words', onlyNew, user?.id],
    queryFn: async (): Promise<WordWithTopic[]> => {
      const { data: words, error } = await supabase
        .from('vocabulary_words')
        .select(`
          id,
          word_arabic,
          word_english,
          image_url,
          audio_url,
          image_position,
          display_order,
          topic_id,
          topics (
            name,
            name_arabic
          )
        `);

      if (error) throw error;

      let mapped = (words || []).map(w => ({
        id: w.id,
        word_arabic: w.word_arabic,
        word_english: w.word_english,
        image_url: w.image_url,
        audio_url: w.audio_url,
        image_position: w.image_position,
        display_order: w.display_order,
        topic_id: w.topic_id,
        topic_name: (w.topics as any)?.name || '',
        topic_name_arabic: (w.topics as any)?.name_arabic || '',
      }));

      // If onlyNew and user is logged in, filter out reviewed words
      if (onlyNew && user) {
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('word_id')
          .eq('user_id', user.id);

        const reviewedIds = new Set(reviews?.map(r => r.word_id) || []);
        mapped = mapped.filter(w => !reviewedIds.has(w.id));
      }

      return shuffleArray(mapped);
    },
  });
};
