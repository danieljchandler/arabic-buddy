# Set Phrases Practice Module

A new learning module for **situational/social Arabic phrases** — greetings, weddings, funerals, Eid, hospitality, condolences, congratulations, etc. — practiced through voice and choice quizzes with spaced repetition.

**ASR change:** Voice answers use **Munsit** (primary ASR per project memory), not Azure. Azure remains only as a last-resort fallback if Munsit fails.

## What the user gets

A new tile on the home screen → **Set Phrases**. Inside:

1. **Browse by Occasion** — categories (Greetings, Eid, Wedding, Funeral / Condolences, New Baby, Travel, Food/Hospitality, Religious, Daily Courtesy, Apologies/Thanks, etc.) with a difficulty ladder (A1 → C1).
2. **Practice Session** — mixed quiz of two question types:
   - **Reply quiz**: AI plays/shows a phrase ("صباح الخير") → user must give the correct reply by voice or by tapping the right option.
   - **Scenario quiz**: AI narrates a situation in English ("A friend's father just passed away — what do you say?") → user picks or speaks the appropriate Arabic phrase.
3. **Voice answers via Munsit** — record short utterance, send to existing Munsit ASR pipeline, normalize/diacritic-strip both sides, then fuzzy-match to the canonical phrase.
4. **Save phrases I don't know** — a "Save to my phrases" button on every card; saved phrases enter SRS review.
5. **SRS Review** — separate review queue using SM-2 (same algorithm as `useUserVocabulary`), surfacing previously-studied phrases at increasing intervals (1d → 3d → 7d → 14d → 30d → 90d).
6. **Progressive difficulty** — sessions start with A1 essentials and only unlock harder tiers once the easier ones are mostly retained (≥80% recall).

## Page structure

```text
/set-phrases                  → SetPhrases.tsx        (occasion grid + Continue Review CTA)
/set-phrases/practice         → SetPhrasesPractice.tsx (mixed quiz session)
/set-phrases/review           → SetPhrasesReview.tsx   (SRS queue)
/set-phrases/:occasion        → OccasionDetail.tsx    (browse all phrases in category)
/admin/set-phrases            → AdminSetPhrases.tsx
/admin/set-phrases/:id        → AdminSetPhraseForm.tsx
```

## Data model (new tables)

```text
set_phrase_occasions
  id, slug, name, name_arabic, description, icon_name,
  display_order, dialect, difficulty_floor (A1..C1)

set_phrases
  id, occasion_id, dialect,
  phrase_arabic, phrase_transliteration, phrase_english,
  phrase_audio_url,                 -- pre-generated TTS
  reply_arabic, reply_transliteration, reply_english,
  reply_audio_url,
  scenario_english,                 -- "Someone just sneezed"
  cultural_note,
  formality (casual|neutral|formal|religious),
  difficulty (A1..C1),
  accepted_variants jsonb,          -- alt acceptable replies for ASR matching
  cached_distractors jsonb,         -- AI-generated wrong-but-plausible options
  tags[], status (draft|published)

user_set_phrases    -- SRS state, mirrors user_vocabulary
  user_id, phrase_id, source (quiz_miss|manual_save|reviewed),
  ease_factor, interval_days, repetitions, next_review_at,
  last_reviewed_at, last_quality (0..5)

set_phrase_quiz_attempts
  user_id, phrase_id, question_type (reply|scenario),
  answer_mode (voice|choice), correct boolean,
  asr_transcript text null, asr_similarity numeric null,
  created_at
```

RLS: admins manage `set_phrase_occasions` / `set_phrases`; users CRUD only their own rows in `user_set_phrases` and `set_phrase_quiz_attempts`. Public reads `status='published'`. `interval_days` integer per existing SRS constraint.

## AI setup (the part to get right)

### Edge function `generate-set-phrase-quiz` (selection + scenario AI)

**Inputs:** user id, dialect, occasion (optional), session length (default 8).

**Selection logic (deterministic, not AI):**
1. Pull due `user_set_phrases` for this user (up to 50% of session).
2. Fill remaining with new published phrases at the user's CEFR tier, weighted toward the requested occasion. Skip already-mastered (`repetitions ≥ 4 AND interval_days ≥ 30`).
3. Per phrase, randomly assign `reply` or `scenario` — `reply` only if `reply_arabic` exists; `scenario` only if `scenario_english` exists.

**For `scenario` questions** missing curated text, call Lovable AI (`google/gemini-3-flash-preview`) with strict tool-calling schema:

```text
generate_scenario({
  scenario_english: string,           // 1–2 sentences, vivid, culturally specific
  distractor_phrases: [               // 3 wrong but plausible Arabic phrases
    { arabic, english, why_wrong }
  ]
})
```

System prompt rules (locked server-side):
- Dialect lock via existing `_shared/dialectHelpers.ts` — forbid MSA and cross-dialect leakage.
- Distractors must be **real Arabic phrases used in other contexts** so the test rewards situational understanding.
- Never invent the correct phrase — correct answer is always the curated `phrase_arabic`.
- Cultural sensitivity gate (no flippant funeral/religious scenarios).
- Cache the result back into `set_phrases.cached_distractors` so the next session is instant.

### Edge function `score-set-phrase-voice` (Munsit ASR + similarity)

**Inputs:** audio blob (webm/wav), expected `phrase_id`.

Flow:
1. Transcribe with **Munsit** (`api.munsit.com`, dialect-routed voice locale per existing `MUNSIT_API_KEY`).
2. If Munsit returns 5xx/timeout → fallback to Soniox (per existing ASR priority memory). Azure last.
3. Normalize both transcript and `phrase_arabic` + `accepted_variants`: strip tashkeel, normalize alef/yaa/taa marbuta, collapse whitespace.
4. Score = max similarity (Levenshtein-based) across canonical + variants.
5. Map to quality:
   - ≥0.9 → quality 5 (perfect)
   - 0.75–0.9 → quality 4 (good)
   - 0.55–0.75 → quality 3 ("close, try again" → one retry allowed)
   - <0.55 → quality 1–2 (wrong, reveal answer)
6. Return `{ transcript, similarity, quality, accepted: bool }`.

Choice answers map straight: correct first try = 5, after reveal = 2, wrong = 1.

**Reliability:** 25s overall ASR timeout; 30s on AI scenario gen; on either failure surface a clean choice-only fallback so the session never blocks.

## UI flow

**Practice screen (mobile-first, max-w-sm, digital majlis style):**
- Top: progress dots + occasion chip + difficulty badge.
- Card body:
  - **Reply mode:** big Arabic phrase + 🔊 play; "Your reply:" with mic button (hold-to-talk → Munsit) and a "Show choices" toggle revealing 4 options.
  - **Scenario mode:** English scenario in muted text + mic + "Show choices" toggle.
- After answer: reveal correct Arabic + transliteration (respect global English/transliteration toggles), play audio, expandable cultural note, ⭐ "Save to my phrases" button. Show ASR transcript + similarity score when voice was used so the user understands why.
- Footer: Skip / Next.

**Review screen:** identical card UI but pulls only due `user_set_phrases`; ends with summary (X reviewed, Y mastered, next due …).

**My Phrases:** tab inside `/set-phrases` showing saved phrases, due count, search/filter by occasion.

## Admin

- `AdminSetPhrases` list filtered by current dialect (existing `DialectContext`), grouped by occasion, status pill.
- `AdminSetPhraseForm`: all fields above + 🔊 Generate Audio (TTS — Munsit Aisha for Gulf, Azure voices for Egyptian/Yemeni per existing speech-synthesis memory) + ✨ AI Suggest button to fill `scenario_english` + `cached_distractors` + `accepted_variants`.
- "Seed occasions" one-click action that asks AI to draft 10 phrases per occasion in the active dialect, written as `status='draft'` — no auto-publish (matches curated workflow rule).

## Suggested extras (light cost, worth doing now)

- **Streaks & XP** — wire into existing gamification. Voice-correct ≥0.9 = 10 XP, choice-correct = 5 XP.
- **Daily 3-phrase warmup** card on home screen for one-tap practice.
- **Formality filter** — let user toggle "show only formal/religious".
- **Dialect comparison** — when a phrase exists in multiple dialects, link to existing `DialectCompare` page.

## Out of scope

- Free-form conversation (already covered by `ConversationSimulator`).
- On-the-fly TTS for every phrase — pre-generate during admin curation for zero-latency practice.
- Offline mode.

## Files to create

- Migration: `set_phrase_occasions`, `set_phrases`, `user_set_phrases`, `set_phrase_quiz_attempts` (+ RLS, integer `interval_days` constraint, `update_updated_at` triggers).
- `supabase/functions/generate-set-phrase-quiz/index.ts` — selection + scenario/distractor AI.
- `supabase/functions/score-set-phrase-voice/index.ts` — **Munsit-first** transcription + similarity scoring.
- `supabase/functions/seed-set-phrases/index.ts` — admin bulk-draft seeder.
- `src/hooks/useSetPhrases.ts`, `useUserSetPhrases.ts`, `useSetPhraseSession.ts`.
- `src/lib/arabicNormalize.ts` (shared normalization for ASR matching, if not already present).
- `src/pages/SetPhrases.tsx`, `SetPhrasesPractice.tsx`, `SetPhrasesReview.tsx`, `OccasionDetail.tsx`.
- `src/pages/admin/AdminSetPhrases.tsx`, `AdminSetPhraseForm.tsx`.

## Files to edit

- `src/App.tsx` — register routes.
- `src/pages/Index.tsx` — add Set Phrases tile.
- `src/pages/admin/Dashboard.tsx` — add admin tile.
- `mem://index.md` + new `mem://features/set-phrases/overview` after build.

## Open questions (will assume defaults if unanswered)

1. Keep SRS in a separate `user_set_phrases` table (vs reusing `user_vocabulary`)? Default: **separate**, so phrase-specific fields stay clean.
2. Starter occasions: Greetings, Eid, Wedding, Funeral/Condolences, New Baby, Travel/Safe-trip, Hospitality/Food, Religious, Apologies, Thanks, Sneeze/Health, Compliments. Default: **all of these**.
3. Voice required or optional per question? Default: **optional** (mic OR choice always available).
