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
  // From Overview sheet
  stageId: string;
  lessonNumber: number;
  title: string;
  titleArabic?: string;
  description?: string;
  durationMinutes?: number;
  cefrTarget?: string;
  approach?: string;
  unlockCondition?: string;
  // Vocabulary
  vocabulary: VocabEntry[];
  // JSONB metadata from other sheets
  lessonSequence: any[];
  imageScenes: any[];
  flashcardSpec: any[];
  realWorldPrompts: any[];
  designRationale: any[];
  soundSpotlight: any[];
}

/**
 * Hook to import a parsed lesson plan into the database.
 * The xlsx parsing happens client-side; this hook handles the DB inserts.
 */
export const useLessonImport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: ParsedLessonPlan) => {
      // 1. Create the lesson
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .insert({
          stage_id: plan.stageId,
          lesson_number: plan.lessonNumber,
          title: plan.title,
          title_arabic: plan.titleArabic || null,
          description: plan.description || null,
          duration_minutes: plan.durationMinutes || null,
          cefr_target: plan.cefrTarget || null,
          approach: plan.approach || null,
          unlock_condition: plan.unlockCondition || null,
          display_order: plan.lessonNumber,
          lesson_sequence: plan.lessonSequence,
          image_scenes: plan.imageScenes,
          flashcard_spec: plan.flashcardSpec,
          real_world_prompts: plan.realWorldPrompts,
          design_rationale: plan.designRationale,
          sound_spotlight: plan.soundSpotlight,
        } as any)
        .select()
        .single();

      if (lessonError) throw lessonError;

      // 2. We need a topic_id for backward compatibility.
      //    Create a matching topic or reuse an existing one.
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

      // 3. Insert vocabulary words linked to both lesson and topic
      if (plan.vocabulary.length > 0) {
        const wordsToInsert = plan.vocabulary.map((v, idx) => ({
          lesson_id: lesson.id,
          topic_id: topicId,
          word_arabic: v.arabic,
          word_english: v.english,
          transliteration: v.transliteration || null,
          category: v.category || null,
          image_scene_description: v.imageScene || null,
          teaching_note: v.teachingNote || null,
          display_order: idx,
        }));

        const { error: wordsError } = await supabase
          .from('vocabulary_words')
          .insert(wordsToInsert as any);

        if (wordsError) throw wordsError;
      }

      return lesson;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-lessons'] });
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-stages'] });
      queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });
};
