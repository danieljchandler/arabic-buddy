

## Video Transcription Deduplication System

### Current Architecture Analysis

From exploring the codebase, I can see the current transcription system has several components:

1. **Storage Tables:**
   - `saved_transcriptions` - stores user transcriptions with lines, vocabulary, grammar points
   - `discover_videos` - stores processed videos with transcripts for public discovery
   - `trending_video_candidates` - temporary storage for discovered videos

2. **Processing Pipeline:**
   - Multiple transcription engines (Deepgram, Fanar, ElevenLabs, etc.)
   - Edge Functions for each step: `download-media`, `analyze-gulf-arabic`, `extract-visual-context`
   - Final enrichment with vocabulary extraction and cultural context

3. **Current Limitations:**
   - No deduplication mechanism
   - Each upload triggers full pipeline regardless of previous processing
   - No shared cache between users or video sources

### Proposed Solution

#### 1. Video Content Hash System
Create a content-based deduplication system using video URLs and metadata:

**New Table: `processed_videos`**
```sql
- id (uuid, primary key)
- content_hash (text, unique) -- SHA-256 of normalized URL + duration
- original_url (text)
- platform (text) -- youtube, tiktok, etc.
- video_id (text) -- platform-specific ID
- duration_seconds (integer)
- processed_at (timestamp)
- transcription_data (jsonb) -- cached result
- processing_engines (text[]) -- which engines were used
- source_language (text)
- dialect (text)
```

#### 2. Enhanced Edge Functions
**Modify existing transcription functions:**

- **`download-media`**: Check `processed_videos` table first before downloading
- **`analyze-gulf-arabic`**: Return cached results if available, otherwise process normally
- **Admin upload pipeline**: Integrate deduplication checks

#### 3. Deduplication Logic
**URL Normalization:**
- YouTube: Extract video ID from various URL formats (youtube.com, youtu.be, m.youtube.com)
- TikTok: Extract video ID from VM and standard URLs
- Create consistent hash: `SHA-256(platform + video_id + duration_tolerance)`

**Cache Hit Strategy:**
1. Generate content hash from input URL
2. Query `processed_videos` for existing entry
3. If found and recent (< 30 days): return cached transcription
4. If found but stale: reprocess and update cache
5. If not found: process normally and cache result

#### 4. User Experience Enhancements
**Fast Response for Duplicates:**
- Return cached results within 2-3 seconds instead of 30-60 seconds
- Display cache status to users ("Using previously processed version")
- Allow users to force reprocessing if needed

**Cross-User Benefits:**
- If User A processes a YouTube video, User B gets instant results
- Maintain user privacy while sharing processing benefits
- Each user still gets their own `saved_transcriptions` entry

#### 5. Cost Optimization Features
**Processing Analytics:**
- Track cache hit rates
- Monitor API usage reduction
- Estimate cost savings from deduplication

**Intelligent Caching:**
- Prioritize caching for popular content (high view counts)
- Expire cache for very old or low-engagement content
- Background refresh for frequently accessed videos

### Implementation Steps

1. **Database Schema Updates**
   - Create `processed_videos` table with proper indexes
   - Add RLS policies for admin-only write access, public read
   
2. **URL Processing Library**
   - Create utility functions for URL normalization
   - Implement content hash generation
   - Handle edge cases (private videos, deleted content)

3. **Edge Function Modifications**
   - Update `download-media` with deduplication checks
   - Modify `analyze-gulf-arabic` to use/store cached results
   - Add cache statistics to response metadata

4. **Frontend Integration**
   - Update upload forms to show cache status
   - Add option to bypass cache if needed
   - Display processing time savings to users

5. **Admin Tools**
   - Cache management interface
   - Processing statistics dashboard
   - Manual cache invalidation controls

### Technical Considerations

**Data Consistency:**
- Handle race conditions when multiple users upload same video simultaneously
- Ensure transcription quality remains consistent across cache hits
- Version control for processing pipeline changes

**Storage Optimization:**
- Compress cached transcription data
- Implement TTL for cache entries
- Background cleanup for unused entries

**Performance:**
- Database indexes on content_hash and video_id
- In-memory caching for frequently accessed entries
- Async cache warming for trending content

### Expected Benefits

**Cost Reduction:**
- 60-80% reduction in transcription API calls for popular content
- Significant savings on YouTube/TikTok processing fees
- Lower storage costs through deduplication

**User Experience:**
- Near-instant results for previously processed videos
- More reliable service during high usage periods
- Consistent quality across duplicate content

**System Efficiency:**
- Reduced load on transcription services
- Better resource utilization
- Improved overall system scalability

