

# Add Image Generation to Curriculum Flashcards (with Consistent Style)

## Overview
Add "Generate Image" and "Generate All Images" buttons to the LessonWords admin page. The image generation prompt will enforce a consistent visual style across all flashcard images.

## Changes

### 1. `src/pages/admin/LessonWords.tsx` — Add image generation UI
- Add "Generate All Images" button in the header (processes words missing images sequentially with 2s delay)
- Add per-card "Generate Image" button where `image_url` is null, and "Regenerate" on cards with images
- Loading spinner per card during generation
- Progress toast for bulk generation ("Generating 3/8...")
- On success, update `vocabulary_words.image_url` and invalidate query

### 2. `supabase/functions/generate-flashcard-image/index.ts` — Add style consistency prompt
Update the base prompt to enforce a unified visual template:

```
A single realistic, professional photograph of: {word_english}.
STYLE GUIDE — follow exactly for every image:
- Photo-realistic stock photo style, centered subject
- Warm neutral background: soft beige, cream, or light wood surface
- Soft diffused lighting, slightly warm color temperature
- Clean minimal composition with no clutter or secondary objects
- Subject fills roughly 60-70% of the frame
- Shallow depth of field with gentle bokeh on background
- No text, labels, watermarks, or overlays
- Consistent color grading: warm highlights, soft shadows
```

This replaces the current shorter prompt so every generated image matches the same aesthetic regardless of subject matter.

### 3. No other changes needed
The edge function already handles auth, storage upload, retries, and public URL generation. LessonWords just needs the trigger UI.

## Files to edit
- `src/pages/admin/LessonWords.tsx`
- `supabase/functions/generate-flashcard-image/index.ts`

