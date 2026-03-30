

# Arabic Word Jingle — Google Lyria 3 (10s, Dialect-Aware)

## Overview
A "🎵 Jingle" button on flashcard review that generates a **10-second catchy Arabic song** about the word using the correct dialect (Gulf or Egyptian). The song is saved permanently to the flashcard.

## Implementation

### 1. Database Migration
Add `jingle_audio_url` column to `user_vocabulary`.

### 2. New Edge Function: `generate-word-jingle`
- **Input**: `{ word_arabic, word_english, dialect }`
- **Step 1**: Use Lovable AI (Gemini Flash) + shared `dialectHelpers.ts` to generate a dialect-specific music prompt. Example for Gulf: *"A catchy 10-second Arabic pop jingle teaching the Gulf Arabic word كتاب (book). Use Khaliji dialect vocals. Short, fun, memorable chorus repeating the word."*
- **Step 2**: Call Google Lyria 3 Clip API directly:
  ```
  POST https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent
  x-goog-api-key: $GEMINI_API_KEY
  Body: { contents: [{ parts: [{ text: musicPrompt }] }], generationConfig: { responseModalities: ["AUDIO"] } }
  ```
- **Step 3**: Extract base64 audio from response, return it
- Uses `LOVABLE_API_KEY` for prompt generation, `GEMINI_API_KEY` for Lyria 3

### 3. Secret Required
- `GEMINI_API_KEY` — needed for Lyria 3 (not available through Lovable AI gateway). User gets it from Google AI Studio.

### 4. UI Changes: `MyWordsReview.tsx`
- Add a **🎵 Jingle** button on each flashcard
- First tap: show "Creating song..." → call edge function → upload MP3 to `flashcard-audio` bucket → save URL to `jingle_audio_url` → play
- Subsequent taps: play saved URL
- Small 🔄 regenerate option if jingle already exists
- Pass `activeDialect` to the edge function so prompts use the correct dialect

### Key Details
- Music prompt explicitly requests **10-second** clip and specifies Gulf Arabic or Egyptian Arabic vocals/style based on the dialect parameter
- Uses `getDialectLabel()` and `getDialectVocabRules()` from shared helpers to ensure dialect accuracy in the prompt
- Lyria 3 generates real music with vocals — not TTS

