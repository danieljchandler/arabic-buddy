

## Update Falcon RunPod Endpoint

Replace the old Falcon endpoint ID `tnhfklb3tb7md8` with `owodjrizyv47m0` across all 6 edge functions. Since it's a vLLM worker, the `/openai/v1/chat/completions` path will work — just a simple ID swap.

### Files to update (all same change: `tnhfklb3tb7md8` → `owodjrizyv47m0`)

| File | Lines |
|------|-------|
| `supabase/functions/hf-chat/index.ts` | Line 9 |
| `supabase/functions/analyze-gulf-arabic/index.ts` | Line 1136 |
| `supabase/functions/classify-tutor-segments/index.ts` | Lines 75, 157 |
| `supabase/functions/falcon-translate/index.ts` | Line 11 |
| `supabase/functions/curriculum-chat/index.ts` | Line 22 |
| `supabase/functions/warmup-runpod/index.ts` | Line 19 |

No logic changes needed — pure string replacement in each file.

