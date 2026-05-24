## Goal
Improve the dialect Bible translation in `bible-passage` edge function so it cross-references BOTH the formal Arabic AND the English translations before producing the dialect version — instead of converting from Arabic alone.

## Why it matters
Today, dialect output is rewritten from the Arabic verse only. Arabic Bible translations (Van Dyck, NAV, etc.) can be archaic or ambiguous, so meaning is sometimes lost or stiff. Using English (ESV/NIV) as a semantic anchor alongside the Arabic produces a dialect rendering that is both faithful to the original sense AND natural to a native speaker.

## Changes (single file: `supabase/functions/bible-passage/index.ts`)

1. **Reorder fetches**: fetch Arabic AND English chapters in parallel FIRST, then run dialect conversion with both in hand. (Today, dialect runs in parallel with English and never sees it.)

2. **Rewrite `convertToDialect`** to accept both `formalVerses` and `englishVerses`:
   - Pair them index-by-index into `{ n, ar, en }` objects sent to the model.
   - Strengthened system prompt:
     - "Produce a single natural ${dialect} rendering of each verse."
     - "Use the Arabic as the primary source of truth for names, theological terms, and word order cues."
     - "Use the English as a meaning-check — if Arabic is ambiguous or archaic, let the English clarify intent."
     - "Never invent content not present in either source. Never drop content present in both."
     - "Strict dialect: no MSA, no cross-dialect leakage (reuse `getDialectVocabRules`)."
     - "Preserve proper nouns in their standard Arabic biblical form (e.g. يسوع, موسى)."
     - "Keep the verse number prefix exactly."
   - Use **structured tool calling** (not regex JSON parsing) to guarantee a `{verses: [{n, text}]}` array — current `match(/\[[\s\S]*\]/)` is brittle.
   - Upgrade model to `google/gemini-2.5-pro` for accuracy (Bible translation is reasoning-heavy and low-volume per request, so cost is acceptable). Keep flash as fallback on 5xx.
   - Lower temperature to `0.3` for faithfulness.

3. **Graceful degradation**: if English fetch fails, fall back to Arabic-only conversion with the existing prompt path so the feature still works.

4. **Import `getDialectVocabRules`** from `_shared/dialectHelpers.ts` (already used elsewhere in project per memory).

## Out of scope
- No UI changes, no schema changes, no new secrets.
- No changes to `BibleReading.tsx` / `BibleLessons.tsx` — response shape stays identical.
- Caching of translated chapters (could be a follow-up).

## Technical notes
- Tool-call schema:
  ```
  { verses: [{ n: number, text: string }] }
  ```
  Reconstruct the string array as `"${n} ${text}"` before returning, preserving today's output contract.
- Keep the 55s timeout; Pro model is slower but well within limits for one chapter.
- All error paths (402/429/timeout) preserved unchanged.