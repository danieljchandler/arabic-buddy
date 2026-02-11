

# Integrate Falcon H1 via Hugging Face Dedicated Endpoint

## Overview
Connect to your Falcon model hosted at `https://gsv7qihcuvh8iz7u.us-east4.gcp.endpoints.huggingface.cloud` and add warm-up requests that fire when the Meme Analyzer, Transcribe, and Tutor Upload pages load.

## What Changes

### 1. Store the Falcon endpoint URL as a secret
- Save `FALCON_HF_ENDPOINT_URL` = `https://gsv7qihcuvh8iz7u.us-east4.gcp.endpoints.huggingface.cloud` as a backend secret (the existing `FALCON_HF_API_KEY` will be used for auth).

### 2. New edge function: `falcon-warmup`
A lightweight edge function that sends a tiny request to the Falcon endpoint to wake it up. It will:
- Send a minimal chat completion request (e.g. "Hi" with `max_tokens: 1`)
- Use the HF dedicated endpoint URL + API key
- Return quickly (fire-and-forget style from client)
- Handle errors silently (warm-up failures should never block the user)

### 3. Update `analyze-meme` edge function
- Add Falcon as a translation/analysis option alongside the Lovable AI gateway
- Use the HF endpoint with the OpenAI-compatible `/v1/chat/completions` path
- Keep Lovable AI (Gemini) as the primary vision model (Falcon doesn't do vision)
- Use Falcon for the meme explanation and cultural breakdown text generation where possible

### 4. Update `analyze-gulf-arabic` edge function
- Replace the GPT-5 translation step with a call to the Falcon HF endpoint
- The comments already reference "Falcon" -- now it will actually use Falcon
- Fall back to Lovable AI if the Falcon endpoint is unavailable

### 5. Update `classify-tutor-segments` edge function
- Add Falcon as the AI backend for classifying tutor segments
- Fall back to Lovable AI if Falcon is unavailable

### 6. Frontend warm-up calls
Add a `useEffect` hook on three pages to fire the warm-up request on mount:
- `src/pages/MemeAnalyzer.tsx`
- `src/pages/Transcribe.tsx`
- `src/pages/TutorUpload.tsx`

Each will call `supabase.functions.invoke('falcon-warmup')` in a fire-and-forget pattern (no await, no error handling needed on client).

## Technical Details

### Falcon HF Endpoint Format
The dedicated endpoint is OpenAI-compatible:
```text
POST https://gsv7qihcuvh8iz7u.us-east4.gcp.endpoints.huggingface.cloud/v1/chat/completions
Authorization: Bearer <FALCON_HF_API_KEY>
Content-Type: application/json

{
  "model": "tgi",
  "messages": [...],
  "max_tokens": 2048
}
```

### Edge function config
Add `falcon-warmup` to `supabase/config.toml` with `verify_jwt = false`.

### Files to create
- `supabase/functions/falcon-warmup/index.ts`

### Files to modify
- `supabase/config.toml` (add falcon-warmup)
- `supabase/functions/analyze-meme/index.ts` (use Falcon for text analysis)
- `supabase/functions/analyze-gulf-arabic/index.ts` (use Falcon for translation)
- `supabase/functions/classify-tutor-segments/index.ts` (use Falcon for classification)
- `src/pages/MemeAnalyzer.tsx` (add warm-up call)
- `src/pages/Transcribe.tsx` (add warm-up call)
- `src/pages/TutorUpload.tsx` (add warm-up call)
