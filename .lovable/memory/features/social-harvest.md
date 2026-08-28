---
name: Social Harvest Operations
description: How to run harvest-social-trends — admin review queue, per-dialect targets, human approval
type: feature
---
Harvested social content is ADMIN-SIDE ONLY and human-published.

- The AI screen triages: a pass sets `social_posts.status='screened'` (never
  'approved'). A content manager approves/rejects on `/admin/social-trends`
  (status tabs, filters, Run-harvest button). Only 'approved' is publishable.
- Auth for the function: `x-harvest-secret: SOCIAL_HARVEST_SECRET`, OR any
  logged-in admin/content_reviewer JWT.
- Screening is per dialect: `targetPerDialect` (default 5) posts in
  screened/approved per dialect, neediest first, paging older Telegram
  messages (`?before=`) when a page runs thin. Budget: `maxScreenCalls`
  (default 60) and a 100s time cap. The response's `review.<dialect>` says
  `{target, have, queueEmpty}` — `queueEmpty` with `have < target` means the
  dialect needs more sources in `social_content_sources`.
- Long runs outlast the gateway timeout: verify via `social_posts` status
  counts, not the HTTP response.
- Reddit requires REDDIT_CLIENT_ID/SECRET; unset → Reddit sources skip
  quietly. JINA_API_KEY optional (raises rate limits).
- Do not resurrect a learner-facing Trending page without deliberate design:
  RLS now restricts social_posts/trending_topics reads to content managers.
