

## Fix RunPod Blocking the Pipeline

### Problem
RunPod (Jais + Falcon) calls hang during cold starts, blocking the entire `Promise.all` in `analyze-gulf-arabic` until Supabase kills the edge function at ~200s. All successful results from Gemini, Fanar, Claude are lost.

Secondary: The `warmup-runpod` call only exists in `Transcribe.tsx`, not in the admin video upload page where the pipeline actually runs.

### Changes

**1. Add `Promise.race` timeout wrapper in `analyze-gulf-arabic/index.ts`**

Wrap each `callRunPodModel` call in a `Promise.race` with a 45s timeout. If RunPod doesn't respond in 45s, return `{ content: null }` and let the pipeline continue with the other models.

```text
Promise.race([
  callRunPodModel(...),
  new Promise(resolve => setTimeout(() => {
    console.warn('RunPod <model>: timed out at 45s, skipping');
    resolve({ content: null });
  }, 45_000))
])
```

Apply this to both the Jais meta enrichment call (~line 1322) and the Falcon meta enrichment call (~line 1332).

Also reduce the `callRunPodModel` AbortController timeout from 180s to 50s (slightly above the race timeout, as a safety net).

**2. Add warmup call in `AdminVideoForm.tsx`**

Add the same `useEffect` warmup call that exists in `Transcribe.tsx`:
```ts
useEffect(() => {
  supabase.functions.invoke("warmup-runpod").catch(() => {});
}, []);
```

This ensures RunPod endpoints are pre-warmed when the admin navigates to the video upload page.

**3. Reduce `callRunPodModel` retry delay**

Currently retries wait before trying again. With the 45s race timeout, there's limited time for retries. Reduce `RETRY_DELAY_MS` to 3s (from whatever it currently is) and `MAX_RETRIES` to 2.

### Files to modify
- `supabase/functions/analyze-gulf-arabic/index.ts` — Promise.race wrappers, reduced timeout/retries
- `src/pages/admin/AdminVideoForm.tsx` — add warmup-runpod useEffect

### Result
Pipeline completes successfully even when RunPod is cold. Jais/Falcon contribute when warm, gracefully skip when cold. Admin page pre-warms endpoints.

