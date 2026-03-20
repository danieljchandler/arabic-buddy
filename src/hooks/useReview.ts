import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { calculateNextReview, Rating } from '@/lib/spacedRepetition';
import { useAddXP, useIncrementReviews, useCheckAchievements } from './useGamification';
import { useDialect } from '@/contexts/DialectContext';

interface WordReview {
  id: string;
  user_id: string;
  word_id: string;
  ease_factor: number;  // stores FSRS stability
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string;
}

export interface VocabularyWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  topic_id: string;
  image_position?: string | null;
  dialect_module?: string;
}

interface WordWithReview extends VocabularyWord {
  review: WordReview | null;
  topic: {
    name: string;
    name_arabic: string;
    gradient: string;
    icon: string;
  };
}

export const useDueWords = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['due-words', user?.id, mixAll ? 'all' : activeDialect],
    queryFn: async (): Promise<WordWithReview[]> => {
      if (!user) return [];

      const now = new Date().toISOString();

      let query = supabase
        .from('vocabulary_words')
        .select(`
          id,
          word_arabic,
          word_english,
          image_url,
          audio_url,
          topic_id,
          image_position,
          dialect_module,
          topics (
            name,
            name_arabic,
            gradient,
            icon
          )
        `);

      if (!mixAll) {
        query = query.eq('dialect_module', activeDialect);
      }

      const { data: words, error: wordsError } = await query;
      if (wordsError) throw wordsError;

      const { data: reviews, error: reviewsError } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      if (reviewsError) throw reviewsError;

      const reviewMap = new Map(reviews?.map(r => [r.word_id, r]) || []);

      const dueWords = words
        ?.map(word => {
          const review = reviewMap.get(word.id) || null;
          const topicData = (word as any).topics;
          return {
            ...word,
            review,
            topic: topicData as WordWithReview['topic'],
          };
        })
        .filter(word => {
          if (!word.review) return true;
          return new Date(word.review.next_review_at) <= new Date(now);
        })
        .sort((a, b) => {
          if (!a.review) return -1;
          if (!b.review) return 1;
          return new Date(a.review.next_review_at).getTime() - new Date(b.review.next_review_at).getTime();
        });

      return dueWords || [];
    },
    enabled: !!user,
  });
};

export const useReviewStats = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['review-stats', user?.id, mixAll ? 'all' : activeDialect],
    queryFn: async () => {
      if (!user) return null;

      const now = new Date().toISOString();

      let wordsQuery = supabase
        .from('vocabulary_words')
        .select('id', { count: 'exact' });

      if (!mixAll) {
        wordsQuery = wordsQuery.eq('dialect_module', activeDialect);
      }

      const { data: wordIds, count: totalWords } = await wordsQuery;

      const { data: reviews } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      // If filtering by dialect, only count reviews for words in this dialect
      const wordIdSet = !mixAll && wordIds ? new Set(wordIds.map((w: any) => w.id)) : null;
      const filteredReviews = wordIdSet
        ? reviews?.filter(r => wordIdSet.has(r.word_id))
        : reviews;

      const dueCount = filteredReviews?.filter(r => new Date(r.next_review_at) <= new Date(now)).length || 0;
      const learnedCount = filteredReviews?.filter(r => r.repetitions >= 1).length || 0;
      const masteredCount = filteredReviews?.filter(r => r.repetitions >= 5).length || 0;

      return {
        totalWords: totalWords || 0,
        dueCount,
        learnedCount,
        masteredCount,
        newCount: (totalWords || 0) - (filteredReviews?.length || 0),
      };
    },
    enabled: !!user,
  });
};

export const useSubmitReview = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const addXP = useAddXP();
  const incrementReviews = useIncrementReviews();
  const checkAchievements = useCheckAchievements();

  return useMutation({
    mutationFn: async ({ 
      wordId, 
      rating,
      currentReview 
    }: { 
      wordId: string; 
      rating: Rating;
      currentReview: WordReview | null;
    }) => {
      if (!user) throw new Error('Must be logged in');

      const stability    = currentReview?.ease_factor   ?? 0;
      const difficulty   = 5.0;
      const intervalDays = currentReview?.interval_days ?? 0;
      const repetitions  = currentReview?.repetitions   ?? 0;

      const result = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions);

      const reviewData = {
        user_id: user.id,
        word_id: wordId,
        ease_factor: result.stability,
        interval_days: Math.max(0, Math.round(result.intervalDays)),
        repetitions: result.repetitions,
        next_review_at: result.nextReviewAt.toISOString(),
        last_reviewed_at: new Date().toISOString(),
      };

      if (currentReview) {
        const { error } = await supabase
          .from('word_reviews')
          .update(reviewData)
          .eq('id', currentReview.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('word_reviews')
          .insert(reviewData);

        if (error) throw error;
      }

      return { result, rating };
    },
    onSuccess: ({ rating }) => {
      queryClient.invalidateQueries({ queryKey: ['due-words'] });
      queryClient.invalidateQueries({ queryKey: ['review-stats'] });
      
      // Award XP based on rating
      const xpAmounts: Record<Rating, number> = {
        'again': 5,
        'hard': 10,
        'good': 15,
        'easy': 20,
      };
      
      addXP.mutate({ amount: xpAmounts[rating], reason: 'review' });
      incrementReviews.mutate();
      
      // Check for newly earned achievements
      checkAchievements.mutate();
    },
  });
};

export const useAllVocabularyWords = (mixAll = false) => {
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['all-vocabulary-words', mixAll ? 'all' : activeDialect],
    queryFn: async (): Promise<VocabularyWord[]> => {
      let query = supabase
        .from('vocabulary_words')
        .select('id, word_arabic, word_english, image_url, audio_url, topic_id, image_position, dialect_module');

      if (!mixAll) {
        query = query.eq('dialect_module', activeDialect);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
};
