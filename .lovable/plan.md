
# Daily Trending Video Discovery System

## Current Architecture Analysis

The app already has:
- `discover_videos` table for storing video content with approval workflow
- Admin-only video management system with approval before publication
- Edge functions for YouTube captions (`fetch-youtube-captions`) and TikTok URL resolution (`resolve-tiktok-url`)
- Existing video processing pipeline for transcription and analysis

## Technical Implementation Plan

### 1. Database Schema Extension

Add new table `trending_video_candidates` to store discovered videos before admin approval:
```sql
CREATE TABLE trending_video_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  video_id text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  creator_name text NOT NULL,
  creator_handle text,
  thumbnail_url text,
  view_count bigint,
  trending_score integer,
  detected_topic text,
  discovered_at timestamp with time zone DEFAULT now(),
  processed boolean DEFAULT false,
  rejected boolean DEFAULT false,
  rejection_reason text,
  UNIQUE(platform, video_id)
);
```

### 2. Multi-Source Discovery Pipeline

Create edge function `discover-trending-videos` that aggregates from multiple APIs:

**YouTube Sources:**
- YouTube Data API v3 (trending videos by region)
- Third-party trending APIs (RapidAPI marketplace)

**TikTok Sources:**
- TikTok Research API (if available)
- Web scraping through proxy services
- Third-party social media APIs

**Content Filtering Logic:**
- Channel/creator blacklist for gaming, news, Quran content
- Keyword filtering in titles/descriptions
- Topic classification using AI models
- Language detection (Arabic content priority)

### 3. Daily Automation via Cron

Implement scheduled execution using Supabase's `pg_cron`:
```sql
SELECT cron.schedule(
  'discover-trending-videos',
  '0 6 * * *', -- Daily at 6 AM
  $$
  SELECT net.http_post(
    url:='https://ovscskaijvclaxelkdyf.supabase.co/functions/v1/discover-trending-videos',
    headers:='{"Authorization": "Bearer [ANON_KEY]"}'::jsonb
  );
  $$
);
```

### 4. Content Analysis & Approval Workflow

**Automated Analysis:**
- Detect video language and dialect
- Extract metadata (duration, description)
- Generate topic tags using AI classification
- Estimate difficulty level
- Score relevance for Arabic learners

**Admin Dashboard Integration:**
- New section in admin panel for reviewing discovered content
- Bulk approve/reject interface
- One-click promotion to `discover_videos` table
- Filtering by platform, topic, trending score

### 5. API Requirements & Costs

**Required API Keys:**
- YouTube Data API v3 (free tier: 10,000 requests/day)
- RapidAPI subscription for additional sources
- Proxy services for TikTok scraping

**Content Filtering APIs:**
- Hugging Face for topic classification
- OpenRouter for content analysis
- Custom blacklist maintenance

### 6. Implementation Steps

1. **Create database schema** for candidate storage
2. **Build discovery edge function** with multi-source aggregation
3. **Implement filtering logic** with AI-powered topic detection
4. **Set up cron job** for daily execution
5. **Extend admin UI** for candidate review and approval
6. **Add monitoring** for API quotas and discovery metrics

### 7. Content Flow

```
Daily Cron → Discovery Function → API Calls → Content Filtering → 
Store Candidates → Admin Review → Approve → Transfer to discover_videos → 
Transcription Pipeline
```

### 8. Configuration & Monitoring

- Environment variables for API keys and filtering rules
- Admin settings for discovery frequency and source priorities
- Metrics tracking: discovery success rate, approval ratio, content quality
- Error handling for API failures and rate limits

### 9. Scalability Considerations

- Rate limiting to respect API quotas
- Batch processing for large result sets
- Duplicate detection across platforms
- Historical tracking to avoid re-processing

This system will automatically discover Arabic content daily while maintaining quality through AI filtering and admin approval, seamlessly integrating with the existing video processing pipeline.
