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

export const useTopics = () => {
  return useQuery({
    queryKey: ['topics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data as Topic[];
    },
  });
};
