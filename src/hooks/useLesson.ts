import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LessonVocabularyWord {
  id: string;
  topic_id: string;
  lesson_id: string | null;
  word_arabic: string;
  word_english: string;
  transliteration: string | null;
  category: string | null;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  image_scene_description: string | null;
  teaching_note: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface LessonWithWords {
  id: string;
  stage_id: string;
  lesson_number: number;
  title: string;
  title_arabic: string | null;
  description: string | null;
  duration_minutes: number | null;
  cefr_target: string | null;
  approach: string | null;
  unlock_condition: string | null;
  icon: string;
  gradient: string;
  display_order: number;
  lesson_sequence: any[];
  image_scenes: any[];
  flashcard_spec: any[];
  real_world_prompts: any[];
  design_rationale: any[];
  sound_spotlight: any[];
  words: LessonVocabularyWord[];
}

export const useLesson = (lessonId: string | undefined) => {
  return useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: async () => {
      if (!lessonId) throw new Error('Lesson ID is required');

      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', lessonId)
        .single();

      if (lessonError) throw lessonError;

      // Fetch words for this lesson
      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('lesson_id', lessonId)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        ...lesson,
        words: (words || []) as LessonVocabularyWord[],
      } as LessonWithWords;
    },
    enabled: !!lessonId,
  });
};
