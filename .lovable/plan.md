

## Add MSA Arabic Alongside English Translations

### Current State
- `translate-phrase` edge function returns only `{ translation }` (English)
- Single-word popover shows English gloss and optionally `token.standard` (MSA) if pre-computed
- Compound popover shows only English translation
- On-demand translations lack MSA

### Plan

**1. Update `translate-phrase` edge function**

Modify to return both English and MSA in parallel:

```typescript
// Response shape: { translation: string, msa: string }

const [englishMessages, msaMessages] = [
  [{ role: 'system', content: 'Translate Gulf Arabic to English. Return ONLY 1-5 English words.' }, { role: 'user', content: phrase }],
  [{ role: 'system', content: 'Convert this Gulf Arabic word/phrase to Modern Standard Arabic (فصحى). Return ONLY the MSA Arabic script, no explanation.' }, { role: 'user', content: phrase }]
];

// Run 4 parallel calls: 2 for English (Qwen + Gemini), 2 for MSA (Qwen + Gemini)
const [qwenEn, geminiEn, qwenMsa, geminiMsa] = await Promise.all([...]);

return { translation: qwenEn ?? geminiEn ?? '', msa: qwenMsa ?? geminiMsa ?? '' };
```

**Model choice**: Qwen 3 235B (primary) with Gemini 2.5 Flash fallback - both excel at Arabic linguistics.

**2. Update UI in `LineByLineTranscript.tsx`**

- Store `liveMsa` alongside `liveTranslation` in InlineToken state
- Display MSA below English in single-word popover (similar to existing `token.standard` display)
- Add MSA display to compound popover

**UI mockup for popover:**
```
       كتاب
       book
   (فصحى: كِتَاب)
```

**3. Update compound popover**

- Store `msa` in `liveCompound` state object
- Display MSA below the English translation in compound card

### Files Changed
- `supabase/functions/translate-phrase/index.ts` - Add parallel MSA translation calls
- `src/components/transcript/LineByLineTranscript.tsx` - Display MSA in both popover types

