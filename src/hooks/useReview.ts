import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { calculateNextReview, Rating } from '@/lib/spacedRepetition';

interface WordReview {
  id: string;
  user_id: string;
  word_id: string;
  ease_factor: number;
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

export const useDueWords = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['due-words', user?.id],
    queryFn: async (): Promise<WordWithReview[]> => {
      if (!user) return [];

      const now = new Date().toISOString();

      // Get all words with their review status
      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select(`
          id,
          word_arabic,
          word_english,
          image_url,
          audio_url,
          topic_id,
          topics (
            name,
            name_arabic,
            gradient,
            icon
          )
        `);

      if (wordsError) throw wordsError;

      // Get user's review data
      const { data: reviews, error: reviewsError } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      if (reviewsError) throw reviewsError;

      const reviewMap = new Map(reviews?.map(r => [r.word_id, r]) || []);

      // Filter to due words (either never reviewed or next_review_at <= now)
      const dueWords = words
        ?.map(word => {
          const review = reviewMap.get(word.id) || null;
          return {
            ...word,
            review,
            topic: word.topics as unknown as WordWithReview['topic'],
          };
        })
        .filter(word => {
          if (!word.review) return true; // Never reviewed = due
          return new Date(word.review.next_review_at) <= new Date(now);
        })
        .sort((a, b) => {
          // Sort by: never reviewed first, then by next_review_at
          if (!a.review) return -1;
          if (!b.review) return 1;
          return new Date(a.review.next_review_at).getTime() - new Date(b.review.next_review_at).getTime();
        });

      return dueWords || [];
    },
    enabled: !!user,
  });
};

export const useReviewStats = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['review-stats', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const now = new Date().toISOString();

      // Get total words count
      const { count: totalWords } = await supabase
        .from('vocabulary_words')
        .select('*', { count: 'exact', head: true });

      // Get user's reviews
      const { data: reviews } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      const dueCount = reviews?.filter(r => new Date(r.next_review_at) <= new Date(now)).length || 0;
      const learnedCount = reviews?.filter(r => r.repetitions >= 1).length || 0;
      const masteredCount = reviews?.filter(r => r.repetitions >= 5).length || 0;

      return {
        totalWords: totalWords || 0,
        dueCount,
        learnedCount,
        masteredCount,
        newCount: (totalWords || 0) - (reviews?.length || 0),
      };
    },
    enabled: !!user,
  });
};

export const useSubmitReview = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

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

      const easeFactor = currentReview?.ease_factor || 2.5;
      const intervalDays = currentReview?.interval_days || 0;
      const repetitions = currentReview?.repetitions || 0;

      const result = calculateNextReview(rating, easeFactor, intervalDays, repetitions);

      const reviewData = {
        user_id: user.id,
        word_id: wordId,
        ease_factor: result.easeFactor,
        interval_days: Math.max(0, Math.round(result.intervalDays)),
        repetitions: result.repetitions,
        next_review_at: result.nextReviewAt.toISOString(),
        last_reviewed_at: new Date().toISOString(),
      };

      if (currentReview) {
        // Update existing review
        const { error } = await supabase
          .from('word_reviews')
          .update(reviewData)
          .eq('id', currentReview.id);

        if (error) throw error;
      } else {
        // Insert new review
        const { error } = await supabase
          .from('word_reviews')
          .insert(reviewData);

        if (error) throw error;
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['due-words'] });
      queryClient.invalidateQueries({ queryKey: ['review-stats'] });
    },
  });
};

export const useAllVocabularyWords = () => {
  return useQuery({
    queryKey: ['all-vocabulary-words'],
    queryFn: async (): Promise<VocabularyWord[]> => {
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('id, word_arabic, word_english, image_url, audio_url, topic_id, image_position');

      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
};
