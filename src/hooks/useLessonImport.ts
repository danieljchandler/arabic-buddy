import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface VocabEntry {
  number: number;
  arabic: string;
  transliteration: string;
  english: string;
  category: string;
  imageScene: string;
  teachingNote: string;
}

interface ParsedLessonPlan {
  stageId: string;
  lessonNumber: number;
  title: string;
  titleArabic?: string;
  description?: string;
  durationMinutes?: number;
  cefrTarget?: string;
  approach?: string;
  unlockCondition?: string;
  vocabulary: VocabEntry[];
  lessonSequence: any[];
  imageScenes: any[];
  flashcardSpec: any[];
  realWorldPrompts: any[];
  designRationale: any[];
  soundSpotlight: any[];
}

/**
 * Hook to import a parsed lesson plan.
 * Since lessons/curriculum_stages tables don't exist yet,
 * this creates a topic and vocabulary words instead.
 */
export const useLessonImport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: ParsedLessonPlan) => {
      // Create a topic for this lesson
      const topicName = plan.title;
      let topicId: string;

      const { data: existingTopic } = await supabase
        .from('topics')
        .select('id')
        .eq('name', topicName)
        .maybeSingle();

      if (existingTopic) {
        topicId = existingTopic.id;
      } else {
        const { data: maxOrder } = await supabase
          .from('topics')
          .select('display_order')
          .order('display_order', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextOrder = (maxOrder?.display_order ?? -1) + 1;

        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({
            name: topicName,
            name_arabic: plan.titleArabic || topicName,
            display_order: nextOrder,
          })
          .select()
          .single();

        if (topicError) throw topicError;
        topicId = newTopic.id;
      }

      // Insert vocabulary words
      if (plan.vocabulary.length > 0) {
        const wordsToInsert = plan.vocabulary.map((v, idx) => ({
          topic_id: topicId,
          word_arabic: v.arabic,
          word_english: v.english,
          display_order: idx,
        }));

        const { error: wordsError } = await supabase
          .from('vocabulary_words')
          .insert(wordsToInsert);

        if (wordsError) throw wordsError;
      }

      return { id: topicId, name: topicName };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });
};