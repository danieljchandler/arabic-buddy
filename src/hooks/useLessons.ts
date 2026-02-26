import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Lesson {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  word_count?: number;
}

/** Fetch all topics as lessons (lessons table doesn't exist yet) */
export const useLessons = (stageId?: string | undefined) => {
  return useQuery({
    queryKey: ['lessons', stageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('*, vocabulary_words(id)')
        .order('display_order', { ascending: true });

      if (error) throw error;

      return (data || []).map((topic: any) => ({
        id: topic.id,
        name: topic.name,
        name_arabic: topic.name_arabic,
        icon: topic.icon,
        gradient: topic.gradient,
        display_order: topic.display_order,
        created_at: topic.created_at,
        updated_at: topic.updated_at,
        word_count: topic.vocabulary_words?.length || 0,
      })) as Lesson[];
    },
  });
};

/** Fetch all lessons across all stages (alias) */
export const useAllLessons = () => useLessons();