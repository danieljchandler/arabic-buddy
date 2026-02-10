

# Meme Analyzer - Arabic Meme Breakdown Tool

## Overview

A new section in the app where users upload Arabic memes (images or videos). The system uses AI vision to read on-screen text, transcribes any audio (for videos), then provides a full breakdown: transcription, translation, humor/cultural explanation, vocabulary words, and clickable tokens -- all reusing the existing transcript interaction patterns.

## How It Works

1. **Upload**: User uploads an image or video from their device
2. **Processing**:
   - **Images**: AI vision model reads and extracts Arabic text from the image
   - **Videos**: AI vision reads on-screen text from key frames PLUS ElevenLabs transcribes the audio track
3. **Analysis**: AI explains the meme's meaning, humor, and cultural context, then produces a structured transcript (lines with tokens), vocabulary list, and grammar notes
4. **Interaction**: Same as the Transcribe page -- clickable Arabic words show popover with gloss, option to add to vocab section or save to My Words

## User Flow

```text
Home --> "Meme Analyzer" button --> Upload page
  |
  +--> Upload image or video
  |
  +--> Processing (AI vision + optional audio transcription)
  |
  +--> Results:
       +-- Meme displayed (image or video player)
       +-- "What's Funny" explanation (casual + educational)
       +-- On-screen text: transcription + translation (clickable tokens)
       +-- Audio text (video only): transcription + translation (clickable tokens)
       +-- Vocabulary section
       +-- Grammar points
```

## Technical Plan

### 1. New Edge Function: `analyze-meme`

**File**: `supabase/functions/analyze-meme/index.ts`

- Accepts a base64-encoded image (or video frame) plus optional audio transcript text
- Uses Lovable AI with `google/gemini-2.5-flash` (supports vision/image input) to:
  - Read all Arabic text visible in the image
  - Translate the on-screen text
  - Explain the meme's humor (casual tone first, then cultural/linguistic breakdown)
  - Extract vocabulary and grammar points
  - Return structured JSON matching the existing `TranscriptResult` format plus a new `memeExplanation` field
- For videos: the frontend sends extracted frames; audio is transcribed separately via the existing `elevenlabs-transcribe` function
- Update `supabase/config.toml` to register the function with `verify_jwt = false`

### 2. Storage Bucket: `meme-uploads`

- Create a public storage bucket for uploaded meme images/videos
- Users need to see the meme alongside the analysis, so files are stored and referenced by URL
- RLS policies to allow authenticated users to upload

### 3. New Page: `src/pages/MemeAnalyzer.tsx`

- Upload area (drag-and-drop or file picker) for images and videos
- After upload:
  - **Images**: Convert to base64, send to `analyze-meme` edge function
  - **Videos**: Extract a few key frames (using canvas + video element), convert to base64 for vision; extract audio track and send to `elevenlabs-transcribe` for audio transcription; then send both to `analyze-meme`
- Display the uploaded meme (image tag or video player with controls)
- Display the "What's Funny" explanation in a styled card
- Reuse `LineByLineTranscript` component for the on-screen text breakdown (clickable tokens, add to vocab, save to My Words)
- Separate `LineByLineTranscript` section for audio transcript (videos only)
- Vocabulary and grammar sections matching the Transcribe page layout

### 4. Route and Navigation

- Add `/meme` route in `src/App.tsx`
- Add "Meme Analyzer" button on the Index page (home screen) with an appropriate icon

### 5. Video Frame Extraction (Client-Side)

- Use HTML5 `<video>` + `<canvas>` to capture 3-5 evenly spaced frames from the video
- Send these frames as base64 images to the AI for text reading
- Extract audio using the existing file upload flow to `elevenlabs-transcribe`

### 6. Types

- Extend or create a `MemeAnalysisResult` type that includes:
  - `memeExplanation`: `{ casual: string; cultural: string }` -- the fun explanation plus deeper breakdown
  - `onScreenText`: `TranscriptResult` -- structured lines from visible text
  - `audioText?`: `TranscriptResult` -- structured lines from audio (video only)
  - `mediaUrl`: string -- URL to the uploaded file in storage

### Key Reuse

- `LineByLineTranscript` component (clickable tokens, popovers, vocab actions) -- used as-is
- `useAddUserVocabulary` hook for saving words to My Words
- `analyze-gulf-arabic` patterns for AI prompting and JSON extraction
- `elevenlabs-transcribe` function for video audio
- Same vocabulary/grammar display sections from the Transcribe page

