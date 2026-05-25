import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VocabularyWord {
  id: string;
  topic_id: string | null;
  lesson_id?: string | null;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
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
 * Fetches a lesson or topic with its vocabulary words.
 * Tries the lessons table first, then falls back to topics for legacy data.
 */
export const useTopic = (id: string | undefined) => {
  return useQuery({
    queryKey: ['topic', id],
    queryFn: async () => {
      if (!id) throw new Error('ID is required');

      // Try lessons table first
      const { data: lesson } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (lesson) {
        const { data: words, error: wordsError } = await supabase
          .from('vocabulary_words')
          .select('*')
          .eq('lesson_id', id)
          .order('display_order', { ascending: true });

        if (wordsError) throw wordsError;

        return {
          id: lesson.id,
          name: lesson.title,
          name_arabic: lesson.title_arabic || '',
          icon: lesson.icon,
          gradient: lesson.gradient,
          display_order: lesson.display_order,
          words: (words || []) as VocabularyWord[],
        } as TopicWithWords;
      }

      // Fallback: topics table for legacy data
      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', id)
        .single();

      if (topicError) throw topicError;

      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', id)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        ...topic,
        words: (words || []) as VocabularyWord[],
      } as TopicWithWords;
    },
    enabled: !!id,
  });
};