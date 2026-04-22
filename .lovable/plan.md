

## Goal
Admin adds a TikTok video to Discover by uploading the **downloaded MP4** (used **only** for transcription) **and** pasting the **TikTok URL** (used for the embedded player). No self-hosted playback. No new storage bucket.

## Flow

```text
Admin form (Discover → Add Video)
├── TikTok URL          → drives embed (existing TikTok iframe path)
└── Upload video file   → audio extracted → transcription pipeline
                          (file is discarded after transcription)
```

## Changes

### 1. `src/pages/admin/AdminVideoForm.tsx`
- When platform = TikTok, show **two required inputs together**:
  - **TikTok URL** (existing field) — required, parsed via `getTikTokEmbedUrl` / `resolve-tiktok-url`. This populates `source_url`, `platform='tiktok'`, `embed_url`.
  - **Upload TikTok file (.mp4)** — required for new TikTok entries that don't have YouTube-style auto-transcription. File is fed straight into the existing `kickOffServerPipeline(file)` path that uploads to the `video-audio` bucket and calls `process-approved-video`.
- The uploaded file is **not stored** on `discover_videos` — no new column, no public URL. Once transcription completes, the file lives only in the existing private `video-audio` bucket as the pipeline's working copy (same as today's audio uploads).
- Thumbnail: capture frame 0 from the uploaded file client-side → upload to existing `flashcard-images` bucket → save as `thumbnail_url` (so the Discover grid has a tile image even though we're not hosting the video).
- Duration: read from the file's `loadedmetadata` → save to `duration_seconds`.

### 2. `src/pages/DiscoverVideo.tsx`
- No new branch needed. TikTok entries continue to render through the existing TikTok iframe embed using `embed_url` (built from the pasted URL). Transcript syncs via the current TikTok manual-timer strategy.

### 3. `src/hooks/useDiscoverVideos.ts`
- No type changes — `platform` stays `'tiktok'`, `source_url` stays the TikTok link, no new columns.

### 4. Schema
- **No migration.** Existing `discover_videos` columns are sufficient.

### 5. Validation
- Block submit on TikTok platform unless **both** the URL parses to a valid TikTok embed **and** an MP4 has been uploaded for transcription.
- Other platforms (YouTube, Instagram) keep their current single-URL flow.

## Out of scope
- Self-hosted video playback.
- New storage bucket.
- Public end-user uploads.

## Result
Admins paste the TikTok link (for the embedded player viewers see) **and** drop in the downloaded MP4 (so the transcription pipeline has clean audio to work from). Discover continues to display the official TikTok embed — never a self-hosted file.

