

# Dual Transcription with Munsit + Cross-Check Pipeline

## Overview

Add Munsit (by CNTXT AI) as a second Arabic speech-to-text engine alongside ElevenLabs. Both transcriptions run in parallel, then the existing Gemini AI analysis compares them to produce a higher-quality final transcript with translations, vocabulary, and grammar.

## How It Will Work

1. User uploads audio/video (same UI as today)
2. Audio is sent to **both** ElevenLabs Scribe v2 and Munsit simultaneously
3. Gemini receives both transcriptions and produces:
   - A merged "best" transcript (choosing the most accurate reading per sentence)
   - Translations, vocabulary, and grammar (same as today, but with better source text)
4. User sees the final result with a small indicator showing both sources were used

## Implementation Steps

### Step 1: Store Munsit API Key
- You'll provide your Munsit API key and it will be securely stored as a backend secret (`MUNSIT_API_KEY`)

### Step 2: Create `munsit-transcribe` Edge Function
- New backend function at `supabase/functions/munsit-transcribe/index.ts`
- Accepts audio the same way as the ElevenLabs function (FormData with `audio` field, or JSON with `audioUrl`)
- Calls `POST https://api.cntxt.tools/audio/transcribe` with model `munsit-1`
- Returns the transcription text
- Includes same timeout and error handling patterns

### Step 3: Update `analyze-gulf-arabic` to Accept Dual Transcripts
- Modify the edge function to accept `{ transcript, munsitTranscript }` instead of just `{ transcript }`
- Update the Gemini line-splitting prompt to include both transcriptions:
  - "Here are two transcriptions of the same audio. Transcription A (ElevenLabs): ... Transcription B (Munsit): ... Merge them into the best possible transcript, preferring whichever version is more accurate for each segment."
- The rest of the pipeline (metadata, word glosses) stays the same but works on the merged result

### Step 4: Update Frontend (`Transcribe.tsx`)
- Fire both transcription requests in parallel using `Promise.allSettled`
- Pass both results to the analysis function
- If one fails, gracefully fall back to whichever succeeded
- Update progress messages to reflect dual processing ("Transcribing with two engines...")

### Step 5: Update `config.toml`
- Add `[functions.munsit-transcribe]` with `verify_jwt = false` (matching the ElevenLabs pattern)

## Technical Details

**Munsit API:**
- Endpoint: `POST https://api.cntxt.tools/audio/transcribe`
- Auth: `Authorization: Bearer MUNSIT_API_KEY`
- Body: `multipart/form-data` with `file` field and `model=munsit-1`
- Supported format: `.mp3` (audio/mpeg)
- Audio may need conversion if the uploaded file is not MP3

**Parallel flow in the frontend:**
```text
Upload audio
    |
    +---> ElevenLabs edge function (existing)
    |
    +---> Munsit edge function (new)
    |
    v
Both results collected (Promise.allSettled)
    |
    v
analyze-gulf-arabic (updated to merge two transcripts)
    |
    v
Display merged result
```

**Fallback behavior:**
- If Munsit fails but ElevenLabs succeeds: proceed with ElevenLabs only (current behavior)
- If ElevenLabs fails but Munsit succeeds: proceed with Munsit only
- If both fail: show error

**File format consideration:**
- Munsit docs say it supports `.mp3`. The current ElevenLabs function accepts any audio format. For Munsit, if the uploaded file is not MP3, we may need to send it as-is and see if the API accepts it (many APIs accept more formats than documented), or note the limitation to the user.

