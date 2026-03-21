
Fix the word-definition system end to end by correcting both the stored token data and the runtime interaction layer. Right now the issue is structural, not just a bad prompt.

What I found
- `DiscoverVideo.tsx` uses its own `ClickableWord` popover, and it only shows `token.gloss` if one already exists. It has no live fallback translation and no adjacent multi-word selection logic at all.
- `LineByLineTranscript.tsx` does have live single-word and compound fallback, but it relies on weak token data and uses `token.gloss` for two different jobs: real word meanings and `(→ firstWord)` compound markers.
- In `analyze-gulf-arabic`, tokens are built with `toWordTokens(..., vocab, {})`, meaning most words only get a gloss if they happen to appear in the small 5–8 item vocabulary list or the small hardcoded fallback dictionary. That guarantees low coverage.
- Real data confirms this: several published videos only have about 24%–36% of tokens glossed.
- Tokenization is too naive (`split(/\s+/)`), so words like `الزحمة!` keep punctuation attached, which hurts lookup and live translation.
- Admin/manual video editing can preserve sparse token data instead of regenerating strong token metadata. `AdminTranscriptEditor` also keys cached glosses by `lineId + surface`, which can collide when the same word appears twice in one line.

Right fix
This needs one unified token-enrichment pipeline plus one unified transcript interaction UI. The persisted transcript data must already contain reliable per-word glosses, and the UI must use the same fallback/compound behavior everywhere.

Implementation plan

1. Redesign token metadata so single-word glosses and phrase glosses are separate
- Keep `gloss` for the actual individual word meaning.
- Add separate compound metadata instead of storing `(→ word)` inside `gloss`.
- Normalize token lookup data so punctuation does not break matching.
- Update `src/types/transcript.ts` and the token builders accordingly.

2. Build a dedicated server-side gloss-enrichment step
- In `supabase/functions/analyze-gulf-arabic/index.ts`, add a real “gloss coverage” phase after line translations are finalized.
- Generate:
  - a per-word gloss map for every unique normalized token
  - a phrase/compound map for common adjacent bigrams/trigrams
- Use the existing multi-model strategy for verification, but apply it to gloss generation directly instead of hoping the small vocabulary list covers everything.
- Keep the hardcoded common-word dictionary only as a final fallback, not the primary source.
- Normalize punctuation/diacritics before lookup and then map back to the displayed surface form.

3. Apply the same stronger token generation to other transcript-producing tools
- Update `supabase/functions/analyze-meme/index.ts` to use the same normalized token/gloss builder instead of the current bare `glosses[surface]` mapping.
- Reuse shared backend helper logic so video transcripts, meme transcripts, and any other transcript-based sections behave consistently.

4. Upgrade the live translation fallback so it is reliable and context-aware
- Improve `supabase/functions/translate-phrase/index.ts` to accept dialect + optional line context + mode (`word` vs `phrase`).
- Strip punctuation before lookup/translation.
- Return clean single-word meaning and phrase meaning consistently.
- Use it only as resilience when persisted token glosses are missing or when the user selects a custom adjacent phrase.
- Make sure public transcript views do not depend on a fragile logged-in-only path for basic read-only definitions.

5. Unify the frontend transcript interaction system
- Replace the separate weak token UI in `src/pages/DiscoverVideo.tsx` with the same interaction model used by `LineByLineTranscript`, or extract a shared token/selection component and use it in both places.
- Ensure every transcript surface supports:
  - single-word popovers
  - adjacent 2-word and 3-word selection
  - fallback translation when needed
  - the same save-to-vocabulary behavior
- This should cover videos first, then all other transcript-based sections using the shared component.

6. Fix admin/manual content so sparse tokens never get saved again
- In `src/pages/admin/AdminVideoForm.tsx`, regenerate/enrich tokens before saving transcript lines instead of trusting old token arrays.
- In `src/components/admin/AdminTranscriptEditor.tsx`, stop keying gloss preservation by `lineId + surface`; use token id/index-safe mapping.
- Preserve manual edits where possible, but rebuild token metadata whenever text changes so new/edited lines do not stay blank.

7. Repair existing content already in the database
- Run a one-time backfill for existing `discover_videos.transcript_lines` to regenerate full token gloss coverage.
- Prioritize published videos first since that is where users are hitting the issue now.
- If other persisted transcript stores use the same token shape, backfill those too.

8. Add verification so this does not regress
- Add backend tests for:
  - punctuation normalization
  - per-word gloss coverage
  - bigram/trigram compound metadata
  - repeated identical words in one line
- Add frontend tests for:
  - single-word click behavior
  - adjacent multi-word selection
  - fallback translation rendering
  - Discover video transcript using the shared behavior

Technical details / files likely involved
- `supabase/functions/analyze-gulf-arabic/index.ts`
- `supabase/functions/analyze-meme/index.ts`
- `supabase/functions/translate-phrase/index.ts`
- `src/types/transcript.ts`
- `src/components/transcript/LineByLineTranscript.tsx`
- `src/pages/DiscoverVideo.tsx`
- `src/components/admin/AdminTranscriptEditor.tsx`
- `src/pages/admin/AdminVideoForm.tsx`

No schema migration is required for this fix. The main work is:
- stronger token generation
- shared UI behavior
- backfilling existing transcript JSON data

Success criteria
- Every non-punctuation token in persisted video transcripts has a non-empty individual gloss.
- Selecting adjacent words works in video transcripts and all other transcript-based sections.
- Manual/admin-created videos no longer save sparse token data.
- Existing published videos are repaired, not just newly processed ones.
