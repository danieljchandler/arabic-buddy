# Finish the dialect-AI PR + wire transliteration rules

## Scope
Complete the four items Copilot didn't get to (and tidy two small things) so the dialect AI work from PR #187 is fully landed.

## Changes

### 1. Tashkeel regex tidy (`supabase/functions/_shared/dialectHelpers.ts`)
Split the regex into a non-global `ARABIC_LETTER_RE` (for per-character `.test()`) and a separate global version used only with `.match()`. Removes the fragile `lastIndex = 0` reset.

### 2. Wire transliteration rules (item #9)
Inject `getDialectTransliterationRules(dialect)` into the system prompt of:
- `supabase/functions/how-do-i-say/index.ts` — append to `buildExtras`
- `supabase/functions/phrase-of-the-day/index.ts` — add via `systemPromptExtra`
- `supabase/functions/generate-listen-script/index.ts` — append to `systemExtra`

So every Latin transliteration the model emits follows one consistent per-dialect convention.

### 3. Multi-turn dialect drift tracking (item #10)
In `supabase/functions/free-chat/index.ts` and `supabase/functions/conversation-practice/index.ts`:
- Before sending history to the model, scan the last 2–3 assistant turns with `detectMsaLeaks`.
- If leaks are found, append a self-correction nudge into the system prompt extras: "In your earlier reply you used MSA words [...] — do not repeat that pattern."

Lightweight, no extra model calls.

### 4. Dialect-aware re-segmentation (item #12)
In `supabase/functions/ai-resegment-transcript/index.ts`:
- Build `SYSTEM_PROMPT` per dialect with dialect-specific discourse markers (e.g. "أيوة" Egyptian, "إي" Gulf, "أيوه/إيوه" Yemeni) and acknowledgement particles.
- Use `getDialectLabel` + a small `DIALECT_DISCOURSE_MARKERS` map.

### 5. Finish live-voice drift surface (item #4)
- `src/hooks/useGeminiLive.ts` already flags `hasDialectDrift` on each turn and fires `onDialectDrift`. **No further hook change needed.**
- `src/components/conversation/LiveVoicePanel.tsx`: render a small "used MSA" badge under any assistant turn whose `hasDialectDrift` is true. Use existing `text-xs text-amber-600` styling (token-aligned). No mid-session system-prompt mutation — Gemini Live doesn't support that; this surfaces the issue to the learner instead.

### 6. Curriculum-chat: actually repair, not just log
In `supabase/functions/curriculum-chat/index.ts`, when the non-brain path detects leaks, run a single repair call through the gateway (same pattern as `streamBrain`'s post-stream repair) and substitute the repaired text before `extractStructuredOutput`. Falls back to original if the repair call fails. Keeps the function tolerant of Fanar/OpenRouter outputs.

## Out of scope
- No database changes.
- No UI redesign — only a small inline badge on drifted live-voice turns.
- No new edge functions; only edits to existing ones.
- Egyptian/Yemeni dialect_rules DB content parity (#11) is a content-team task, not code.

## Files touched
- `supabase/functions/_shared/dialectHelpers.ts`
- `supabase/functions/how-do-i-say/index.ts`
- `supabase/functions/phrase-of-the-day/index.ts`
- `supabase/functions/generate-listen-script/index.ts`
- `supabase/functions/free-chat/index.ts`
- `supabase/functions/conversation-practice/index.ts`
- `supabase/functions/ai-resegment-transcript/index.ts`
- `supabase/functions/curriculum-chat/index.ts`
- `src/components/conversation/LiveVoicePanel.tsx`
