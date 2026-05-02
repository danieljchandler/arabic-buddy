## Goal

Add a new vocabulary mode called **Picture Scenes**. AI picks a theme, AI picks the vocabulary words, and AI generates a single themed image showing all those objects. Admin reviews & publishes from the existing **Curriculum Builder** chat. Learners then explore the scene (tap object → hear word) and get quizzed (tap the named object). Words auto-add to their flashcards for the active dialect, with per-dialect deduplication.

## Flow

```text
Admin → Curriculum Builder chat → "Generate picture scene: Kitchen, A1"
    ↓
curriculum-chat edge function (existing)
    ↓ tool-call returns { theme, words[8-12] }
    ↓ then calls google/gemini-3-pro-image-preview to render the scene
    ↓ then calls a vision pass (gemini-2.5-pro) to detect each word's bounding box on the image
    ↓ persists everything as a draft picture_scene + hotspots
ChatWindow renders a new PictureScenePreviewCard
    ↓ admin can regenerate image, edit words, nudge hotspots, then "Approve & Publish"
        ↓ inserts into curriculum_chat_approvals (approval_type = 'picture_scene')

Learner → /picture-scenes → tap a published scene
    ↓ Explore: tap any hotspot → plays Arabic TTS, shows word
    ↓ Quiz: prompt "اضغط على X" → user taps; correct = within radius
    ↓ Result: bulk-upsert all words into user_vocabulary for active dialect
              (skip duplicates via UNIQUE (user_id, word_arabic, dialect))
```

## Database

**Migration:**

1. **`user_vocabulary`** — drop `UNIQUE (user_id, word_arabic)`, add `UNIQUE (user_id, word_arabic, dialect)`. Required so the same Arabic word can exist once per dialect (matches the project's per-dialect rule) and so bulk-upsert can safely skip duplicates.

2. **`picture_scenes`** (admin-managed, public read when published)
   - `id`, `dialect`, `theme`, `title`, `title_arabic`, `description`, `image_url`, `cefr_level`, `display_order`, `status` ('draft'|'published'), `session_id` (FK curriculum chat session, nullable), `created_by`, `created_at`, `updated_at`

3. **`picture_scene_hotspots`**
   - `id`, `scene_id` FK (cascade), `word_arabic`, `word_english`, `root` (nullable), `word_audio_url` (nullable), `x_pct`, `y_pct`, `radius_pct` (default 8), `display_order`

4. **`user_picture_scene_progress`**
   - `id`, `user_id`, `scene_id`, `last_score`, `last_total`, `completed_at`, `last_played_at`; `UNIQUE (user_id, scene_id)`

RLS mirrors existing tables: `interactive_stories` for scenes, `story_progress` for user progress.

## Edge functions

### Modified: `supabase/functions/curriculum-chat/index.ts`
- Add a new tool `generate_picture_scene` to the tool registry. When the LLM calls it (or admin asks for "picture scene"), the function:
  1. Calls Lovable AI with a structured-output tool-call to pick `{ theme, title, title_arabic, words: [{word_arabic, word_english, root}] }` (8–12 concrete, image-able nouns appropriate to the requested CEFR + dialect).
  2. Calls `google/gemini-3-pro-image-preview` via the Lovable gateway with a prompt enforcing the existing flashcard image style (warm sand background, photo-realistic, no text overlays) and an explicit list "show: bread, tea cup, kettle, …". Uploads PNG to `flashcard-images/picture-scenes/{sceneId}.png`.
  3. Calls `google/gemini-2.5-pro` (multimodal) with the rendered image + word list, returning structured `[{ word_arabic, x_pct, y_pct, radius_pct }]` bounding-box centers for each word it can locate. Words it cannot find are kept with `x_pct=null` so the admin can place them.
  4. Inserts a draft `picture_scenes` row + hotspots, returns the scene id in `structured_output` so `ChatWindow` can render the preview card.
- Output type: `picture_scene` saved on the assistant message.

### New: `supabase/functions/regenerate-scene-image/index.ts` (admin only, JWT verified)
- Input `{ sceneId, customInstructions? }`. Re-renders the image keeping the same word list, updates `image_url`, optionally re-runs the vision pass to refresh hotspot coords.

### New: `supabase/functions/generate-scene-audio/index.ts` (admin only, JWT verified)
- Input `{ sceneId }`. For every hotspot missing `word_audio_url`, calls existing `munsit-tts` (Gulf) or `azure-tts` (Egyptian/Yemeni) per the project's dialect→TTS routing, uploads to `flashcard-audio` bucket, saves URL.

All three deploy with `verify_jwt = true`; only admins can invoke.

## Curriculum Builder integration

- **`ChatInput`**: add a quick-action chip "🖼️ New Picture Scene" alongside existing chips. It sends a structured prompt like *"Generate a picture scene for theme: Kitchen, level A1"*.
- **New component `src/components/admin/curriculum-builder/PictureScenePreviewCard.tsx`** (mirrors `VocabPreviewCard`):
  - Renders the generated image with circle overlays for each hotspot.
  - Word list with inline edits (Arabic, English) and a "+" to add a missing word, "🗑️" to remove.
  - Drag handles to nudge hotspot positions; click on image to drop a new hotspot for the selected word.
  - Buttons: "🔁 Regenerate image", "🔊 Generate audio", "✅ Approve & Publish".
  - Approve calls `useCurriculumApproval.approvePictureScene(sceneId)` → flips `status` to `published` and writes a `curriculum_chat_approvals` row with `approval_type = 'picture_scene'`.

## Learner UI (new pages)

- **`/picture-scenes`** (`src/pages/PictureScenes.tsx`) — grid of published scenes for the active dialect, digital-majlis card style, completion checkmark from `user_picture_scene_progress`.
- **`/picture-scenes/:id`** (`src/pages/PictureScenePlayer.tsx`)
  - **Explore phase**: image with subtle dot markers; tap a hotspot → plays `word_audio_url` (falls back to `useAzureTTS`), shows Arabic word; English hidden behind the global immersion toggle.
  - **Quiz phase**: hotspots invisible; top prompt "اضغط على {word}" with replay-audio button; user taps → point-in-circle test against `(x_pct, y_pct, radius_pct)`. Wrong tap = shake + reveal correct after 2 misses. All hotspots in shuffled order.
  - **Result phase**: score + "Add words to my flashcards" runs automatically and shows a toast like "Added 7 new words, 3 already in your list." Then writes `user_picture_scene_progress`.
- Add a "Picture Scenes" tile on Home / Learn for the active dialect's next unplayed scene.

## Hooks

- **New** `src/hooks/usePictureScenes.ts`: `usePublishedScenes(dialect)`, `useScene(id)`, `useCompleteScene()`, admin: `useDraftScenes`, `useUpdateScene`, `useUpdateHotspot`, `useApproveScene`.
- **Edit** `src/hooks/useUserVocabulary.ts`: add `useBulkAddUserVocabulary()` that calls `.upsert(rows, { onConflict: 'user_id,word_arabic,dialect', ignoreDuplicates: true }).select()` and returns `{ added, skipped }`.
- **Edit** `src/hooks/useCurriculumApproval.ts`: add `approvePictureScene` mutation.

## Files to create / change

**Create**
- `supabase/functions/regenerate-scene-image/index.ts`
- `supabase/functions/generate-scene-audio/index.ts`
- `supabase/migrations/<ts>_picture_scenes.sql`
- `src/components/admin/curriculum-builder/PictureScenePreviewCard.tsx`
- `src/components/picture-scenes/SceneCanvas.tsx` (shared explore/quiz renderer)
- `src/hooks/usePictureScenes.ts`
- `src/pages/PictureScenes.tsx`
- `src/pages/PictureScenePlayer.tsx`

**Edit**
- `supabase/functions/curriculum-chat/index.ts` — add `generate_picture_scene` tool, image render + vision-locate steps, persist draft scene
- `supabase/config.toml` — `verify_jwt = true` for the two new admin functions
- `src/hooks/useCurriculumApproval.ts` — add `approvePictureScene`
- `src/hooks/useUserVocabulary.ts` — add `useBulkAddUserVocabulary`
- `src/components/admin/curriculum-builder/ChatInput.tsx` — add quick chip
- `src/components/admin/curriculum-builder/ChatWindow.tsx` — render `PictureScenePreviewCard` when `output_type === 'picture_scene'`
- `src/App.tsx` — register `/picture-scenes` and `/picture-scenes/:id` routes
- `src/pages/Learn.tsx` (or Home tile location) — surface entry point

## Out of scope (v1)

- Multi-image scenes / pan-and-zoom.
- Per-user image personalization (everyone sees the same admin-approved image).
- Speech-to-image quizzes (tap-only for now).
- Auto-translation between dialects of the same scene — each scene belongs to exactly one dialect.
