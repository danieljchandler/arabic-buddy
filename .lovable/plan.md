

## Discover Tab: Video Library with Synced Subtitles and Flashcard Creation

### Overview
A new "Discover" section where admin-uploaded videos from YouTube, TikTok, and Instagram are available for all users. Each video plays with synchronized Arabic subtitles and English translations below, similar to Playaling. Users can tap individual words to see definitions and save them as flashcards.

### How It Works

**Admin uploads a video:**
1. Go to an admin-only "Add Video" page
2. Paste a YouTube/TikTok/Instagram URL
3. The app downloads the audio, runs it through the existing dual-engine transcription + Gemini/Falcon analysis pipeline
4. Admin reviews and edits the generated transcript lines
5. Publishes the video with metadata (title, dialect, difficulty level, thumbnail)

**Users watch a video:**
1. Browse the Discover tab (grid of video cards with thumbnails, duration, dialect, difficulty)
2. Tap a video to open the player page
3. Video plays via embedded YouTube/TikTok player
4. Below the video, the current subtitle line is highlighted and auto-scrolls as the video plays
5. Tapping a line shows/hides the English translation
6. Tapping individual Arabic words opens a popover with the definition and a "Save to My Words" button (reusing the existing LineByLineTranscript component)

### Database Changes

**New table: `discover_videos`**
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| title | text | Video title |
| title_arabic | text | Arabic title (optional) |
| source_url | text | Original YouTube/TikTok/Instagram URL |
| platform | text | 'youtube', 'tiktok', 'instagram' |
| embed_url | text | Platform embed URL for iframe |
| thumbnail_url | text | Thumbnail image URL |
| duration_seconds | integer | Video length |
| dialect | text | e.g. 'Gulf', 'MSA', 'Egyptian', 'Levantine' |
| difficulty | text | 'Beginner', 'Intermediate', 'Advanced', 'Expert' |
| transcript_lines | jsonb | Array of TranscriptLine objects with timestamps |
| vocabulary | jsonb | Extracted vocabulary items |
| grammar_points | jsonb | Grammar notes (optional) |
| cultural_context | text | Cultural notes (optional) |
| published | boolean | Whether visible to users |
| created_by | uuid | Admin who uploaded |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**RLS Policies:**
- Anyone can SELECT where `published = true`
- Admins can INSERT, UPDATE, DELETE (using existing `is_admin()` function)

### New Pages and Components

**1. Discover page (`/discover`)**
- Grid of video cards showing thumbnail, title, duration, dialect badge, difficulty badge
- Filter dropdowns for dialect and difficulty
- Search by title
- Accessible to everyone (no login required to browse)

**2. Video player page (`/discover/:videoId`)**
- Embedded video player (YouTube iframe API / TikTok embed)
- Synchronized subtitle display below the video using the existing `LineByLineTranscript` component
- The active line highlights and auto-scrolls as the video plays
- Clickable words with popover for definitions and "Save to My Words"
- Playback controls: speed (0.5x, 0.75x, 1x), previous/next caption arrows
- Toggle buttons for showing/hiding transcription and translation

**3. Admin: Add Video page (`/admin/videos/new`)**
- URL input field
- "Process" button that triggers: audio download, transcription, analysis
- Editable transcript lines (Arabic text, translation, timestamps)
- Metadata fields: title, dialect, difficulty
- Publish/Save as draft button

**4. Admin: Videos list page (`/admin/videos`)**
- Table of all uploaded videos with edit/delete/publish toggle

### Video Embedding Strategy (Legal Approach)
- **YouTube**: Use the YouTube IFrame Player API (`https://www.youtube.com/embed/{videoId}`) which provides JavaScript controls for current time, play/pause, and playback speed
- **TikTok**: Use TikTok embed (`https://www.tiktok.com/embed/v2/{videoId}`) -- more limited controls
- **Instagram**: Use Instagram embed -- most limited

For subtitle sync, the YouTube IFrame API is the most capable since it exposes `getCurrentTime()` which we can poll to highlight the correct subtitle line.

### Home Screen Update
- Add a "Discover" button on the home page between existing modules
- Use a Play/Video icon

### Routing
- `/discover` -- video grid/browse page
- `/discover/:videoId` -- video player page
- `/admin/videos` -- admin video list
- `/admin/videos/new` -- admin add video
- `/admin/videos/:videoId/edit` -- admin edit video

### Technical Details

**Subtitle sync mechanism:**
- Poll the YouTube player's `getCurrentTime()` every 200ms
- Compare against each line's `startMs`/`endMs` to determine the active line
- Auto-scroll the transcript to keep the active line visible
- Reuse existing `LineByLineTranscript` component with a new `currentTimeMs` prop

**Transcription pipeline (reuse existing):**
- Download audio via `download-media` edge function
- Transcribe via `elevenlabs-transcribe` + `munsit-transcribe`
- Analyze via `analyze-gulf-arabic` (Gemini + Falcon)
- Return structured lines with timestamps, tokens, glosses

**YouTube embed URL extraction:**
- Parse video ID from various YouTube URL formats
- Construct embed URL: `https://www.youtube.com/embed/{id}?enablejsapi=1`

**Word-to-flashcard flow:**
- Tap word in subtitle, popover shows definition
- "Save to My Words" inserts into `user_vocabulary` table (existing flow)
- Audio context from the subtitle line's timestamps can be clipped and stored

