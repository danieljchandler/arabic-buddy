import type { Stage } from './stageRepetition';

export type ExerciseType =
  | 'intro'                    // NEW: show word, audio, meaning, sentence
  | 'audio_to_arabic'          // hear audio → pick Arabic word
  | 'arabic_to_english'        // see Arabic → pick English meaning
  | 'english_to_arabic'        // see English → pick Arabic
  | 'sentence_cloze'           // hear sentence → pick missing word
  | 'sentence_to_meaning';     // hear sentence → pick English meaning

const STAGE_EXERCISES: Record<Stage, ExerciseType[]> = {
  NEW: ['intro'],
  STAGE_1: ['audio_to_arabic'],
  STAGE_2: ['audio_to_arabic', 'arabic_to_english'],
  STAGE_3: ['sentence_cloze', 'arabic_to_english'],
  STAGE_4: ['english_to_arabic', 'audio_to_arabic'],
  STAGE_5: ['sentence_to_meaning'],
};

// Exercises that require sentence data
const SENTENCE_EXERCISES: ExerciseType[] = ['sentence_cloze', 'sentence_to_meaning'];

export function pickExercise(stage: Stage, hasSentence: boolean): ExerciseType {
  let options = STAGE_EXERCISES[stage];

  if (!hasSentence) {
    const filtered = options.filter(e => !SENTENCE_EXERCISES.includes(e));
    // Fallback: if all options needed sentences, use word-level alternatives
    options = filtered.length > 0 ? filtered : ['arabic_to_english'];
  }

  return options[Math.floor(Math.random() * options.length)];
}

export function needsSentence(exerciseType: ExerciseType): boolean {
  return SENTENCE_EXERCISES.includes(exerciseType);
}
