

# Stage-Based Spaced Repetition System

This is a large overhaul that replaces the current SM-2 algorithm with a simpler, stage-based SRS system and adds interactive quiz-style exercises for both curriculum words and personal (My Words) vocabulary.

---

## Overview

The current system uses the Anki-style SM-2 algorithm with ease factors and a "reveal answer then rate" flow. The new system replaces this with 6 discrete stages (NEW through Stage5), each with a fixed review interval and specific exercise types (multiple-choice only, no typing).

---

## 1. Database Changes

### Modify `user_vocabulary` table
- Add `stage` column (text, default `'NEW'`, values: `NEW`, `STAGE_1`, `STAGE_2`, `STAGE_3`, `STAGE_4`, `STAGE_5`)
- Add `last_result` column (text, nullable, values: `correct`, `incorrect`, `wrong`)
- Add `sentence_text` column (text, nullable) -- needed for sentence-based exercises
- Add `sentence_english` column (text, nullable) -- needed for sentence exercises
- Add `review_count` column (integer, default 0) -- for accuracy tracking
- Add `correct_count` column (integer, default 0) -- for accuracy tracking
- Existing `ease_factor`, `interval_days`, `repetitions` columns become unused but kept for backward compatibility

### Modify `word_reviews` table (curriculum words)
- Add `stage` column (text, default `'NEW'`)
- Add `last_result` column (text, nullable)
- Add `review_count` column (integer, default 0)
- Add `correct_count` column (integer, default 0)

### New `review_streaks` table
- `id` (uuid, PK)
- `user_id` (uuid, not null)
- `current_streak` (integer, default 0)
- `longest_streak` (integer, default 0)
- `last_review_date` (date, nullable)
- RLS: users can only access their own row

### Modify `tutor_upload_candidates` flow
- When approving candidates into `user_vocabulary`, also copy `sentence_text` and `sentence_english` into the new columns

---

## 2. Core SRS Logic

### New file: `src/lib/stageRepetition.ts`

Replaces `spacedRepetition.ts` usage in review flows.

- Stages and intervals:

```text
NEW       -> immediate (no test, just show)
STAGE_1   -> 10 minutes
STAGE_2   -> 1 day
STAGE_3   -> 3 days
STAGE_4   -> 7 days
STAGE_5   -> 21 days
```

- Promotion rules:
  - `correct` -> advance one stage
  - `incorrect` -> drop one stage (min STAGE_1)
  - `wrong` -> return to NEW

- Function: `calculateStageTransition(currentStage, result)` returns `{ newStage, intervalMinutes, nextReviewAt }`

---

## 3. Exercise Types by Stage

### New file: `src/lib/exerciseTypes.ts`

Defines which exercise formats are available per stage and picks one randomly:

| Stage | Exercise Types |
|-------|---------------|
| NEW | IntroCard -- show Arabic word, play audio, show English + sentence (no test) |
| STAGE_1 | Audio plays -> pick correct Arabic word from 4 choices |
| STAGE_2 | Audio -> pick Arabic OR Arabic shown -> pick English meaning |
| STAGE_3 | Sentence audio -> pick missing word OR Arabic -> pick meaning |
| STAGE_4 | English shown -> pick Arabic OR audio plays -> pick Arabic |
| STAGE_5 | Sentence audio -> pick English meaning |

Each exercise is a component that renders 4 multiple-choice options and returns correct/incorrect/wrong.

---

## 4. Smart Distractors

### New file: `src/lib/distractorEngine.ts`

Generates 3 distractors for each question:

1. **Same-source words**: For curriculum words, pull from the same topic. For user vocabulary, pull from the same user's word list.
2. **Recently learned**: Words the user has reviewed recently (any stage above NEW).
3. **Fallback**: Random words from the full vocabulary pool.

The engine fetches a pool of candidate distractors when the review session starts, then selects 3 per question, shuffled with the correct answer.

---

## 5. Exercise Components

### New components in `src/components/exercises/`:

- **`AudioToArabicChoice.tsx`** -- Plays audio, shows 4 Arabic word buttons
- **`ArabicToEnglishChoice.tsx`** -- Shows Arabic word, 4 English meaning buttons
- **`EnglishToArabicChoice.tsx`** -- Shows English meaning, 4 Arabic word buttons
- **`SentenceAudioCloze.tsx`** -- Plays sentence audio, shows sentence with blank, 4 word choices to fill
- **`SentenceAudioToMeaning.tsx`** -- Plays sentence audio, 4 English meaning buttons
- **`ExerciseWrapper.tsx`** -- Shared wrapper: renders the chosen exercise, handles feedback animation (green/red flash), plays correct audio after answer, calls `onResult`

Each component:
- Shows 4 tappable option buttons
- On tap: immediately shows green (correct) or red (incorrect) feedback
- Plays the correct word audio after answering
- Calls `onResult('correct' | 'incorrect' | 'wrong')` after a short delay

---

## 6. Review Session Flow

### Rewrite `src/pages/MyWordsReview.tsx` and `src/pages/Review.tsx`

Both pages will use a shared review session hook:

### New hook: `src/hooks/useStageReview.ts`

- Fetches all due cards (where `next_review_at <= now`)
- For NEW stage cards: shows IntroCard (no test), auto-advances to STAGE_1
- For other stages: picks a random exercise type, renders it
- After each answer:
  - Immediate visual feedback (correct/incorrect)
  - Play correct audio
  - Update stage + next_review_at in the database
  - Update streak
- Session ends when all due cards are done
- Shows completion screen with stats

### Session flow:
1. Load due cards
2. For each card, determine stage and pick exercise
3. User taps an answer
4. Show feedback (green/red highlight on options)
5. Play correct word audio
6. Brief pause, then next card
7. When done, show results summary

---

## 7. Progress Dashboard

### New component: `src/components/progress/ProgressDashboard.tsx`

Displayed on the home page (Index.tsx) for authenticated users:

- **Stage breakdown**: horizontal bar or pill badges showing count per stage (NEW: 5, Stage 1: 3, Stage 2: 8, etc.)
- **Daily streak**: flame icon with streak count
- **Accuracy**: percentage from `correct_count / review_count`
- Compact design that fits the existing home page card layout

---

## 8. Integration Points

### Home page (`Index.tsx`)
- Add ProgressDashboard component below the existing buttons
- Review buttons continue to work as before, routing to the updated review pages

### Tutor Upload flow
- When creating `user_vocabulary` entries from approved candidates, also save `sentence_text` and `sentence_english`

### Curriculum Learn flow (`Learn.tsx`)
- The "New Words" intro+quiz flow stays as-is for first exposure
- The `/review` route gets the new exercise system

---

## 9. Files to Create/Modify

**New files:**
- `src/lib/stageRepetition.ts` -- stage logic and intervals
- `src/lib/exerciseTypes.ts` -- exercise type definitions per stage
- `src/lib/distractorEngine.ts` -- smart distractor generation
- `src/components/exercises/AudioToArabicChoice.tsx`
- `src/components/exercises/ArabicToEnglishChoice.tsx`
- `src/components/exercises/EnglishToArabicChoice.tsx`
- `src/components/exercises/SentenceAudioCloze.tsx`
- `src/components/exercises/SentenceAudioToMeaning.tsx`
- `src/components/exercises/ExerciseWrapper.tsx`
- `src/hooks/useStageReview.ts`
- `src/components/progress/ProgressDashboard.tsx`

**Modified files:**
- `src/pages/MyWordsReview.tsx` -- rewrite to use stage-based exercises
- `src/pages/Review.tsx` -- rewrite to use stage-based exercises
- `src/pages/Index.tsx` -- add progress dashboard
- `src/hooks/useTutorUpload.ts` -- save sentence_text/sentence_english to user_vocabulary
- `src/hooks/useReview.ts` -- update to use stage logic
- `src/hooks/useUserVocabulary.ts` -- update types and queries
- Database migration for new columns

**Unchanged:**
- `src/lib/spacedRepetition.ts` -- kept for reference but no longer used in review flows
- `src/pages/Learn.tsx` -- kept as-is for new word introduction
- Admin pages -- no changes needed

---

## Technical Notes

- Audio for exercises: uses `word_audio_url` (My Words) or `audio_url` (curriculum) if available, falls back to ElevenLabs TTS
- Sentence audio: uses `sentence_audio_url` if available, otherwise generates via TTS from `sentence_text`
- For curriculum words without sentences, sentence-based exercises will be skipped and replaced with word-level exercises from the same stage
- The "wrong" result (completely wrong) maps to tapping an answer that is semantically very far from correct -- in practice, any incorrect answer drops one stage, and a "Reset" button on results lets users manually send cards back to NEW if needed

