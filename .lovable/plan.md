

## Problem

When you click on a word in the transcript, it shows "No definition available" for most words. This is because:

1. The AI only returns 5-8 key vocabulary words with definitions
2. The code only shows a definition (`gloss`) if the clicked word exactly matches one of those few vocabulary items
3. Most words in the transcript don't match, so they have no definition

## Solution

Request definitions for **every word** in each sentence by having the AI generate per-word glosses during the analysis step. This requires a third AI call focused specifically on word-level definitions.

### Implementation Steps

1. **Add a new AI prompt for word-level definitions**
   - Create a `getWordGlossesPrompt` that asks the AI to provide English meanings for every word in each sentence
   - Request output as a map of Arabic words to their English translations

2. **Call the word glosses API after lines are parsed**
   - Make a third AI call with the Arabic text to get definitions for all words
   - Parse the response into a comprehensive vocabulary map

3. **Update `toWordTokens` to use the full word map**
   - Merge the key vocabulary list with the complete word glosses
   - Every word will now have a potential definition

4. **Handle common words efficiently**
   - Common words like "و" (and), "في" (in), particles, etc. will get simple translations
   - Content words will get contextual meanings

### Technical Details

**New AI prompt structure:**
```text
Provide English glosses for every Arabic word in this transcript.
Output JSON: { "glosses": { "arabicWord": "english meaning", ... } }
Include:
- All content words with meanings
- Common particles (و = and, في = in, etc.)
- Contextual meanings when words have multiple uses
```

**Updated flow in edge function:**
1. Parse lines (existing)
2. Get metadata/vocab (existing)
3. **NEW**: Get comprehensive word glosses
4. Merge all glosses when building tokens

