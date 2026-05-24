
# Alphabet Journey

An engaging, full-scope way for absolute beginners to learn the Arabic alphabet — a 28-stop map where each letter unlocks a mini-lesson with several bite-sized games. MSA-by-default audio with a "hear in dialect" toggle.

## What the user experiences

1. **Entry point** — New tile on Home: "Alphabet Journey 🐪" (locked behind nothing — beginner-friendly). Also a CTA on Today when the user has 0 letters mastered.
2. **The Map** — A vertical, scrollable Sadu-patterned caravan trail with 28 stops (ا → ي). Each stop shows the letter in its isolated form, a progress ring, and a state: locked / available / mastered. Mastered stops get a small palm-tree flag.
3. **Letter Stop** — Tapping a stop opens a 6-step mini-lesson:
   - **Meet the letter** — Big animated letter + native audio (name + sound). Toggle: MSA name ↔ dialect pronunciation.
   - **Hear & See** — 3–4 real words starting with this letter, each with image + audio (reused from existing vocab pipeline).
   - **Trace it** — SVG stroke-by-stroke tracing on canvas, finger/stylus, with stroke-order guides. Confetti on completion.
   - **Four Faces** — Shows the letter in isolated / initial / medial / final forms with example words; tap any form to hear it.
   - **Spot the Letter** — Game: 6 short Arabic words flash; tap the ones containing the target letter. Scored 0–100.
   - **Sound Match** — Game: hear an audio clip, choose the correct letter from 4 options.
   Completing all 6 steps awards XP, marks the letter mastered, and unlocks the next stop.
4. **Boss rounds** — Every 7 letters: a "Caravan Checkpoint" mixing all letters learned so far (sound match + spot-the-letter from a larger pool). Awards bonus XP + a badge.
5. **Daily Alphabet Drill** — A 60-second mixed-mastered-letters game accessible from Today + the map header. Feeds into streak/XP.

## Why it's engaging

- **Tactile** — tracing is the dopamine hit; nothing else in the app has it.
- **Visible progress** — caravan trail, palm flags, checkpoints.
- **Reuses existing strengths** — vocab cards, audio pipeline, XP/streaks, SRS-ish review.
- **Short loops** — every step is ≤ 30 seconds; a whole letter takes ~3 minutes.

## Technical details

### Data model (new tables)

- `arabic_letters` (seed table, 28 rows) — `code` (e.g. `alif`), `isolated`, `initial`, `medial`, `final`, `name_ar`, `name_translit`, `sound_ipa`, `stroke_svg` (string array of SVG path d-attrs in stroke order), `order_index`, `example_words` (jsonb: 3–4 `{ word_ar, translit, en, image_url, audio_url }`).
- `user_letter_progress` — `user_id`, `letter_code`, `steps_completed` (jsonb bitmask of the 6 steps), `best_spot_score`, `best_sound_score`, `mastered_at`, `last_practiced_at`. RLS: user can only read/write own rows.
- `user_checkpoint_progress` — `user_id`, `checkpoint_index` (1..4), `score`, `completed_at`. RLS same.

### Letter audio

- One row per letter, two audio URLs: `audio_msa_url` and `audio_dialect_url` (per active dialect — stored as jsonb `{ gulf, egyptian, yemeni }`).
- Generated once via existing TTS pipeline (Azure for MSA + dialects; Munsit for Gulf) and stored in the existing `audio` bucket. Pre-seeded — no per-user generation.

### Stroke SVGs

- Hand-authored once for the 28 base shapes (28 SVGs total, each is an ordered list of path `d` strings). Stored in a static TS file `src/data/letterStrokes.ts` to avoid DB bloat. Tracing component renders them, animates a guide stroke, and compares user pointer path to expected path via cheap point-sampling.

### Routes & files (new)

- `src/pages/AlphabetJourney.tsx` — the map.
- `src/pages/AlphabetLetter.tsx` — the 6-step lesson runner (route `/alphabet/:letterCode`).
- `src/pages/AlphabetCheckpoint.tsx` — boss round (`/alphabet/checkpoint/:index`).
- `src/components/alphabet/LetterTracer.tsx` — SVG stroke tracing canvas.
- `src/components/alphabet/SpotTheLetterGame.tsx`
- `src/components/alphabet/SoundMatchGame.tsx`
- `src/components/alphabet/FourFacesPanel.tsx`
- `src/components/alphabet/CaravanMap.tsx`
- `src/hooks/useAlphabetProgress.ts` — fetch/update progress.
- `src/data/letterStrokes.ts` — stroke path data.
- Route registration in `src/App.tsx`; Home tile entry in `src/pages/Index.tsx` + `featureHints`/`pageHints` entries.

### Reused systems

- TTS: existing `useAzureTTS` + Munsit edge function for dialect Gulf.
- Display prefs: respect global "hide English by default" — translit/EN gated by toggle as on other modules.
- XP/streaks: `useGamification.awardXp` per completed step + checkpoint.
- Design: digital majlis tokens, Sadu pattern asset already in `public/assets/sadu-tile.svg`.

### Edge functions (new)

- `alphabet-seed` (admin-only, one-off) — generates MSA + dialect audio for all 28 letters via Azure/Munsit and uploads to the `audio` bucket, then writes `arabic_letters` rows. Run once, not user-facing.

### Out of scope (v1)

- Handwriting recognition beyond simple path-sampling (no ML model).
- Diacritics (tashkil) mini-module — separate follow-up.
- Letter-combination/ligature drills (e.g. لا) — follow-up.

## Migration summary

- New tables: `arabic_letters` (admin-managed seed), `user_letter_progress`, `user_checkpoint_progress`.
- RLS: `arabic_letters` readable by everyone; user progress tables scoped to `auth.uid()`.

## Rollout

1. Migration + seed edge function + stroke data.
2. Map page + letter lesson runner with steps 1, 2, 4 (no games yet).
3. Tracer (step 3).
4. Two games (steps 5, 6) + checkpoints.
5. Today integration + daily drill.
