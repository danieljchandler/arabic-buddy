import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Lesson {
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
  created_at: string;
  updated_at: string;
  word_count?: number;
}

/** Fetch all lessons for a given stage */
export const useLessons = (stageId: string | undefined) => {
  return useQuery({
    queryKey: ['lessons', stageId],
    queryFn: async () => {
      if (!stageId) throw new Error('Stage ID is required');

      const { data, error } = await supabase
        .from('lessons')
        .select('*, vocabulary_words(id)')
        .eq('stage_id', stageId)
        .order('display_order', { ascending: true });

      if (error) throw error;

      return (data || []).map((lesson: any) => ({
        ...lesson,
        word_count: lesson.vocabulary_words?.length || 0,
        vocabulary_words: undefined,
      })) as Lesson[];
    },
    enabled: !!stageId,
  });
};

/** Fetch all lessons across all stages */
export const useAllLessons = () => {
  return useQuery({
    queryKey: ['all-lessons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lessons')
        .select('*, vocabulary_words(id), curriculum_stages(name, stage_number)')
        .order('display_order', { ascending: true });

      if (error) throw error;

      return (data || []).map((lesson: any) => ({
        ...lesson,
        word_count: lesson.vocabulary_words?.length || 0,
        stage_name: lesson.curriculum_stages?.name || '',
        stage_number: lesson.curriculum_stages?.stage_number || 0,
        vocabulary_words: undefined,
        curriculum_stages: undefined,
      })) as (Lesson & { stage_name: string; stage_number: number })[];
    },
  });
};
