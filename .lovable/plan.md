

# Fix Curriculum Chat → Lesson + Flashcard Pipeline

## The Problem

Yes, this is absolutely possible — and the architecture is already 90% there. The chat generates structured JSON, preview cards render with "Approve" buttons, and approval hooks insert into the `lessons` and `vocabulary_words` tables. But it fails silently because of two bugs:

### Bug 1: Missing `topic_id` on vocabulary insert (FATAL)
The `vocabulary_words` table has `topic_id` as **NOT NULL**. When approving a lesson, the code inserts vocab with only `lesson_id`, `word_arabic`, `word_english`, `display_order` — no `topic_id`. This causes a database error and the entire approval silently fails.

### Bug 2: Edge function timeout kills Claude requests
The edge function has a 55-second timeout. Claude via OpenRouter regularly exceeds this (seen in logs: `AbortError: The signal has been aborted`). The AI never returns a response, so no preview card ever appears.

### Bug 3: `dialect_module` not passed to vocab inserts
When vocabulary words are created alongside a lesson, they don't inherit the session's dialect, so everything defaults to "Gulf".

## Fix Plan

### 1. Make `topic_id` nullable on `vocabulary_words`
Run a migration: `ALTER TABLE vocabulary_words ALTER COLUMN topic_id DROP NOT NULL;`
This lets vocab exist under a lesson without needing a topic. The lesson-based curriculum path and the topic-based path can coexist.

### 2. Fix `useCurriculumApproval.ts` — add `dialect_module` to vocab inserts
When inserting vocabulary alongside an approved lesson, pass `dialect_module` from the session context. Same fix for standalone `approveVocabulary`.

### 3. Increase edge function timeout for Claude
Change the AbortController timeout from 55s to 120s. Claude structured output generation needs more time.

### 4. Pass `dialectModule` through the approval flow
Update `CurriculumBuilder.tsx` to pass `activeSession.target_dialect` as `dialectModule` to `handleApproveLesson`. Update the approval hook call accordingly.

## Files to Edit
- **New migration** — make `topic_id` nullable
- `src/hooks/useCurriculumApproval.ts` — add `dialect_module` to vocab inserts
- `src/pages/admin/CurriculumBuilder.tsx` — pass dialect to approval
- `supabase/functions/curriculum-chat/index.ts` — increase timeout to 120s

