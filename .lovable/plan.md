

# Global Dialect Module System

## Overview

Create a `DialectContext` that stores the user's active dialect module (starting with "Gulf" and "Egyptian"). Every page, hook, and edge function call reads from this context so the entire app switches dialect at once.

## Architecture

```text
DialectContext ("Gulf" | "Egyptian")
  ├── Persisted: localStorage + profiles.preferred_dialect
  ├── Pages read via useDialect() hook
  ├── Data queries filter by dialect (where tables have dialect column)
  └── Edge function calls pass dialect param
```

## Step-by-step

### 1. Database Migration
- Add `dialect_module` column to `topics` and `vocabulary_words` (default `'Gulf'`)
- These are the core content tables that need filtering. Other tables (`daily_challenges`, `listening_exercises`, `reading_passages`, `conversation_scenarios`, `grammar_exercises`, `vocab_game_sets`, `interactive_stories`) already have a `dialect` column.

### 2. Create `DialectContext` (new file)
- `src/contexts/DialectContext.tsx`
- State: `activeDialect` — `"Gulf" | "Egyptian"` (expandable later)
- On mount: read from `localStorage`, then from `profiles.preferred_dialect` if authenticated
- `setDialect()` updates both localStorage and profiles table
- Export `useDialect()` convenience hook

### 3. Wrap App with DialectProvider
- In `App.tsx`, wrap everything with `<DialectProvider>`

### 4. Add Module Switcher UI
- **Index.tsx**: Prominent Gulf/Egyptian toggle near the top of the home page
- **Settings.tsx**: Add Egyptian to the DIALECTS array and add a module-level switcher
- **Onboarding.tsx**: Add Egyptian to the DIALECTS array

### 5. Update Data Hooks to Filter by Dialect
- `useTopics()` — add `.eq('dialect_module', activeDialect)` (after migration adds the column)
- `useLessons()` — same filter
- `useAllWords()` — same filter on `vocabulary_words.dialect_module`
- `useDiscoverVideos()` — filter on existing `dialect` column
- Pre-approved content queries in pages (listening, reading, grammar, daily challenges, conversation scenarios, vocab games) — filter by `dialect` column matching active module

### 6. Pass Dialect to All Edge Function Calls
These pages call edge functions without a `dialect` param — add it:
- **GrammarDrills.tsx** → `grammar-drill` — add `dialect` to body
- **DailyChallenge.tsx** → `daily-challenge` — add `dialect` to body
- **ListeningPractice.tsx** → `listening-quiz` — add `dialect` to body
- **ReadingPractice.tsx** → `reading-passage` — add `dialect` to body
- **HowDoISay.tsx** → `how-do-i-say` — add `dialect` to body
- **VocabGames.tsx** — if it calls an edge function, add dialect
- **ConversationSimulator.tsx** → `conversation-practice` — already passes some context; add `dialect` param and filter scenarios by dialect

### 7. Update ConversationSimulator Scenarios
- The current `SCENARIOS` array is all Gulf Arabic. Add Egyptian scenarios (Cairo taxi, Ahwa café, Khan el-Khalili souq, etc.)
- Filter displayed scenarios by `activeDialect`
- Egyptian scenarios use Egyptian Arabic prompts (إزيك، فين، دلوقتي، عايز)

### 8. Update Edge Functions for Egyptian Support
Each function already accepts (or should accept) a `dialect` param. Update the identity/system prompts to handle "Egyptian":
- **`conversation-practice`** — swap Gulf identity for Egyptian identity when dialect is "Egyptian"
- **`daily-challenge`** — Egyptian vocabulary rules
- **`listening-quiz`** — Egyptian vocabulary rules
- **`reading-passage`** — Egyptian vocabulary rules
- **`grammar-drill`** — Egyptian grammar (بتاع, مش, etc.)
- **`how-do-i-say`** — already has dialect param, ensure Egyptian works
- **`translate-jais`** — already dynamic, add Egyptian mapping
- **`weekly-coach`** — accept dialect
- **`generate-story`** — already has dialect param

For Egyptian, the prompt pattern:
```
You are a native Egyptian Arabic (مصري) speaker. Always respond in Egyptian Arabic dialect.
Use authentic Egyptian vocabulary: إزيك، فين، دلوقتي، عايز، كويس، ماشي، يلا، حاضر، بتاع.
Do NOT use Gulf Arabic or MSA.
```

### 9. Update Admin Curriculum Builder
- `DialectSelector.tsx` — add `{ value: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' }`
- Curriculum sessions already scope by `target_dialect` — this just adds the new option

## Files to Create
- `src/contexts/DialectContext.tsx`

## Files to Edit (~25)
**Frontend pages** (add `useDialect()` + pass dialect):
- `src/App.tsx`, `src/pages/Index.tsx`, `src/pages/Settings.tsx`, `src/pages/Onboarding.tsx`
- `src/pages/ConversationSimulator.tsx`, `src/pages/GrammarDrills.tsx`, `src/pages/DailyChallenge.tsx`
- `src/pages/ListeningPractice.tsx`, `src/pages/ReadingPractice.tsx`, `src/pages/HowDoISay.tsx`
- `src/pages/VocabGames.tsx`

**Hooks** (filter by dialect):
- `src/hooks/useTopics.ts`, `src/hooks/useLessons.ts`, `src/hooks/useAllWords.ts`

**Admin**:
- `src/components/admin/curriculum-builder/DialectSelector.tsx`

**Edge Functions** (add Egyptian prompt support):
- `conversation-practice`, `daily-challenge`, `listening-quiz`, `reading-passage`, `grammar-drill`, `how-do-i-say`, `weekly-coach`

## Database Migration
```sql
ALTER TABLE public.topics ADD COLUMN IF NOT EXISTS dialect_module text NOT NULL DEFAULT 'Gulf';
ALTER TABLE public.vocabulary_words ADD COLUMN IF NOT EXISTS dialect_module text NOT NULL DEFAULT 'Gulf';
CREATE INDEX IF NOT EXISTS idx_topics_dialect ON public.topics(dialect_module);
CREATE INDEX IF NOT EXISTS idx_vocab_dialect ON public.vocabulary_words(dialect_module);
```

## Implementation Order
Due to scope, this will be done in phases across multiple messages:
1. **Phase 1**: Context + DB migration + module switcher UI + hook filtering
2. **Phase 2**: Edge function updates + Egyptian conversation scenarios
3. **Phase 3**: Admin curriculum builder updates

