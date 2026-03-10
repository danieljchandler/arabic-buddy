

## Fix Trending Video Approval Pipeline

### Problems

1. **Database migration not applied**: The `discover_videos` table is missing `transcription_status`, `transcription_error`, and `trending_candidate_id` columns. Migration file `20260310200000_auto_transcription_status.sql` exists but was never executed against the live database. The approve mutation inserts with these columns, causing PostgreSQL to reject it.

2. **Build error — `npm:openai` in package.json**: The `openai` npm package is listed in `package.json` dependencies. The Deno edge function type resolver tries to resolve `npm:openai@^4.52.5` and fails because it's not a Deno-compatible specifier. No edge function actually imports it — it's an unused frontend dependency causing deploy failures.

### Plan

**Step 1: Apply the missing database migration**
Run the SQL from the existing migration file to add the three missing columns to `discover_videos`:
```sql
ALTER TABLE discover_videos
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS transcription_error text,
  ADD COLUMN IF NOT EXISTS trending_candidate_id uuid REFERENCES trending_video_candidates(id);

CREATE INDEX IF NOT EXISTS idx_discover_videos_transcription_status
  ON discover_videos (transcription_status) WHERE transcription_status IN ('pending', 'processing');
```
Note: Removing the CHECK constraint since it causes issues with Supabase migrations — validation will be handled at the application level.

**Step 2: Remove `openai` from package.json**
The `openai` npm package is unused (no edge function imports it via `npm:openai`, and no frontend code uses it directly). Removing it fixes the edge function build error.

**Step 3: Redeploy `process-approved-video` edge function**
After the build error is resolved, redeploy to ensure the latest version is active.

### What this fixes
- The thumbs-up approve button will successfully create a `discover_videos` record with transcription tracking columns
- The `process-approved-video` edge function will deploy and run the full transcription pipeline
- Edge function builds will stop failing on the `npm:openai` resolution error

