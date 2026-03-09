

# Plan: Centralize All Content Generation Through the Curriculum Chat "Brain"

## Problem

Currently, many features generate learning material on-the-fly via isolated edge functions (grammar drills, daily challenges, listening quizzes, reading passages, conversation practice, vocab games, etc.). These operate independently with no admin review and no connection to the curriculum builder's AI chat system.

## Goal

Route all content-creating features through the curriculum chat system so that:
1. Admins can chat to generate any type of material (grammar drills, listening exercises, reading passages, daily challenges, conversation scenarios, flashcards, games, stories, etc.)
2. Generated material goes into a **content queue** for admin review/approval before it becomes available to learners
3. Learner-facing features pull from **pre-approved content** in the database rather than calling AI on-the-fly
4. The curriculum chat edge function becomes the single "brain" for all content generation

## Features Affected

| Feature | Current Behavior | New Behavior |
|---|---|---|
| Grammar Drills | Calls `grammar-drill` edge function live | Pulls from `grammar_exercises` table (pre-generated) |
| Daily Challenge | Calls `daily-challenge` edge function live | Pulls from `daily_challenges` table (pre-generated) |
| Listening Practice | Calls `listening-quiz` edge function live | Pulls from `listening_exercises` table (pre-generated) |
| Reading Practice | Calls `reading-passage` edge function live | Pulls from `reading_passages` table (pre-generated) |
| Vocab Games | Generates games from raw word data client-side | Pulls curated game sets from `vocab_game_sets` table |
| Conversation Simulator | Calls `conversation-practice` live | Pulls from `conversation_scenarios` table (pre-generated) |

## Implementation Steps

### 1. Database: Create Content Tables (Migration)

Create new tables for each content type to store admin-approved material:

- **`grammar_exercises`** — stores approved grammar drill questions (category, difficulty, question JSON, explanation)
- **`daily_challenges`** — stores approved daily challenge sets (date-targeted, question JSON)
- **`listening_exercises`** — stores approved listening quiz content (mode, difficulty, questions JSON, audio text)
- **`reading_passages`** — stores approved reading passages (difficulty, passage text, questions JSON)
- **`vocab_game_sets`** — stores curated word sets for games (game type, word pairs JSON)
- **`conversation_scenarios`** — stores conversation starters/scripts (topic, difficulty, system prompt, example exchanges)

All tables will have: `id`, `created_at`, `status` (draft/published), `created_by`, `session_id` (link back to curriculum chat session), and RLS policies (admin write, public read for published).

### 2. Expand the Curriculum Chat Edge Function

Update `supabase/functions/curriculum-chat/index.ts`:
- Add new `mode` values: `generate_grammar`, `generate_listening`, `generate_reading`, `generate_daily_challenge`, `generate_conversation`, `generate_game_set`
- Each mode gets a tailored system prompt section with the correct JSON schema for that content type
- The structured output extraction already handles JSON blocks — just need new `output_type` values

### 3. Expand the Curriculum Approval System

Update `src/hooks/useCurriculumApproval.ts`:
- Add approval mutations for each new content type: `approveGrammarExercise`, `approveListeningExercise`, `approveReadingPassage`, `approveDailyChallenge`, `approveConversationScenario`, `approveGameSet`
- Each inserts the approved content into the corresponding table with `status: 'published'`

### 4. Add Preview Cards to the Chat Window

Create new preview card components in `src/components/admin/curriculum-builder/`:
- `GrammarPreviewCard` — shows grammar questions with approve button
- `ListeningPreviewCard` — shows listening exercise with approve button
- `ReadingPreviewCard` — shows passage preview with approve button
- `DailyPreviewCard`, `ConversationPreviewCard`, `GameSetPreviewCard`

Update `ChatWindow.tsx` to render the appropriate preview card based on `output_type`.

### 5. Update Chat Input with New Generation Modes

Update `ChatInput.tsx` to include new mode buttons:
- Grammar Drill, Listening Exercise, Reading Passage, Daily Challenge, Conversation Scenario, Game Set

### 6. Refactor Learner-Facing Pages

Update each feature page to fetch from the new content tables instead of calling AI:

- **GrammarDrills.tsx** — query `grammar_exercises` where `status = 'published'`, filter by category/difficulty
- **DailyChallenge.tsx** — query `daily_challenges` for today's date
- **ListeningPractice.tsx** — query `listening_exercises` by mode/difficulty
- **ReadingPractice.tsx** — query `reading_passages` by difficulty
- **VocabGames.tsx** — query `vocab_game_sets` by game type
- **ConversationSimulator.tsx** — query `conversation_scenarios` for available topics, use approved scripts

Each page keeps its existing UI/game logic but swaps the data source from live AI to pre-approved database content. Add a fallback message ("No exercises available yet") when the content table is empty.

### 7. Update `curriculum_chat_approvals` Table

Add new allowed values to the `approval_type` check constraint: `'grammar'`, `'listening'`, `'reading'`, `'daily_challenge'`, `'conversation'`, `'game_set'`.

## Technical Notes

- The existing curriculum chat infrastructure (sessions, messages, approval tracking, model registry) is reused entirely
- No new edge functions needed — the existing `curriculum-chat` function handles all generation via the `mode` parameter
- Old standalone edge functions (`grammar-drill`, `daily-challenge`, `listening-quiz`, `reading-passage`) can be kept as fallbacks or removed later
- RLS: all new content tables allow public SELECT for published content, admin-only INSERT/UPDATE/DELETE

