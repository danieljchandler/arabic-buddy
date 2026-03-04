

# Set Up Azure Pronunciation Assessment

## Secrets Needed

The edge function uses two environment variables:
- **AZURE_SPEECH_KEY** — your Azure Speech API key
- **AZURE_SPEECH_REGION** — your Azure region (e.g. `uaenorth`, `eastus`)

No separate endpoint URL secret is needed — the endpoint is automatically constructed from the region:
```
https://{AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/...
```

I'll use the secrets tool to prompt you for both values.

## Build Error Fixes

There are also three build errors to fix in the same pass:

1. **Edge function type error** (line 208): `Uint8Array` isn't accepted as `body` in Deno's fetch. Fix: wrap with `new Blob([audioBytes])` or cast to `ReadableStream`.

2. **`difficulty` column missing** — `useReview.ts`, `Learn.tsx`, and `MyWordsReview.tsx` reference a `difficulty` column on `word_reviews` / `user_vocabulary` that doesn't exist in the database schema. Fix: remove `difficulty` from the select queries and the `WordWithReview` / `DueUserWord` types, or add the column via migration. I'll check what's expected and align code to the actual schema.

## Steps

1. Store `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` as secrets
2. Fix `body: audioBytes` → `body: new Blob([audioBytes])` in the edge function
3. Fix the `difficulty` column references in `useReview.ts`, `Learn.tsx`, and `MyWordsReview.tsx`

