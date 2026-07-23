import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { calculateNextReview, Rating } from '@/lib/spacedRepetition';
import { useAddXP, useIncrementReviews, useCheckAchievements } from './useGamification';
import { useDialect } from '@/contexts/DialectContext';
import { useNewCardCap } from './useNewCardCap';
import { useRemainingNewCardBudget } from './useNewCardBudget';

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
  const { cap: newCap } = useNewCardCap();
  const { remaining: remainingNewBudget } = useRemainingNewCardBudget(newCap);

  return useQuery({
    queryKey: ['due-words', user?.id, mixAll ? 'all' : activeDialect, remainingNewBudget],
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
          lesson_id,
          image_position,
          dialect_module,
          lessons (
            title,
            title_arabic,
            gradient,
            icon
          ),
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
          const lessonData = (word as any).lessons;
          const topicData = (word as any).topics;
          const resolvedTopic = lessonData
            ? { name: lessonData.title, name_arabic: lessonData.title_arabic || '', gradient: lessonData.gradient, icon: lessonData.icon }
            : topicData;
          return {
            ...word,
            review,
            topic: resolvedTopic as WordWithReview['topic'],
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

      if (!dueWords) return [];

      // Cap new (never-reviewed) words to the remaining daily new-card
      // budget — shared with the personal-vocab review path via
      // daily_new_card_counts, so this is a real daily limit, not a
      // per-page-load one.
      const newWords = dueWords.filter((w) => !w.review);
      const reviewWords = dueWords.filter((w) => !!w.review);
      const cappedNew = newWords.slice(0, remainingNewBudget);
      return [...cappedNew, ...reviewWords];
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

export async function submitRatingToServer(
  userId: string,
  wordId: string,
  rating: Rating,
  currentReview: WordReview | null
) {
  const stability = currentReview?.ease_factor ?? 0;
  const difficulty = 5.0;
  const intervalDays = currentReview?.interval_days ?? 0;
  const repetitions = currentReview?.repetitions ?? 0;

  const result = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions);

  const reviewData = {
    user_id: userId,
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

    // First-ever rating of this word: claim daily new-card budget (shared
    // with the personal-vocab review path). Best-effort — never blocks the
    // review submission.
    (supabase.rpc as any)('increment_new_card_count', { _amount: 1 }).catch(() => {});
  }

  return { result, rating };
}

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
      currentReview,
    }: {
      wordId: string;
      rating: Rating;
      currentReview: WordReview | null;
    }) => {
      if (!user) throw new Error('Must be logged in');
      return submitRatingToServer(user.id, wordId, rating, currentReview);
    },
    onSuccess: ({ rating }) => {
      queryClient.invalidateQueries({ queryKey: ['review-stats'] });

      const xpAmounts: Record<Rating, number> = {
        'again': 5,
        'hard': 10,
        'good': 15,
        'easy': 20,
      };

      addXP.mutate({ amount: xpAmounts[rating], reason: 'review' });
      incrementReviews.mutate();
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
