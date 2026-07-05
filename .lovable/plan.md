# Fix repetitive Phrase of the Day

## Problem
`supabase/functions/phrase-of-the-day/index.ts` uses a single generic prompt ("vary the topic each day") with the date as a seed. The AI has no memory of what it produced yesterday or last week, so it gravitates to the same handful of "safe" greetings/pleasantries. There is also no category rotation and no avoid-list, so ensemble strategy converges on similar outputs.

## Fix (edge function only — no UI/schema changes)

1. **Category rotation.** Define a broad topic wheel in the function (~25 categories: food & coffee, weather, driving/traffic, work complaints, family teasing, shopping/haggling, weekend plans, sports, tech frustrations, health, compliments, apologies, sarcasm, kids, majlis small talk, travel, directions, prayer times, hospitality, gossip, dua/well-wishes, idioms, proverbs, expressions of surprise, expressions of doubt, etc.). Pick one deterministically from the seed (`hash(dialect + date) % categories.length`) so each day gets a different bucket per dialect, but also accept an optional `category` override from the client for the Refresh button to force a different bucket.

2. **Recent-phrase avoid list.** Query the last ~30 phrases produced for this dialect and inject their Arabic + English into the prompt as a "DO NOT repeat or paraphrase these" list. Source options:
   - `user_phrases` where `source = 'phrase-of-the-day'` and `dialect = ?`, ordered by `created_at desc limit 30` (service client, aggregated across users — reflects what the feature has been emitting).
   - Fallback: none, if table empty.

3. **Stronger prompt.** Rewrite the user prompt to:
   - State the chosen category explicitly ("Today's category: **haggling in the souq**").
   - Require the phrase be idiomatic to the dialect (not something a textbook would print).
   - Forbid the generic greeting/pleasantry bucket unless that's the rolled category.
   - Encode the avoid list.
   - Ask for 4–10 words, not 3–8, to allow more expressive phrases.

4. **Sampling.** Bump `temperature` from `0.8` to `1.0` and switch `strategy` from `'ensemble'` (which averages toward safe answers) to `'solo'` with a random model pick from the phrase-suitable pool, or keep ensemble but add `diversityHint` to the prompt. Simpler: `strategy: 'solo'`, `temperature: 1.0`.

5. **Client cache.** In `src/components/PhraseOfTheDay.tsx`, extend the localStorage cache key to include the rolled category so a manual Refresh (which now sends a different category) doesn't collide with the cached daily entry. Keep the daily auto-fetch behavior identical.

## Files to edit
- `supabase/functions/phrase-of-the-day/index.ts` — categories, avoid-list query, prompt rewrite, sampling change.
- `src/components/PhraseOfTheDay.tsx` — pass `category` on refresh, adjust cache key. No visual changes.

## Out of scope
No schema changes, no new tables, no changes to `askBrain`, no UI redesign.
