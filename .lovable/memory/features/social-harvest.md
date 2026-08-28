---
name: Social Harvest Operations
description: How to run harvest-social-trends — admin Dashboard button, screen batch limits, secret auth
type: feature
---
The Trending feed is filled by the `harvest-social-trends` edge function.

- Auth: `x-harvest-secret: SOCIAL_HARVEST_SECRET`, OR any logged-in admin/content_reviewer JWT.
- Trigger: "Run Social Harvest" card on the admin Dashboard, or POST the function with `{platform, perSource, screenLimit}`.
- Screening is capped per run (default 12, max 30) — each run only screens that many pending posts, so backlogs need repeated runs.
- Long runs outlast the gateway timeout: the client call can cancel while the function keeps working server-side; verify via `social_posts` status counts, not the HTTP response.
- Reddit requires REDDIT_CLIENT_ID/SECRET; unset → Reddit sources skip quietly. JINA_API_KEY optional (raises rate limits).
