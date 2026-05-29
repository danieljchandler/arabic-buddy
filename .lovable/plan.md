## Goal

Make a review session resilient to network drops. Today, if `submitReview.mutateAsync` throws (proxy hiccup, offline, edge timeout), the user's rating is lost and the card stays "due". We'll persist every rating to a local queue immediately, advance the UI optimistically, and retry failed submissions in the background until they succeed.

## Scope

Single flow: `src/pages/Review.tsx` + `useSubmitReview` in `src/hooks/useReview.ts`. Other review surfaces (`MyWordsReview`, `SetPhrasesReview`) are untouched in this pass.

## Behavior

1. User taps a rating button → UI advances to the next card immediately (no awaiting the network).
2. The rating is appended to a localStorage-backed queue keyed by user id (`lahja:review-queue:<userId>`). Each entry stores `{ wordId, rating, currentReview snapshot, queuedAt, attempts }`.
3. A background processor drains the queue:
   - Sends entries one at a time via the existing Supabase update/insert logic.
   - On success: remove from queue, fire the existing XP / streak / achievement side-effects, invalidate `review-stats`.
   - On network-like failure: keep entry, exponential backoff (1s, 2s, 5s, 15s, 60s, then cap at 60s), bump `attempts`.
   - On real server error (4xx other than 408/429): drop the entry, surface a toast so the user knows that one card didn't save.
4. Processor also runs on:
   - Mount of `Review.tsx`
   - `window` `online` event
   - Every successful submit (chain the next one)
5. A small status pill appears in the header when the queue is non-empty: "Saving N…" with a spinner, switching to "Offline – will retry" when `!navigator.onLine`.
6. On unmount / route change with pending items: queue stays in localStorage and resumes next visit.

## Files

- **New** `src/lib/reviewQueue.ts` — typed queue helpers: `enqueue`, `peek`, `shift`, `update`, `all`, `clearForUser`. Pure localStorage, JSON, safe-guarded with try/catch (matches the iframe-storage pattern in memory).
- **New** `src/hooks/useReviewQueue.ts` — singleton-ish hook that owns the drain loop. Exposes `{ enqueue, pendingCount, isOnline, isFlushing }`. Uses the same Supabase write logic currently inside `useSubmitReview.mutationFn`, plus the same XP / achievements side-effects on success.
- **Edit** `src/hooks/useReview.ts` — extract the write logic into a small `submitRatingToServer(user, wordId, rating, currentReview)` helper exported for the queue hook. Keep `useSubmitReview` as a thin wrapper that calls the helper (kept for any future caller, but `Review.tsx` will stop using it).
- **Edit** `src/pages/Review.tsx`:
  - Replace `submitReview.mutateAsync(...)` in `handleRate` with `enqueue({ wordId, rating, currentReview })` and advance the index synchronously.
  - Add the small "Saving N…/Offline" status pill in the header next to the trophy.
  - Remove the `disabled={submitReview.isPending}` on `RatingButtons` (optimistic UX — buttons stay live).

## Technical notes

- Queue entry shape:
  ```ts
  type QueuedRating = {
    id: string;            // uuid
    userId: string;
    wordId: string;
    rating: Rating;
    currentReview: WordReview | null;
    queuedAt: number;
    attempts: number;
  };
  ```
- Network-like error detection reuses the regex already used in `PhraseOfTheDay.tsx`: `/Failed to send|fetch|network|load failed|timeout/i`, plus `!navigator.onLine`.
- The drain loop is a single async function guarded by a `useRef` boolean so concurrent triggers (mount + online event + post-submit) don't double-send.
- XP / `incrementReviews` / `checkAchievements` fire on actual server success, not on enqueue, so totals stay accurate.
- `useDueWords` is refetched only after the queue fully drains (or when the user reaches end of list, as today) — this avoids a re-fetch yanking the card list mid-session.

## Out of scope

- Conflict resolution if two devices review the same word offline simultaneously (last-write-wins, same as today).
- Migrating `MyWordsReview` / `SetPhrasesReview` to the same queue — can follow once this pattern proves out.
