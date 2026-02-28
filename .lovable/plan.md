

## Switch Gemini 2.5 Pro Translation to Lovable AI Gateway

### Problem
The Gemini 2.5 Pro translation call in `analyze-gulf-arabic` currently goes through OpenRouter, which ran out of credits (402 error). Lovable AI gateway has `google/gemini-2.5-pro` available with pre-configured credits.

### Changes (single file: `supabase/functions/analyze-gulf-arabic/index.ts`)

**1. Update `callAI` to support Lovable AI gateway**

Add an optional `gateway` parameter (`'openrouter' | 'lovable'`) to the `CallAIArgs` type. When `gateway` is `'lovable'`:
- Use URL: `https://ai.gateway.lovable.dev/v1/chat/completions`
- Use `LOVABLE_API_KEY` instead of the passed `apiKey`
- Keep all other logic (timeout, parsing, error handling) identical

**2. Switch the Gemini translation call to Lovable AI**

Change lines 961-968 from:
```typescript
callAI({
  model: 'google/gemini-2.5-pro',
  systemPrompt: getTranslationSystemPrompt(),
  userContent: mergedTranscriptText,
  apiKey: OPENROUTER_API_KEY,
  maxTokens: 16384,
})
```
To:
```typescript
callAI({
  model: 'google/gemini-2.5-pro',
  systemPrompt: getTranslationSystemPrompt(),
  userContent: mergedTranscriptText,
  apiKey: '', // not used for lovable gateway
  gateway: 'lovable',
  maxTokens: 16384,
})
```

**3. Read `LOVABLE_API_KEY` at the top** alongside the other env vars (it's already a configured secret).

### What stays the same
- Qwen calls continue through OpenRouter (unchanged)
- Fanar calls continue through their direct API (unchanged)
- Fallback logic: if Gemini fails, Qwen still handles translation as fallback
- The function will be auto-deployed after the code change

