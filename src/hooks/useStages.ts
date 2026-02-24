import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CurriculumStage {
  id: string;
  name: string;
  name_arabic: string | null;
  stage_number: number;
  cefr_level: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  lesson_count?: number;
}

export const useStages = () => {
  return useQuery({
    queryKey: ['curriculum-stages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curriculum_stages')
        .select('*, lessons(id)')
        .order('display_order', { ascending: true });

      if (error) throw error;

      return (data || []).map((stage: any) => ({
        ...stage,
        lesson_count: stage.lessons?.length || 0,
        lessons: undefined,
      })) as CurriculumStage[];
    },
  });
};
