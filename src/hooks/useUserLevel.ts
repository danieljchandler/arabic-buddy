import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

/**
 * Maps CEFR placement levels to difficulty labels used by edge functions.
 */
const cefrToDifficulty = (level: string | null): 'beginner' | 'intermediate' | 'advanced' => {
  switch (level?.toUpperCase()) {
    case 'A1':
    case 'A2':
      return 'beginner';
    case 'B1':
    case 'B2':
      return 'intermediate';
    case 'C1':
    case 'C2':
      return 'advanced';
    default:
      return 'beginner';
  }
};

export const useUserLevel = () => {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ['user-level', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('placement_level, proficiency_level')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const placementLevel = profile?.placement_level ?? null;
  const difficulty = cefrToDifficulty(placementLevel);

  return {
    /** Raw CEFR level from placement quiz, e.g. "B1" */
    placementLevel,
    /** Mapped difficulty: beginner | intermediate | advanced */
    difficulty,
    /** Whether the user has taken the placement quiz */
    hasTakenPlacement: !!placementLevel,
  };
};
