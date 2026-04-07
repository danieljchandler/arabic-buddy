

# Add AI Image Generation to My Words Flashcards

## What We're Building
A button on each word in the My Words list that lets users generate an AI picture for their flashcard. Users can optionally describe the image they want; the word itself is always used as context.

## Plan

### 1. Update `UserVocabularyWord` interface
Add `image_url` (and other missing columns like `dialect`, `sentence_text`) to the type in `src/hooks/useUserVocabulary.ts` so the image URL is available in the UI.

### 2. Create an Image Generation Dialog component
New file: `src/components/mywords/GenerateImageDialog.tsx`
- A dialog/sheet with:
  - Preview of the current image (if any)
  - A textarea for optional custom description (e.g., "a red apple on a wooden table")
  - A "Generate" button that calls the existing `generate-flashcard-image` edge function with `word_english`, `word_arabic`, and `custom_instructions`
  - Loading spinner during generation
  - On success: update the `user_vocabulary` row's `image_url` and invalidate the query cache

### 3. Update My Words list UI (`src/pages/MyWords.tsx`)
- Add an image/sparkle icon button on each word row (next to delete)
- Clicking opens the Generate Image Dialog for that word
- If a word already has an image, show a small thumbnail in the row

### 4. Wire up the image update mutation
Add a mutation in `useUserVocabulary.ts` (or inline) that updates `image_url` on the `user_vocabulary` row after successful generation.

## Technical Details
- Reuses the existing `generate-flashcard-image` edge function — no backend changes needed
- Images are stored in the `flashcard-images` storage bucket (already public)
- The edge function requires authentication (already handled via Supabase auth headers)
- The storage path will use `tutor/{user_id}/{uuid}.png` (the function's default)

