## Goal

Add a second flashcard type to the My Words SRS: a **production** card (see image and/or hear audio → recall the Arabic word). It runs alongside the existing **recognition** card (see Arabic → recall meaning), and each word now contributes **two independently-scheduled cards** to the spaced repetition queue.

A word's production card unlocks only after its recognition card has been successfully reviewed at least once, so users aren't asked to produce a word they haven't seen yet.

## Schema change

Add per-direction SRS state to `user_vocabulary` so each word tracks two schedules. Recognition keeps the existing columns; production gets a parallel set:

- `production_ease_factor numeric default 2.5`
- `production_interval_days integer default 0`
- `production_repetitions integer default 0`
- `production_next_review_at timestamptz` (nullable — null = locked, not yet unlocked by recognition)
- `production_last_reviewed_at timestamptz` (nullable)

(Keeping a single table avoids duplicating word content, audio, image, jingle URLs.)

When a recognition review is rated ≥ "Good" for the first time and `production_next_review_at IS NULL`, set `production_next_review_at = now()` so the production card enters the queue immediately.

## Review queue

`MyWordsReview` builds a unified due list from two queries against `user_vocabulary` for the active dialect:

1. Recognition due: `next_review_at <= now()` → tag each row as `card_type: 'recognition'`.
2. Production due: `production_next_review_at IS NOT NULL AND production_next_review_at <= now()` → tag as `card_type: 'production'`.

Merge, sort by due timestamp, and iterate. The session counter and progress bar count cards (not words).

## Card UI

One component renders both card types based on `card_type`:

**Recognition (unchanged behaviour)**
- Shows Arabic word large, image, audio buttons.
- "Reveal English" button shows the meaning.
- Self-rating buttons schedule the recognition columns.

**Production (new)**
- Hides the Arabic word.
- Shows the image (if any) and a prominent ▶ Play button for `word_audio_url` / TTS fallback.
- Shows the English meaning as the prompt.
- Hint label: "Say the Arabic word."
- "Reveal Arabic" button reveals the Arabic text + plays audio.
- `PronunciationButton` available after reveal so the learner can check themselves.
- Self-rating buttons schedule the `production_*` columns via the same SM-2 logic in `spacedRepetition.ts`.

No autoplay of word audio on production cards before the user taps Play (revealing audio would defeat half the recall — though if the card has no image, autoplay is fine since audio *is* the prompt). Implementation: autoplay only when `image_url` is null.

## SRS update logic

Extend `useUpdateUserVocabularyReview` to accept `cardType: 'recognition' | 'production'` and write to the matching column set. Same `calculateNextReview` math for both.

On a successful recognition rating (≥ Good) when `production_next_review_at IS NULL`, also set `production_next_review_at = now()` in the same update so the production card unlocks.

## Due-count badge

`useUserVocabularyDueCount` updates to count both:
- recognition due (`next_review_at <= now()`)
- production due (`production_next_review_at <= now()`)

Sum for the "due" badge on the My Words tile.

## Files touched

- **Migration**: add 5 production_* columns to `user_vocabulary`.
- `src/hooks/useUserVocabulary.ts` — extend types, due-count query, `useUpdateUserVocabularyReview` to accept `cardType` and unlock-on-first-success logic.
- `src/pages/MyWordsReview.tsx` — dual query + merged queue, conditional production rendering, conditional autoplay.
- (Optional refactor) extract a small `<ReviewCardBody />` so recognition vs production rendering stays readable.

## Out of scope

- No automatic speech grading — pronunciation check stays a manual button.
- No changes to tutor-upload, lessons, or curriculum review flows.
- No changes to vocabulary list / "My Words" landing page beyond the due badge.