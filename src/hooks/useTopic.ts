import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VocabularyWord {
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

export interface TopicWithWords {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  words: VocabularyWord[];
}

export const useTopic = (topicId: string | undefined) => {
  return useQuery({
    queryKey: ['topic', topicId],
    queryFn: async () => {
      if (!topicId) throw new Error('Topic ID is required');

      // Fetch topic
      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', topicId)
        .single();

      if (topicError) throw topicError;

      // Fetch words for this topic
      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', topicId)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        ...topic,
        words: words || [],
      } as TopicWithWords;
    },
    enabled: !!topicId,
  });
};
