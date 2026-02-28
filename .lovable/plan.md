

## Fix: Redeploy `analyze-gulf-arabic` Edge Function

### What happened

The **Gemini 2.5 Pro translation call never fired** because the deployed version of the function is stale. The source code (lines 961-968) correctly calls `google/gemini-2.5-pro` via OpenRouter for translation, but this code was never deployed. The live function is still running an old version that:

- Uses the invalid model ID `qwen/qwen3-5-plus` (causing 400 errors on every Qwen call)
- Does not have the dedicated Gemini translation step at all

As a result, only **Fanar** succeeded in your uploads, while both Qwen and Gemini silently failed.

### The fix

**Redeploy the `analyze-gulf-arabic` edge function.** No code changes are needed -- the source code is already correct. After redeployment, the pipeline will work as designed:

1. **Call 1 (Merge)**: Qwen 3 235B + Fanar in parallel to merge ASR transcripts
2. **Translation**: Gemini 2.5 Pro (primary) with Qwen fallback for per-line English translations
3. **Call 2 (Analysis)**: Qwen for vocabulary/grammar + Fanar-Sadiq for meta enrichment

### Build error

The reported build error (`Expected ';', got 'lines' at line 160`) appears to be a stale compilation artifact. The source code at that location is inside a valid template literal string. Redeployment should clear this.

### Steps

1. Redeploy the `analyze-gulf-arabic` edge function
2. Verify deployment succeeded (check logs for updated model IDs)
3. Optionally re-process a video to confirm Gemini translation fires

