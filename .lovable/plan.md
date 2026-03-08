

## Fix Word Translation in Transcript View

### Problems Found

1. **Single words with no gloss show no translation** — When a token lacks a pre-computed `gloss`, the popover only says "No definition — tap 1-2 adjacent words to combine." There's no on-demand translation for single words.

2. **Compound translation calls the wrong function** — The compound word flow calls `analyze-gulf-arabic` (a massive 1600-line pipeline function) with `{ phrase }`. This is overkill and fragile. A dedicated `translate-phrase` edge function already exists but is unused.

3. **`translate-phrase` not in config.toml** — The function exists but has no entry in `supabase/config.toml`, so it may not deploy or may fail with JWT issues.

### Plan

**1. Register `translate-phrase` in config.toml**
- Add `[functions.translate-phrase]` with `verify_jwt = false` (it already does its own auth check internally).

**2. Add single-word on-demand translation**
- In `LineByLineTranscript.tsx`, when a single token is tapped and has no `gloss`, trigger a live translation call to `translate-phrase` instead of just showing "No definition."
- Show a loading spinner in the popover while the translation loads, then display the result.
- This reuses the same pattern already built for compound words (`liveCompound` state), but for single tokens.

**3. Switch compound translation to use `translate-phrase`**
- Replace the `supabase.functions.invoke('analyze-gulf-arabic', { body: { phrase } })` call (line ~403) with `supabase.functions.invoke('translate-phrase', { body: { phrase } })`.
- The response shape is the same (`{ translation }`), so no other changes needed.

**4. Add "Translate" button fallback in single-word popover**
- For tokens with no gloss and no auto-translation yet, add a "Translate" button that triggers the lookup on demand, so users have an explicit action available.

### Technical Detail

The `translate-phrase` function runs two parallel models (Qwen 3 235B + Gemini 2.5 Flash) with a 15s timeout each, returning the first successful result. This is fast and purpose-built for this use case, unlike the heavy `analyze-gulf-arabic` pipeline.

