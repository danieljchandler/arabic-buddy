

# Fix: Review Flashcard Double-Skip Bug

## Problem
When you rate a word, it skips forward by two instead of one. This happens because:
1. Rating a word increments the card index by 1 (moving to the next card)
2. The mutation's success handler immediately invalidates and refetches the word list
3. The refetched list no longer contains the just-reviewed word (it's no longer "due")
4. The index now points one position too far in the shorter list — skipping a card

This also causes the `Cannot read properties of undefined (reading 'dialect_module')` crash when the index overshoots the array.

## Fix (2 files)

### 1. `src/hooks/useReview.ts` — Stop auto-invalidating during review
Remove the `queryClient.invalidateQueries({ queryKey: ['due-words'] })` from `useSubmitReview`'s `onSuccess`. The Review page already manages its own index and calls `refetch()` when it reaches the end of the list. Invalidating mid-session is what causes the list to shrink under the component.

Keep the `review-stats` invalidation (harmless — it doesn't affect the card list).

### 2. `src/pages/Review.tsx` — Add safety guards
- Add a guard so that if `currentIndex` is out of bounds after a refetch, it resets to 0
- Add null-check on `currentWord` before rendering to prevent the `dialect_module` crash
- Capture the current word reference before awaiting the mutation in `handleRate` to avoid stale reads

### 3. `src/pages/MyWordsReview.tsx` — Same pattern fix
- The `useUpdateUserVocabularyReview` hook invalidates `["user-vocabulary"]` on success, which could cause the same issue if query keys aligned. Add the same index-bounds guard after refetch.
- Add null-safety on `currentWord` access.

## No database or edge function changes needed.

