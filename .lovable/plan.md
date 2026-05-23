# Leech Detection + AI Memorization Helpers

When a flashcard gets failed repeatedly (Anki-style "leech"), surface an inline helper that can generate either an **AI mnemonic** or an **AI-generated song/jingle** to help the user remember it.

## 1. Track lapses (DB)

Migration adds lapse tracking to both SRS tables:

- `user_vocabulary`: `lapses INT DEFAULT 0`, `production_lapses INT DEFAULT 0`, `is_leech BOOLEAN DEFAULT false`, `mnemonic TEXT NULL`
- `user_phrases`: `lapses INT DEFAULT 0`, `is_leech BOOLEAN DEFAULT false`, `mnemonic TEXT NULL`

(Phrases already have `jingle_audio_url` only on words; we'll reuse existing `jingle_audio_url` column on `user_vocabulary` and add one to `user_phrases`.)

## 2. Leech logic

In `src/lib/spacedRepetition.ts` and the review save paths (`MyWordsReview.tsx`, `MyPhrasesReview.tsx`):

- On rating = **Again**, increment `lapses` (and `production_lapses` for the production side).
- When `lapses >= 8` (Anki default), mark `is_leech = true`.
- Threshold is a const so we can tune (e.g. 6).

## 3. UI: "Stuck on this one?" panel

In `ReviewCard` (and the phrase review card), when `is_leech === true` show a small Desert-Red accented panel under the answer reveal with two buttons:

- **Generate mnemonic** — calls new edge function, displays returned text, saves to `mnemonic` column so it persists across reviews.
- **Generate jingle** — for words, reuses existing `generate-word-jingle`; for phrases, a sibling function `generate-phrase-jingle`. Plays inline and saves `jingle_audio_url`.

If a mnemonic / jingle already exists on the card, show them directly with a "Regenerate" affordance instead of the generate buttons.

A subtle "Leech" badge appears on the card header so the user knows why the helper is showing.

## 4. New edge function: `generate-mnemonic`

- Input: `{ arabic, english, transliteration?, dialect, kind: "word"|"phrase" }`
- Calls Lovable AI Gateway (`google/gemini-3-flash-preview`) with a tight system prompt:
  - Produce **one** short English mnemonic (≤ 2 sentences).
  - Use a sound-alike / image-link technique tying the Arabic pronunciation to the English meaning.
  - No transliteration of the Arabic; no MSA substitutions; respect dialect.
- Returns `{ mnemonic: string }`. Caller persists it.

## 5. Optional: leech surfacing in review hub

On `MyWords.tsx` review panel, add a small "Leeches: N" chip linking to a filtered review session (`?filter=leeches`) that only queues cards with `is_leech = true`. Out of scope if you want the smaller version first — flag this in the plan as **optional follow-up**.

## Technical notes

- Migration is additive only; defaults keep existing rows safe.
- Backfill is unnecessary — `lapses` starts at 0; cards naturally become leeches as users keep failing them.
- Reuse existing Lovable AI gateway pattern (see `huggingface.ts` / other edge functions).
- Jingle generation for phrases mirrors `generate-word-jingle` (Lyria via GEMINI_API_KEY per memory).
- All new columns covered by existing per-user RLS policies on the two tables (they're owned-by-user_id).

## Files touched

- `supabase/migrations/<new>.sql` — add columns
- `supabase/functions/generate-mnemonic/index.ts` — new
- `supabase/functions/generate-phrase-jingle/index.ts` — new (mirrors word jingle)
- `src/lib/spacedRepetition.ts` — return `lapses`, `isLeech`
- `src/pages/MyWordsReview.tsx`, `src/pages/MyPhrasesReview.tsx` — persist lapses/leech, pass into card
- `src/components/review/ReviewCard.tsx` (+ phrase equivalent) — leech helper panel
- `src/components/review/LeechHelperPanel.tsx` — new shared component
- `src/pages/MyWords.tsx` — (optional) leech count chip
