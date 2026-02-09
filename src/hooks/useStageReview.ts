import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { Stage, calculateStageTransition, ReviewResult } from "@/lib/stageRepetition";
import { ExerciseType, pickExercise } from "@/lib/exerciseTypes";
import { DistractorWord, pickDistractors, shuffleOptions } from "@/lib/distractorEngine";

export interface ReviewCard {
  id: string;
  word_arabic: string;
  word_english: string;
  stage: Stage;
  audio_url: string | null;
  sentence_text: string | null;
  sentence_english: string | null;
  sentence_audio_url: string | null;
  topic_id?: string;
  source: 'curriculum' | 'user_vocabulary';
  review_id?: string; // for curriculum word_reviews
}

interface SessionStats {
  total: number;
  correct: number;
  incorrect: number;
}

export function useStageReview(mode: 'curriculum' | 'my_words' | 'all' = 'all') {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ total: 0, correct: 0, incorrect: 0 });
  const [currentExercise, setCurrentExercise] = useState<ExerciseType | null>(null);
  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [sessionDone, setSessionDone] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch due cards
  const { data: dueCards, isLoading, refetch } = useQuery({
    queryKey: ['stage-review-due', user?.id, mode],
    queryFn: async (): Promise<ReviewCard[]> => {
      if (!user) return [];
      const now = new Date().toISOString();
      const cards: ReviewCard[] = [];

      if (mode === 'curriculum' || mode === 'all') {
        // Get all curriculum words
        const { data: words } = await supabase
          .from('vocabulary_words')
          .select('id, word_arabic, word_english, audio_url, topic_id');

        // Get user's reviews
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('*')
          .eq('user_id', user.id);

        const reviewMap = new Map((reviews || []).map(r => [r.word_id, r]));

        for (const w of (words || [])) {
          const review = reviewMap.get(w.id);
          const stage = ((review as any)?.stage as Stage) || 'NEW';
          const nextReview = review?.next_review_at;

          // Due if never reviewed or next_review_at <= now
          if (!review || new Date(nextReview!) <= new Date(now)) {
            cards.push({
              id: w.id,
              word_arabic: w.word_arabic,
              word_english: w.word_english,
              stage,
              audio_url: w.audio_url,
              sentence_text: null,
              sentence_english: null,
              sentence_audio_url: null,
              topic_id: w.topic_id,
              source: 'curriculum',
              review_id: review?.id,
            });
          }
        }
      }

      if (mode === 'my_words' || mode === 'all') {
        const { data: userWords } = await supabase
          .from('user_vocabulary')
          .select('*')
          .eq('user_id', user.id)
          .lte('next_review_at', now);

        for (const w of (userWords || [])) {
          cards.push({
            id: w.id,
            word_arabic: w.word_arabic,
            word_english: w.word_english,
            stage: ((w as any).stage as Stage) || 'NEW',
            audio_url: (w as any).word_audio_url,
            sentence_text: (w as any).sentence_text || null,
            sentence_english: (w as any).sentence_english || null,
            sentence_audio_url: (w as any).sentence_audio_url || null,
            source: 'user_vocabulary',
          });
        }
      }

      // Sort: NEW first, then by stage ascending
      const stageOrder: Record<Stage, number> = { NEW: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5 };
      cards.sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage]);

      return cards;
    },
    enabled: !!user,
  });

  // Fetch distractor pool
  const { data: distractorPool } = useQuery({
    queryKey: ['distractor-pool', user?.id],
    queryFn: async (): Promise<DistractorWord[]> => {
      const pool: DistractorWord[] = [];

      const { data: words } = await supabase
        .from('vocabulary_words')
        .select('word_arabic, word_english, topic_id');

      for (const w of (words || [])) {
        pool.push({ word_arabic: w.word_arabic, word_english: w.word_english, topic_id: w.topic_id });
      }

      if (user) {
        const { data: userWords } = await supabase
          .from('user_vocabulary')
          .select('word_arabic, word_english')
          .eq('user_id', user.id);

        for (const w of (userWords || [])) {
          pool.push({ word_arabic: w.word_arabic, word_english: w.word_english });
        }
      }

      return pool;
    },
    enabled: !!user,
  });

  // Set up exercise when card changes
  useEffect(() => {
    if (!dueCards || dueCards.length === 0 || currentIndex >= dueCards.length) return;
    const card = dueCards[currentIndex];
    const hasSentence = !!(card.sentence_text && card.sentence_audio_url);
    const exercise = pickExercise(card.stage, hasSentence);
    setCurrentExercise(exercise);

    // Generate options
    if (exercise !== 'intro' && distractorPool) {
      const needsArabicOptions = ['audio_to_arabic', 'english_to_arabic', 'sentence_cloze'].includes(exercise);
      const needsEnglishOptions = ['arabic_to_english', 'sentence_to_meaning'].includes(exercise);

      const distractors = pickDistractors(
        card.word_arabic,
        distractorPool,
        card.topic_id,
        3
      );

      if (needsArabicOptions) {
        const opts = shuffleOptions(card.word_arabic, distractors.map(d => d.word_arabic));
        setCurrentOptions(opts);
      } else if (needsEnglishOptions) {
        const opts = shuffleOptions(card.word_english, distractors.map(d => d.word_english));
        setCurrentOptions(opts);
      }
    }
  }, [currentIndex, dueCards, distractorPool]);

  // Submit result mutation
  const submitResult = useMutation({
    mutationFn: async ({ card, result }: { card: ReviewCard; result: ReviewResult }) => {
      if (!user) throw new Error('Not logged in');

      const { newStage, nextReviewAt } = calculateStageTransition(card.stage, result);

      if (card.source === 'curriculum') {
        const reviewData: any = {
          stage: newStage,
          last_result: result,
          next_review_at: nextReviewAt.toISOString(),
          last_reviewed_at: new Date().toISOString(),
          review_count: 1, // will be incremented via raw SQL or just set
          correct_count: result === 'correct' ? 1 : 0,
        };

        if (card.review_id) {
          await supabase
            .from('word_reviews')
            .update({
              ...reviewData,
              ease_factor: 2.5,
            } as any)
            .eq('id', card.review_id!);
        } else {
          // Insert new review
          await supabase
            .from('word_reviews')
            .insert({
              user_id: user.id,
              word_id: card.id,
              stage: newStage,
              last_result: result,
              next_review_at: nextReviewAt.toISOString(),
              last_reviewed_at: new Date().toISOString(),
              review_count: 1,
              correct_count: result === 'correct' ? 1 : 0,
            } as any);
        }
      } else {
        // user_vocabulary
        await supabase
          .from('user_vocabulary')
          .update({
            stage: newStage,
            last_result: result,
            next_review_at: nextReviewAt.toISOString(),
            last_reviewed_at: new Date().toISOString(),
          } as any)
          .eq('id', card.id);
      }

      // Update streak
      const today = new Date().toISOString().split('T')[0];
      const { data: streak } = await supabase
        .from('review_streaks')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (streak) {
        const lastDate = (streak as any).last_review_date;
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        let newStreak = (streak as any).current_streak;
        if (lastDate === yesterday) {
          newStreak += 1;
        } else if (lastDate !== today) {
          newStreak = 1;
        }
        
        await supabase
          .from('review_streaks')
          .update({
            current_streak: newStreak,
            longest_streak: Math.max(newStreak, (streak as any).longest_streak),
            last_review_date: today,
          } as any)
          .eq('id', streak.id);
      } else {
        await supabase
          .from('review_streaks')
          .insert({
            user_id: user.id,
            current_streak: 1,
            longest_streak: 1,
            last_review_date: today,
          } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stage-review-due'] });
      queryClient.invalidateQueries({ queryKey: ['review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-vocabulary'] });
      queryClient.invalidateQueries({ queryKey: ['user-vocabulary-due'] });
      queryClient.invalidateQueries({ queryKey: ['progress-stats'] });
    },
  });

  const playCorrectAudio = useCallback((card: ReviewCard) => {
    if (audioRef.current) audioRef.current.pause();
    if (card.audio_url) {
      const audio = new Audio(card.audio_url);
      audioRef.current = audio;
      audio.play().catch(() => {});
    }
  }, []);

  const handleResult = useCallback(async (result: ReviewResult) => {
    if (!dueCards || currentIndex >= dueCards.length) return;
    const card = dueCards[currentIndex];

    // Play correct audio
    playCorrectAudio(card);

    // Update stats
    setSessionStats(prev => ({
      total: prev.total + 1,
      correct: prev.correct + (result === 'correct' ? 1 : 0),
      incorrect: prev.incorrect + (result !== 'correct' ? 1 : 0),
    }));

    // Submit to DB
    await submitResult.mutateAsync({ card, result });

    // Move to next card
    if (currentIndex < dueCards.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setSessionDone(true);
    }
  }, [dueCards, currentIndex, submitResult, playCorrectAudio]);

  const handleIntroDone = useCallback(async () => {
    if (!dueCards || currentIndex >= dueCards.length) return;
    const card = dueCards[currentIndex];

    // Auto-advance from NEW to STAGE_1
    await submitResult.mutateAsync({ card, result: 'correct' });

    if (currentIndex < dueCards.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setSessionDone(true);
    }
  }, [dueCards, currentIndex, submitResult]);

  const currentCard = dueCards?.[currentIndex] ?? null;
  const progress = dueCards && dueCards.length > 0
    ? ((currentIndex + 1) / dueCards.length) * 100
    : 0;

  return {
    isLoading,
    currentCard,
    currentExercise,
    currentOptions,
    currentIndex,
    totalCards: dueCards?.length ?? 0,
    progress,
    sessionStats,
    sessionDone,
    handleResult,
    handleIntroDone,
    isPending: submitResult.isPending,
  };
}
