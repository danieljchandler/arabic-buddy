
## What's Currently Happening

The AI analysis pipeline (`analyze-gulf-arabic` edge function) already detects dialect down to country level (Saudi, Kuwaiti, UAE, Bahraini, Qatari, Omani) via the Call 1 merge prompt. However:

1. **Difficulty is never assessed** — it's always defaulted to "Beginner" in the admin form, and there's no difficulty field in the result type or prompt
2. **The auto-detected dialect is never applied** to the admin form after processing — it stays on whatever was previously selected
3. **The dialect dropdown in AdminVideoForm shows wrong options** (`["Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"]`) — these don't match what the AI detects (`Saudi`, `Kuwaiti`, `UAE`, etc.)
4. **The Transcribe page never shows dialect or difficulty** to users after processing

## Changes Required

### 1. Edge Function — Add difficulty detection to Call 1 merge prompt

Call 1 (the merge step) already detects dialect from the Arabic text. We extend its output schema to also return `difficulty`:

```
{
  "lines": [...],
  "dialect": "Saudi" | "Kuwaiti" | ...,
  "difficulty": "Beginner" | "Intermediate" | "Advanced" | "Expert"
}
```

Difficulty criteria added to the prompt:
- **Beginner**: Common daily words, simple short sentences, basic topics (greetings, food, family)
- **Intermediate**: Mix of common/less common vocabulary, some idioms, moderate topics
- **Advanced**: Rich vocabulary, idioms, cultural references, complex sentences, fast speech
- **Expert**: Technical/professional language, heavy slang, rapid dialectal speech, domain expertise required

### 2. TypeScript types — `src/types/transcript.ts`

Add `difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert'` to `TranscriptResult`.

### 3. AdminVideoForm — Auto-populate dialect + difficulty after processing

After the analysis completes (line ~560), apply the AI-detected values:
```ts
if (result.dialect) setDialect(result.dialect);
if (result.difficulty) setDifficulty(result.difficulty);
```
Toast: "Auto-detected: Saudi dialect · Intermediate difficulty"

Also fix the `DIALECTS` array to include all country-level options:
```ts
const DIALECTS = ["Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani", "Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"];
```

### 4. Transcribe page — Show dialect + difficulty badges

After analysis completes and `transcriptResult` is displayed, show two informational badges under the transcript card header:
- Dialect badge (e.g. "🇸🇦 Saudi dialect") 
- Difficulty badge (e.g. "Intermediate")

These are derived from `transcriptResult.dialect` and `transcriptResult.difficulty`.

## Files Changed

```
supabase/functions/analyze-gulf-arabic/index.ts  — extend Call 1 prompt + parse difficulty
src/types/transcript.ts                          — add difficulty field
src/pages/admin/AdminVideoForm.tsx               — fix DIALECTS, auto-populate from result
src/pages/Transcribe.tsx                         — show dialect + difficulty badges
```

No database migrations needed — `discover_videos` already has a `difficulty` column and `dialect` column that accept these values.
