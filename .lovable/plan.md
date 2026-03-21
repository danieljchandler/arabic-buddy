

# Fix Curriculum Chat — Create Missing Tables + Clean Up Models + Add Egyptian

## Problem
Nothing happens when you try to create lessons because:
1. **`curriculum_stages`, `lessons`, `curriculum_chat_approvals` tables don't exist** — the approval hook inserts into `lessons` which fails silently
2. **`ModelSelector` still lists Jais, ALLaM, Falcon** — selecting them errors since they're removed from the backend
3. **Edge function lacks Egyptian dialect** and still uses `gemini-2.5-flash` instead of `gemini-3-flash-preview`
4. **`vocabulary_words` has no `lesson_id` column** — vocab can't be linked to lessons
5. **Default model in `CurriculumBuilder.tsx`** is `google/gemini-2.5-flash` instead of the upgraded model

## Changes

### 1. Database Migration
Create the three missing tables and seed curriculum stages:

```sql
-- curriculum_stages table with 6 levels
-- lessons table (references curriculum_stages)
-- curriculum_chat_approvals table
-- Add lesson_id column to vocabulary_words
-- RLS: admin-only for stages/lessons/approvals management, public SELECT on stages/lessons
-- Seed 6 stages (Foundations through Mastery)
```

### 2. `ModelSelector.tsx` — Remove dead models, add gemini-3-flash-preview
- Remove `jais-hf`, `allam-hf`, `falcon-h1r` from `LLMModelId` type and `MODEL_OPTIONS`
- Add `google/gemini-3-flash-preview` as the recommended model
- Keep Gemini 2.5 Flash, Claude, Qwen, Gemma, Fanar

### 3. `curriculum-chat/index.ts` — Add Egyptian + gemini-3-flash-preview
- Add `google/gemini-3-flash-preview` to `MODEL_REGISTRY`
- Add `Egyptian` to `DIALECT_CONTEXT` with appropriate vocabulary examples
- Update system prompt to handle Egyptian vs Gulf dynamically

### 4. `CurriculumBuilder.tsx` — Fix default model
- Change default `newModel` from `google/gemini-2.5-flash` to `google/gemini-3-flash-preview`

### 5. `useCurriculumApproval.ts` — Add dialect_module to lesson/vocab inserts
- Pass `dialect_module` when inserting lessons and vocabulary so content is tagged correctly

### 6. `useStages.ts` — Remove `as never` cast (table will exist now)

### 7. `useLessonImport.ts` — Use new `lessons` table instead of falling back to topics

## Files
- **New migration** (1 file)
- `src/components/admin/curriculum-builder/ModelSelector.tsx`
- `supabase/functions/curriculum-chat/index.ts`
- `src/pages/admin/CurriculumBuilder.tsx`
- `src/hooks/useCurriculumApproval.ts`
- `src/hooks/useStages.ts`
- `src/hooks/useLessonImport.ts`

