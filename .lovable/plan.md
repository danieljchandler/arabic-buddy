

## Fix: Client Timeout on analyze-gulf-arabic

### Problem
`AdminVideoForm.tsx` calls `supabase.functions.invoke("analyze-gulf-arabic")` which uses the default Supabase client timeout (~60-90s). The function ran for ~200s due to Jais and Falcon cold-start timeouts (45s each), causing the client to abort before receiving the successful response.

`Transcribe.tsx` already has a custom 5-minute fetch timeout for this same function — `AdminVideoForm` does not.

### Plan

1. **Apply the same 5-minute AbortController pattern to AdminVideoForm**
   - Replace `supabase.functions.invoke("analyze-gulf-arabic", ...)` with a direct `fetch()` call using a 5-minute `AbortController`, matching the pattern already used in `Transcribe.tsx`.

2. **Remove Falcon from the analyze-gulf-arabic pipeline**
   - Falcon (`owodjrizyv47m0`) consistently returns HTTP 500 or times out. It adds 45s of wasted wait time every run.
   - Remove Falcon from the parallel enrichment race, keeping only Jais + Fanar + Qwen/Gemini.
   - This alone would cut ~45s from the worst-case execution time.

3. **Pre-warm Jais before analysis starts**
   - Fire a non-blocking warmup call to the Jais `/run` endpoint at the start of the upload flow (when ASR begins), so Jais is warm by the time `analyze-gulf-arabic` needs it ~10s later.

### Impact
- Eliminates the client-side timeout error
- Reduces worst-case function runtime from ~200s to ~100-120s
- Removes dead Falcon endpoint that only wastes time

