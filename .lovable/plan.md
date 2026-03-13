
### What failed (plain-English)
Your background transcription did run, but it failed at the **analysis step** (after transcription), not at the initial “start job” step.

From the latest run for video `506e9ced-1ba9-455b-b223-5872d39beacc`:
1. Job started successfully.
2. It got audio successfully.
3. Transcription engines ran (Deepgram + Soniox succeeded; Fanar failed but that is non-blocking).
4. Then the analysis call failed with **401 Unauthorized**.
5. The job was marked `failed` with:
   `Analysis failed (401): {"error":"Unauthorized"}`

### Why it failed (technical details)
There are **two separate issues**:

1. **Primary blocker (causes job failure):**
   - In `process-approved-video`, the call to `analyze-gulf-arabic` uses:
     `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
   - But `analyze-gulf-arabic` explicitly validates a **user JWT** via `auth.getUser()`.
   - A service-role key is not a user JWT, so the function returns 401.

2. **Secondary issue (causes upload errors and stale file reuse):**
   - Client upload to `video-audio` failed with RLS (`new row violates row-level security policy`).
   - This happens on re-runs because upload uses `upsert: true`, but `video-audio` has INSERT policy and **no UPDATE policy** for that bucket.
   - Result: upload can fail, and the pipeline may reuse an old stored audio file.

### Fix plan
1. **Auth fix in pipeline orchestration**
   - In `process-approved-video`, pass through the original incoming user `Authorization` header when calling:
     - `analyze-gulf-arabic`
     - `download-media` (fallback path)
   - Keep service role usage only for DB/storage operations.

2. **Storage policy fix**
   - Add `UPDATE` (and preferably `DELETE`) storage policies for `video-audio` for admins, or change upload strategy to avoid upsert collisions.

3. **Stale audio prevention**
   - Before upload/reprocess, remove existing `videoId.*` audio objects (or use deterministic extension + overwrite policy) so the latest file is always used.

4. **Validation**
   - Re-run on same video ID (re-transcribe) and confirm:
     - no storage 403 on upload
     - analysis no longer returns 401
     - `transcription_status` becomes `completed`.
