# Grammar Points in Discover Feed

## Current state
- `discover_videos.grammar_points` (jsonb) already exists and is populated once during `process-approved-video` (title, explanation, examples).
- These points are **not displayed anywhere** in the app and have no CEFR level tag.

## What we'll build

### 1. Display grammar points in the video page
In `src/pages/DiscoverVideo.tsx`, add a "Grammar Notes" collapsible section next to "Key Vocabulary":
- Each card shows: title, explanation, 1–2 example lines (Arabic + English), and a CEFR badge (A1–C2).
- Filter to the user's level by default (via `useUserLevel`): show points at or one level below the user's CEFR. A "Show all levels" toggle reveals the rest.
- Empty state: "No grammar notes yet" with a Generate button.

### 2. New edge function `extract-grammar-points`
Inputs: `{ video_id, target_level, count? }`. Behavior:
- Loads the video's transcript + existing `grammar_points[].title` list.
- Calls Lovable AI (`google/gemini-3-flash-preview`) with the dialect rulebook context already used by `aiBrain`, instructing it to:
  - Tag each point with a `cefr_level` matching `target_level` (A1/A2 = simple patterns: negation, pronouns, basic verb prefixes; B1/B2 = aspect markers, dialect particles, conditional; C1/C2 = nuanced register/idiomatic syntax, MSA contrasts).
  - **Exclude any title already present** (dedup list passed in prompt + post-check by normalized title).
  - Return 3–5 new points with `title`, `explanation`, `examples` (lines from transcript), `cefr_level`.
- Appends results to `discover_videos.grammar_points` via service role.
- Returns the appended array.

### 3. "Generate more" button (user)
Visible to any signed-in user in the Grammar Notes section. Calls `extract-grammar-points` with their `placement_level`. Loading state + toast on success/error. Invalidates the video query so new points appear.

### 4. Admin generator
In `src/pages/admin/AdminVideoForm.tsx`, add a "Generate grammar points" button row with a level selector (A1–C2). Same edge function. Admin can run repeatedly to broaden coverage across levels.

### 5. Update initial extraction (optional, light touch)
In `process-approved-video`, extend the existing grammar prompt to also output `cefr_level` per point so newly processed videos are level-tagged from day one. Existing rows without a level fall back to the video's `difficulty` mapping when filtering.

## Files
- `supabase/functions/extract-grammar-points/index.ts` (new, `verify_jwt = true`)
- `supabase/functions/process-approved-video/index.ts` (add `cefr_level` to grammar prompt + schema)
- `src/hooks/useDiscoverVideos.ts` (type addition for `cefr_level`)
- `src/pages/DiscoverVideo.tsx` (Grammar Notes section, generate button, level filter)
- `src/pages/admin/AdminVideoForm.tsx` (admin generate control)
- `supabase/config.toml` (register new function)

## Non-goals
- No schema migration (reusing existing `grammar_points` jsonb column).
- No SRS / flashcards for grammar in this pass — just display + generation. Can be added later.
