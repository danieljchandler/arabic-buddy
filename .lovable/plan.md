## #10 Personalized Discover Feed

Today the Discover page shows newest-first videos filtered by dialect/difficulty. The goal is a per-user ranked feed that surfaces videos most likely to be useful **right now** — based on the learner's known vocabulary, active dialect, CEFR level, watch history, and engagement.

### What the user gets

- A new **"For You"** tab at the top of Discover (default), with existing filter view kept as **"Browse"**.
- Each card shows a small **"why this"** chip: e.g. *"92% known words"*, *"Matches your B1 level"*, *"New in Gulf"*, *"Because you liked X"*.
- A subtle **comprehension bar** on each card (green = mostly known, amber = stretch, red = too hard) so users can self-pace.
- Pull-to-refresh / "Shuffle" button to reroll the feed.
- Empty/cold-start state: falls back to curated trending + level-matched picks.

### Ranking signal mix

Each candidate video gets a score 0–1 from a weighted sum:

| Signal | Weight | Source |
|---|---|---|
| Known-vocab overlap (i+1 sweet spot: 80–95%) | 0.35 | `user_vocabulary` ∩ `discover_videos.vocabulary` |
| CEFR-level match (±1 band ok, same band best) | 0.20 | `profiles.cefr_level` vs `difficulty` |
| Active-dialect match | 0.15 | `DialectContext` vs `video.dialect` |
| Freshness (decay over 30d) | 0.10 | `created_at` |
| Engagement prior (likes/views ratio) | 0.10 | `video_likes`, view logs |
| Novelty (penalise already-watched / similar to recent) | 0.10 | `video_views` history |

Hard filters: exclude videos the user has fully watched in last 14d unless they liked it. Always include 1 "stretch" pick (difficulty +1) and 1 "comfort" pick (mostly known) in the top 10 for variety.

### Technical Section

**Data**
- New table `video_views (user_id, video_id, watched_seconds, completed bool, watched_at)` — RLS: user can read/write own rows.
- Reuse existing: `user_vocabulary`, `video_likes`, `discover_videos.vocabulary` (jsonb array of lemmas), `profiles.cefr_level`.
- Add `discover_videos.vocab_lemmas text[]` generated/maintained alongside `vocabulary` jsonb so we can do fast `&&` overlap in SQL. Backfill in migration.

**Ranking**
- New edge function `discover-feed` (`verify_jwt = false`, validates JWT in-code per project pattern). Input: `{ limit, exclude_ids?, seed? }`. Returns ranked `video_id`s plus per-video `reason` + `comprehension` (0–1).
- Implementation:
  1. Load user's lemma set (cap 5k most recent), CEFR, active dialect.
  2. Pull candidate pool: published videos, last 180d, dialect in (active, MSA). Cap 300.
  3. Score in JS using formula above. Inject 1 stretch + 1 comfort pick. Shuffle within score buckets using `seed` for stable pagination.
  4. Cache result for 15 min keyed by `(user_id, active_dialect, seed)` in a lightweight `feed_cache` table to keep page loads fast.

**Frontend**
- Extend `useDiscoverVideos` with `useDiscoverFeed()` hook that calls the edge function then hydrates from `discover_videos` by id (preserves existing video shape).
- New `<DiscoverFeedTab />` component; existing filter UI becomes `<DiscoverBrowseTab />`. Tabs via shadcn `Tabs`.
- Card additions: comprehension bar (computed client-side from returned `comprehension`), "why this" chip (from `reason`), Shuffle button regenerates `seed`.
- Track views: on `DiscoverVideo` page, write to `video_views` on play, throttle updates every 10s, mark `completed` at ≥85% watched.

**Cold start**
- If `user_vocabulary` < 20 rows or no `cefr_level`: fall back to trending (likes desc, freshness) filtered by active dialect. Show small banner: *"Take the placement quiz to personalize your feed."*

### Out of scope (future)
- Collaborative filtering ("users like you watched…"). Defer until we have ≥1k DAU.
- ML embeddings on transcripts for topical similarity.
- Push notifications for new matched videos.

Ready to build on approval.
