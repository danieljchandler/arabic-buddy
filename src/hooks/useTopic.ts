import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VocabularyWord {
  id: string;
  topic_id: string;
  lesson_id?: string | null;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  transliteration?: string | null;
  category?: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface TopicWithWords {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  words: VocabularyWord[];
}

/**
 * Fetches a single lesson (or topic) with its vocabulary words.
 * Tries lessons table first, falls back to topics table.
 */
export const useTopic = (topicId: string | undefined) => {
  return useQuery({
    queryKey: ['topic', topicId],
    queryFn: async () => {
      if (!topicId) throw new Error('Topic ID is required');

      // Try fetching as a lesson first
      const { data: lesson } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', topicId)
        .maybeSingle();

      if (lesson) {
        // Fetch words by lesson_id
        const { data: words, error: wordsError } = await supabase
          .from('vocabulary_words')
          .select('*')
          .eq('lesson_id', topicId)
          .order('display_order', { ascending: true });

        if (wordsError) throw wordsError;

        return {
          id: lesson.id,
          name: (lesson as any).title,
          name_arabic: (lesson as any).title_arabic || (lesson as any).title,
          icon: (lesson as any).icon,
          gradient: (lesson as any).gradient,
          display_order: (lesson as any).display_order,
          words: (words || []) as VocabularyWord[],
        } as TopicWithWords;
      }

      // Fallback: fetch as a topic
      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', topicId)
        .single();

      if (topicError) throw topicError;

      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', topicId)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        ...topic,
        words: (words || []) as VocabularyWord[],
      } as TopicWithWords;
    },
    enabled: !!topicId,
  });
};
