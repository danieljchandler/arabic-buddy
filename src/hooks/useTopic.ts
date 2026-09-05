import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VocabularyWord {
  id: string;
  topic_id: string | null;
  lesson_id?: string | null;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  /**
   * Arabic root. Optional because the column postdates every fixture and
   * every row written before the backfill: null means nobody has looked it up,
   * '' means the word has none.
   */
  root?: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * A pronunciation note authored alongside the lesson's vocabulary.
 * Shape comes from parseLessonXlsx's "SOUND SPOTLIGHT" section.
 */
export interface SoundSpotlightEntry {
  sound?: string;
  example?: string;
  explanation?: string;
}

/** Free-form rows from the lesson spreadsheet's sequence / prompts sheets. */
export type LessonPlanRow = Record<string, string>;

export interface TopicWithWords {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  words: VocabularyWord[];
  /**
   * The authored lesson plan. These columns have existed since the curriculum
   * restructure and parseLessonXlsx has always produced them, but the importer
   * dropped them at insert and nothing selected them — so a designed lesson
   * reached the learner as a bare vocabulary list. Empty arrays for any lesson
   * imported before that was fixed; every renderer omits an empty section.
   */
  soundSpotlight: SoundSpotlightEntry[];
  realWorldPrompts: LessonPlanRow[];
  lessonSequence: LessonPlanRow[];
  /**
   * The curriculum-track sections (curriculum/tracks/, seeded by migration).
   * Grammar notes explain one pattern with dialect examples; culture notes
   * carry the phrases that go with a custom; the dialogue is the lesson's
   * words in one short exchange. Empty for every lesson that predates the
   * tracks — the admin UI and the xlsx importer never write them.
   */
  grammarNotes: LessonGrammarNote[];
  cultureNotes: LessonCultureNote[];
  dialogue: LessonDialogueLine[];
  canDo: string[];
}

export interface LessonArabicLine {
  arabic: string;
  transliteration?: string;
  english?: string;
}

export interface LessonGrammarNote {
  category?: string;
  title: string;
  explanation?: string;
  examples: LessonArabicLine[];
}

export interface LessonCultureNote {
  title: string;
  note?: string;
  phrases: LessonArabicLine[];
}

export interface LessonDialogueLine extends LessonArabicLine {
  speaker?: string;
}

function asLines(value: unknown): LessonArabicLine[] {
  return asRows(value)
    .filter((row) => typeof row.arabic === 'string' && row.arabic.trim().length > 0)
    .map((row) => ({ arabic: row.arabic, transliteration: row.transliteration, english: row.english }));
}

function asGrammarNotes(value: unknown): LessonGrammarNote[] {
  return asRows(value)
    .filter((row) => typeof row.title === 'string' && row.title.trim().length > 0)
    .map((row) => ({
      category: typeof row.category === 'string' ? row.category : undefined,
      title: row.title,
      explanation: typeof row.explanation === 'string' ? row.explanation : undefined,
      examples: asLines((row as Record<string, unknown>).examples),
    }));
}

function asCultureNotes(value: unknown): LessonCultureNote[] {
  return asRows(value)
    .filter((row) => typeof row.title === 'string' && row.title.trim().length > 0)
    .map((row) => ({
      title: row.title,
      note: typeof row.note === 'string' ? row.note : undefined,
      phrases: asLines((row as Record<string, unknown>).phrases),
    }));
}

function asDialogue(value: unknown): LessonDialogueLine[] {
  return asRows(value)
    .filter((row) => typeof row.arabic === 'string' && row.arabic.trim().length > 0)
    .map((row) => ({
      speaker: typeof row.speaker === 'string' ? row.speaker : undefined,
      arabic: row.arabic,
      transliteration: row.transliteration,
      english: row.english,
    }));
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Coerce a JSONB column into rows, tolerating null, a non-array, or entries that
 * aren't objects — this data originates in a spreadsheet, so it's only as
 * well-formed as whoever authored the sheet.
 */
function asRows(value: unknown): LessonPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is LessonPlanRow => !!row && typeof row === 'object' && !Array.isArray(row),
  );
}

/**
 * Fetches a lesson or topic with its vocabulary words.
 * Tries the lessons table first, then falls back to topics for legacy data.
 */
export const useTopic = (id: string | undefined) => {
  return useQuery({
    queryKey: ['topic', id],
    queryFn: async () => {
      if (!id) throw new Error('ID is required');

      // Try lessons table first
      const { data: lesson } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (lesson) {
        const { data: words, error: wordsError } = await supabase
          .from('vocabulary_words')
          .select('*')
          .eq('lesson_id', id)
          .order('display_order', { ascending: true });

        if (wordsError) throw wordsError;

        const plan = lesson as unknown as {
          sound_spotlight?: unknown;
          real_world_prompts?: unknown;
          lesson_sequence?: unknown;
          grammar_notes?: unknown;
          culture_notes?: unknown;
          dialogue?: unknown;
          can_do?: unknown;
        };

        return {
          id: lesson.id,
          name: lesson.title,
          name_arabic: lesson.title_arabic || '',
          icon: lesson.icon,
          gradient: lesson.gradient,
          display_order: lesson.display_order,
          words: (words || []) as VocabularyWord[],
          soundSpotlight: asRows(plan.sound_spotlight) as SoundSpotlightEntry[],
          realWorldPrompts: asRows(plan.real_world_prompts),
          lessonSequence: asRows(plan.lesson_sequence),
          grammarNotes: asGrammarNotes(plan.grammar_notes),
          cultureNotes: asCultureNotes(plan.culture_notes),
          dialogue: asDialogue(plan.dialogue),
          canDo: asStrings(plan.can_do),
        } as TopicWithWords;
      }

      // Fallback: topics table for legacy data
      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', id)
        .single();

      if (topicError) throw topicError;

      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', id)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      // Legacy topics have no lesson plan; the renderers omit empty sections.
      return {
        ...topic,
        words: (words || []) as VocabularyWord[],
        soundSpotlight: [],
        realWorldPrompts: [],
        lessonSequence: [],
        grammarNotes: [],
        cultureNotes: [],
        dialogue: [],
        canDo: [],
      } as TopicWithWords;
    },
    enabled: !!id,
  });
};