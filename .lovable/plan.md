## Translate & Save — paste Arabic, get a nuanced English breakdown, tap to save words

### What the user gets

A new page **/translate** ("Translate & Save") with a paste box. Submitting calls a new edge function that returns a structured, sentence-by-sentence breakdown. Each Arabic word in the output is tappable and can be added to **My Words** with one tap, reusing the existing flashcard flow.

### Page layout (/translate)

```text
+------------------------------------------------------+
| Translate & Save                                     |
| Paste Gulf, Egyptian, or Yemeni Arabic               |
| [ textarea, up to ~4000 chars ]                      |
| Detected dialect: Gulf  [ Translate ]                |
+------------------------------------------------------+
| Sentence 1                                            |
|   Arabic (TappableArabicText — tap word = save)       |
|   Literal:  word-for-word gloss                       |
|   Natural:  fluent English                            |
|   Note:     (only if idiom / cultural reference)      |
+------------------------------------------------------+
| Sentence 2 ...                                        |
+------------------------------------------------------+
| Saved this session: 3 words  [ Go to My Words ]      |
```

- Dialect is auto-detected by the model and shown as a chip; user can override via dropdown (Gulf / Egyptian / Yemeni) before re-translating.
- Tapping any Arabic word opens the existing TappableArabicText popover (translation, audio, "Save to My Words"). Saved words land in `user_vocabulary` with `dialect` set to the detected/selected dialect, exactly like Transcribe / Reading Practice.
- Empty state shows two example snippets the user can click to populate the box.
- Entry points: tile on Home (Index) under the existing tools row, and a link from My Words ("Add from text").

### Backend — new edge function `translate-text`

- Input: `{ text: string, dialect?: 'gulf' | 'egyptian' | 'yemeni' | 'auto' }`
- Calls `askBrain` (existing AI Brain orchestrator) with a structured-output schema:
  ```text
  { detected_dialect, sentences: [
      { arabic, literal, natural, note? }
  ] }
  ```
- Uses the existing dialect rulebook / `primeDialectPrompt` so MSA leakage rules apply.
- Default model: `google/gemini-3-flash-preview` via Lovable AI Gateway. Returns 429 / 402 surfaced to the UI with toasts (same pattern as other features).
- `verify_jwt = false` is fine (function is read-only AI); rate-limit per user via the existing `increment_usage_counter('translate_text')` and cap at e.g. 30/day for non-admins.

### Saving vocabulary

No new table. Reuse `useUserVocabulary` + `TappableArabicText`'s existing "save" path which already inserts into `public.user_vocabulary` with SRS defaults. The page only needs to pass the sentence's Arabic + its natural translation as context so the saved card gets a `context_sentence` / `context_translation` (columns already exist).

### Files

New:
- `supabase/functions/translate-text/index.ts`
- `src/pages/Translate.tsx`
- `src/hooks/useTranslateText.ts` (thin wrapper calling the edge function via `supabase.functions.invoke`)

Edited:
- `src/App.tsx` — add `/translate` route
- `src/pages/Index.tsx` — add tile
- `src/pages/MyWords.tsx` — "Add from text" link
- `src/lib/pageHints.ts` — hint for the new page

### Out of scope (can be follow-ups)

- File upload (.txt / PDF / DOCX) — user chose paste-only.
- Bulk "save all words" button.
- TTS playback of full passage (per-word audio already works via TappableArabicText).
- Saving the full passage itself as a reading-practice item.
