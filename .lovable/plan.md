

## Fix Trending Videos Fetch

### Problem
The edge function discovers candidates successfully (logs confirm videos are found and filtered). The upsert on the frontend fails because `region_code` and `duration_seconds` columns don't exist in the `trending_video_candidates` table, but the frontend code (lines 138-139) includes them in the upsert payload.

### Solution

**1. Database migration — add two missing columns**

```sql
ALTER TABLE trending_video_candidates 
  ADD COLUMN region_code text,
  ADD COLUMN duration_seconds integer;
```

This is the cleanest fix since both the edge function and frontend already handle these fields. No code changes needed — the existing `TrendingVideos.tsx` and edge function are already correct.

### What this fixes
- The "Fetch