
# Line-by-Line Gulf Arabic Transcript Implementation Plan

## Current State Summary

The core functionality is already in place:
- **Audio upload** → ElevenLabs Scribe v2 transcribes to raw Arabic text
- **GPT-5-mini analysis** → Parses into structured lines with tokens, vocabulary, and grammar
- **LineByLineTranscript component** → Renders sentence cards with:
  - Clickable tokens that show gloss (meaning) and standard spelling in a popover
  - Tap-to-reveal English translation per sentence
  - Play button per line (currently plays from start)
  - "Show all translations" toggle

The issue you're likely experiencing is that the **simplified AI prompt** may not be providing rich enough token data (glosses and standard spellings). Let's fix that.

---

## Implementation Tasks

### 1. Enhance the AI Prompt for Better Token Analysis

The current prompt is too minimal and may not produce consistent gloss/standard data.

**Changes to `supabase/functions/analyze-gulf-arabic/index.ts`:**

```text
Restore a more detailed prompt that:
- Explicitly instructs the AI to provide gloss for all content words
- Explains when to provide standard spelling (Gulf vs MSA differences)
- Gives an example of expected output format
- Keeps the "no markdown, JSON only" requirement
```

**Example enhanced prompt structure:**
```
You are an expert Gulf Arabic linguist. Analyze this transcript and return structured JSON.

TOKENIZATION RULES:
- Split each sentence into individual word tokens
- Keep dialect spelling as heard (e.g., شلون not كيف)
- Provide "standard" only when MSA spelling differs meaningfully
- Provide "gloss" (short English meaning) for every meaningful word
- Skip gloss for common particles unless needed for clarity

OUTPUT FORMAT:
{
  "rawTranscriptArabic": "...",
  "lines": [...],
  "vocabulary": [...],
  "grammarPoints": [...]
}
```

---

### 2. Add Word Highlighting During Playback (Preparation)

This is marked as lower priority but we'll add the infrastructure now.

**Current limitation:** ElevenLabs returns word-level timestamps, but we're not using them yet.

**Changes to `supabase/functions/elevenlabs-transcribe/index.ts`:**
- Already returns `words` array with `start` and `end` timestamps
- No changes needed here

**Changes to `analyze-gulf-arabic/index.ts`:**
- Optionally accept `words` array from ElevenLabs
- Map timestamps to tokens if provided

**Changes to `LineByLineTranscript.tsx`:**
- Add `currentTime` state tracked via `timeupdate` event
- Highlight the token whose `startMs`/`endMs` range contains `currentTime`
- Add visual styling for highlighted token

**Note:** This requires matching ElevenLabs word timestamps to our tokenized words, which can be complex. We'll add the UI hooks now but full implementation depends on accurate timestamp mapping.

---

### 3. Ensure Tokens Render as Natural Text

This is already implemented but let's verify the styling is correct:
- Tokens render inline (not as buttons/chips) ✅
- Subtle underline on hover ✅
- Punctuation attached to words ✅
- Popovers are compact ✅

No changes needed here.

---

### 4. Verify Popover Shows Both Gloss and Standard Spelling

Currently implemented in `InlineToken` component:
- Shows `token.surface` (as spoken)
- Shows `token.gloss` if available, otherwise "No gloss yet"
- Shows `token.standard` if different from surface

No changes needed here, but will work better once prompt is enhanced.

---

## Technical Implementation Details

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/analyze-gulf-arabic/index.ts` | Modify | Enhance prompt with detailed tokenization rules and examples |
| `src/components/transcript/LineByLineTranscript.tsx` | Modify | Add word highlighting infrastructure for future timestamp support |
| `src/pages/Transcribe.tsx` | Modify | Pass ElevenLabs word timestamps to analysis function |

### Data Flow

```text
1. User uploads audio file
2. ElevenLabs Scribe v2 returns:
   - text (raw transcript)
   - words[] (with start/end timestamps per word)
3. GPT-5-mini analyzes and returns:
   - lines[] with tokens[] (each token has surface, gloss, standard)
   - vocabulary[], grammarPoints[]
4. UI renders:
   - Sentence cards with inline clickable tokens
   - Tap sentence → reveal translation
   - Tap token → popover with meaning + standard form
   - Play button → plays audio (future: highlights current word)
```

---

## Priority Order

1. **High Priority**: Fix the AI prompt to produce better token data
2. **Medium Priority**: Add word highlight infrastructure 
3. **Low Priority**: Map ElevenLabs timestamps to tokens for sync

---

## Testing Checklist

After implementation:
- [ ] Upload a Gulf Arabic audio file
- [ ] Verify transcript shows as sentence cards (not paragraph)
- [ ] Click a sentence → English translation appears below
- [ ] Click "Show all translations" toggle → all translations visible
- [ ] Click any Arabic word → popover shows meaning and standard form
- [ ] Click play on a line → audio plays
- [ ] Vocabulary section shows extracted words with roots
- [ ] Grammar section shows dialect-specific patterns
