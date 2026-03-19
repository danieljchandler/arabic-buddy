import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';

export interface Topic {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  dialect_module?: string;
}

export const useTopics = () => {
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['topics', activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .eq('dialect_module' as any, activeDialect)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data as Topic[];
    },
  });
};
