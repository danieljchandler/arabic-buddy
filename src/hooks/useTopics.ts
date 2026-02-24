import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Topic {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches all lessons as "topics" for backward compatibility.
 * Each lesson maps to the Topic interface so existing UI components
 * continue to work unchanged.
 */
export const useTopics = () => {
  return useQuery({
    queryKey: ['topics'],
    queryFn: async () => {
      // Try lessons table first (new curriculum structure)
      const { data, error } = await supabase
        .from('lessons')
        .select('*')
        .order('display_order', { ascending: true });

      if (!error && data && data.length > 0) {
        return data.map((lesson: any) => ({
          id: lesson.id,
          name: lesson.title,
          name_arabic: lesson.title_arabic || lesson.title,
          icon: lesson.icon,
          gradient: lesson.gradient,
          display_order: lesson.display_order,
          created_at: lesson.created_at,
          updated_at: lesson.updated_at,
        })) as Topic[];
      }

      // Fallback to old topics table
      const { data: fallback, error: fallbackError } = await supabase
        .from('topics')
        .select('*')
        .order('display_order', { ascending: true });

      if (fallbackError) throw fallbackError;
      return fallback as Topic[];
    },
  });
};
