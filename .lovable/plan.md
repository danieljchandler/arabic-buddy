

## Fix Build Errors: Missing `fanarValidResp` and `dialectValidation` Type

### Problem
Two build errors prevent the edge function from deploying:

1. **`fanarValidResp` is undefined** -- The `Promise.all` on line 983 runs 4 parallel calls but only destructures 3 results: `[geminiTransResp, analysisResp, fanarMetaResp]`. The 4th result (Fanar dialect validation) is never captured, causing `fanarValidResp` to be undefined on lines 1028-1033.

2. **`dialectValidation` not on `TranscriptResult` type** -- The edge function returns `dialectValidation` in its response (line 1164), and `Transcribe.tsx` reads it (line 741), but the `TranscriptResult` type in `src/types/transcript.ts` doesn't include this field.

### Fix 1: Capture 4th Promise result (`analyze-gulf-arabic/index.ts`)

Change line 983 from:
```typescript
const [geminiTransResp, analysisResp, fanarMetaResp] = await Promise.all([
```
To:
```typescript
const [geminiTransResp, analysisResp, fanarMetaResp, fanarValidResp] = await Promise.all([
```

### Fix 2: Add `dialectValidation` to `TranscriptResult` type (`src/types/transcript.ts`)

Add to the `TranscriptResult` type:
```typescript
dialectValidation?: { content: string; timestamp: string } | null;
```

### What this fixes
- The edge function will compile and deploy successfully
- Fanar dialect validation results will be properly captured and returned
- The Transcribe page will be able to store dialect validation data without type errors

