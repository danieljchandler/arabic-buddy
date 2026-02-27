

## Problem

The "How Do I Say" page error (`AI service error (400)`) is caused by the **deployed edge function being out of date**. The logs show it's still trying to use `qwen/qwen3-5-plus` as a model ID on OpenRouter, which doesn't exist. The current source code has already been updated to use `qwen/qwen3-30b-a3b`, but the function was never redeployed.

Evidence:
- Edge function log: `"qwen/qwen3-5-plus is not a valid model ID"` (the old model)
- Current source code (line 243): uses `qwen/qwen3-30b-a3b` (the new model)
- The old deployed version also throws on 400 errors instead of returning null, which crashes the entire request even though other models (Gemini, Fanar) could handle it

## Fix

**Redeploy the `how-do-i-say` edge function.** No code changes needed -- the source code is already correct. The redeployment will pick up:

1. The corrected model ID (`qwen/qwen3-30b-a3b` instead of the invalid `qwen/qwen3-5-plus`)
2. Graceful error handling in `callAI` (returns `null` on 400 errors instead of throwing)
3. The expanded 4-model parallel pipeline (Gemini + Qwen + Gemma + Fanar) instead of just 2 models

