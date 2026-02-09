
# Dual-LLM Translation: Gemini + Falcon H1

## Overview

Add Falcon H1 as a second translation engine alongside Gemini, mirroring your dual-transcription setup. Both LLMs translate the Arabic transcript in parallel, then Gemini merges the two translations into the best final version.

## How It Will Work

1. After transcription completes, the Arabic text is sent to both Gemini and Falcon H1 simultaneously
2. Falcon H1 (Arabic-first LLM) produces its own line-by-line translation
3. Gemini receives both its own translation AND Falcon's translation, then picks the best rendering per line
4. User sees the final merged result (same UI as today, but with higher-quality translations)

## Implementation Steps

### Step 1: Store Falcon H1 API Key
- You'll provide your Hugging Face Inference Endpoint API token as a secret (`FALCON_HF_API_KEY`)
- The endpoint URL (`https://k5gka3aa0dgchbd4.us-east-1.aws.endpoints.huggingface.cloud`) will be hardcoded in the edge function since it's not sensitive

### Step 2: Create `falcon-translate` Edge Function
- New edge function at `supabase/functions/falcon-translate/index.ts`
- Accepts `{ arabicLines: string[] }` -- the Arabic sentences to translate
- Calls the Falcon H1 endpoint with a translation prompt for each batch
- Returns `{ translations: string[] }` -- one English translation per line
- Falcon H1 uses the HuggingFace text-generation API format

### Step 3: Update `analyze-gulf-arabic` Edge Function
- After Gemini produces its `lines` (arabic + translation), call the `falcon-translate` function internally to get Falcon's translations for the same Arabic lines
- Add a new "merge translations" step: send both Gemini and Falcon translations back to Gemini with a prompt like: "Here are two translations of each Arabic line. Pick whichever is more natural and accurate, or combine the best parts."
- Update the final output with the merged translations

### Step 4: Update Frontend (`Transcribe.tsx`)
- Minor changes: update progress messages to say "Translating with dual LLMs..."
- No structural changes needed since the analysis function already returns the final merged result

### Step 5: Update `config.toml`
- Add `[functions.falcon-translate]` with `verify_jwt = false`

## Architecture

```text
Transcription complete (Arabic text)
    |
    v
analyze-gulf-arabic edge function
    |
    +---> Step 1: Gemini splits + translates (existing)
    |         Result: lines with arabic + gemini_translation
    |
    +---> Step 2: Falcon H1 translates same arabic lines (new)
    |         Result: falcon_translations[]
    |
    +---> Step 3: Gemini merges both translations (new)
    |         "Pick the best translation per line"
    |
    v
Final merged result returned to frontend
```

## Technical Details

**Falcon H1 API call (HuggingFace Inference Endpoints):**
- Endpoint: `POST https://k5gka3aa0dgchbd4.us-east-1.aws.endpoints.huggingface.cloud`
- Auth: `Authorization: Bearer FALCON_HF_API_KEY`
- Body format: Standard HF text-generation inference (`inputs` + `parameters`)
- The prompt will instruct Falcon to translate each Arabic line to English, returning structured output

**Why do it inside `analyze-gulf-arabic` rather than from the frontend:**
- Keeps the flow sequential (need Gemini's Arabic lines first before Falcon can translate them)
- Avoids an extra round-trip from the browser
- Single edge function handles the full analysis pipeline

**Fallback behavior:**
- If Falcon fails: use Gemini's translations only (current behavior, no degradation)
- If Gemini fails: cannot proceed (same as today, since Gemini handles line splitting)

**Timeout consideration:**
- The analyze-gulf-arabic function already uses ~55s timeout. Adding Falcon adds latency. We'll call Falcon in parallel with the meta/vocabulary extraction step to minimize added time.

**Cost note:**
- Your HuggingFace endpoint is a dedicated instance, so Falcon calls are covered by your HF billing, not Lovable AI credits.
