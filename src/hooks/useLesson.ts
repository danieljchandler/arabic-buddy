import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LessonVocabularyWord {
  id: string;
  topic_id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface LessonWithWords {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  words: LessonVocabularyWord[];
}

/** Fetches a topic with its vocabulary words (lessons table doesn't exist yet) */
export const useLesson = (lessonId: string | undefined) => {
  return useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: async () => {
      if (!lessonId) throw new Error('Lesson ID is required');

      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', lessonId)
        .single();

      if (topicError) throw topicError;

      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', lessonId)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        id: topic.id,
        name: topic.name,
        name_arabic: topic.name_arabic,
        icon: topic.icon,
        gradient: topic.gradient,
        display_order: topic.display_order,
        words: (words || []) as LessonVocabularyWord[],
      } as LessonWithWords;
    },
    enabled: !!lessonId,
  });
};