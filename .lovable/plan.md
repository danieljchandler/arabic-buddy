Approve Lisan-derived Yemeni dialect rules

## Goal
Move the 7 Lisan-Yemeni corpus-derived `dialect_rules` rows from `status='draft'` to `status='approved'` so they start influencing Yemeni story/passage generation, then verify a Yemeni reading passage still generates successfully.

## Current state
- `docs/yemeni/` artifacts and migrations are all dated 2026-08-04 and internally consistent.
- Migration `20260804120000_yemeni_corpus_rule_drafts.sql` seeded 7 Yemeni rules with `source='corpus_mined'` and `status='draft'`.
- Live DB query confirms these 7 rows are still `draft`.
- `dialectHelpers.fetchRules()` only loads `status='approved'` rules, so the draft rules are invisible to `reading-passage`, `generate-daily-story`, and other generators.

## Steps
1. Update the 7 Yemeni corpus-derived rows in `public.dialect_rules` to `status='approved'` via a targeted SQL update.
2. Optionally add a short migration file recording the approval so the change persists across environments.
3. Trigger a test Yemeni reading-passage generation to confirm the rules load and the passage still generates without error.
4. Report which rules are now active and any prompt/MSA-leak changes observed.

## Out of scope
- Wiring `dialect_corpus_sentences` into `mine-dialect-corpus` (acknowledged gap in the integration plan, not required for this request).
- Re-deriving the Lisan artifacts or changing rule content.
