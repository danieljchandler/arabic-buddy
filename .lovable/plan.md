

## Problem

The entire transcription + enrichment pipeline runs **client-side** in `TranscriptionJobContext`. If you navigate away, close the tab, or the browser crashes, all in-flight API calls and results are lost. The `process-approved-video` edge function already runs the exact same pipeline **server-side** and saves results to the DB — but the "Add Video" form doesn't use it.

## Solution

Reroute the AdminVideoForm upload flow to use the server-side pipeline instead of the client-side one. The flow becomes:

```text
CURRENT (fragile):
  Browser uploads audio → Browser calls 4 ASR engines → Browser calls analyze → Browser saves to DB
  (leave page = everything lost)

NEW (resilient):
  Browser creates DB row (status=pending) → uploads audio to storage → calls process-approved-video
  → returns immediately → user can leave
  → Edge function runs full pipeline server-side → saves results to DB
  → when user returns, polling picks up completed results
```

## Changes

### 1. Create a storage bucket for video audio
- Add a `video-audio` storage bucket (or reuse existing one) so uploaded/downloaded audio files can be stored server-side.

### 2. Update `AdminVideoForm.tsx` — new upload flow
- **`handleDownloadAndProcess`** and the manual file upload + process flow:
  1. Create (or update) the `discover_videos` row with `transcription_status: 'pending'`
  2. Upload the audio file to storage at `video-audio/{videoId}.mp4`
  3. Call `process-approved-video` with `{ videoId }` (fire-and-forget)
  4. Navigate to the edit page for that video (or stay on it)
- Remove the `startJob()` call and client-side pipeline dependency
- The existing `refetchInterval` polling on `useDiscoverVideo` already auto-refreshes when status is `pending` or `processing`

### 3. Update `process-approved-video/index.ts` — support storage audio
- Add a check: if `video-audio/{videoId}.*` exists in storage, download from there instead of calling `download-media`
- This handles the case where audio was uploaded directly rather than downloaded from a URL
- Keep existing URL-download path as fallback

### 4. Simplify `TranscriptionJobContext`
- Keep it for progress display (banner showing "processing in background") but remove the actual pipeline execution
- The context just tracks that a job was kicked off and shows status from the DB polling

### 5. AdminVideoForm UI updates
- The existing status banners (pending, processing, failed, completed) already exist in the form
- When the video is being processed server-side, show the processing banner
- When it completes, the `useDiscoverVideo` polling auto-populates the form fields from the DB

## What stays the same
- All edge functions (ASR, analyze-gulf-arabic, etc.) — untouched
- The `process-approved-video` pipeline logic — just adding a storage-read path
- The polling/auto-refresh logic — already works
- Visual context extraction — will be skipped for now in server-side (no video frames in edge functions), same as current `process-approved-video`

