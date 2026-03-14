

# Auto-load audio for transcript editor playback

## Problem
When a video is processed (via RunPod or direct download), the audio ends up in storage but isn't automatically loaded into the admin transcript editor. The admin has to manually click "Load Audio" or upload a file to get line-by-line playback working.

## Current audio storage locations
- **`audio` bucket** (public): `{youtube_video_id}.opus` — written by `receive-audio` (RunPod callback)
- **`video-audio` bucket** (private): `{discover_video_id}.mp4` — written by `kickOffServerPipeline` or staged by `receive-audio`
- **`audio_files` table**: tracks `video_id` (YouTube ID) → `storage_path` in the `audio` bucket

## Plan

### 1. Auto-detect and load audio when editing a video (AdminVideoForm.tsx)

Add a `useEffect` that runs when `existingVideo` loads (editing mode). It checks for audio in two places:

1. **`video-audio` bucket**: Try to get a signed/public URL for `{videoId}.mp4` (or `.opus`)
2. **`audio` bucket** (public): Look up the `audio_files` table by matching the `source_url` to find the `storage_path`, then build the public URL

If found, set `stableAudioUrl` directly from the storage URL — no need to download and create a blob. This means the transcript editor immediately has audio for playback.

### 2. Store audio URL on the `discover_videos` record (receive-audio)

Update `receive-audio/index.ts`: after uploading to the `audio` bucket, also write the public URL into the `discover_videos` row (if found) in a way the frontend can use. Since there's no dedicated column for this, we'll use the `audio_files` table lookup approach on the frontend (no schema change needed).

### 3. Implementation details

**AdminVideoForm.tsx** — new effect after existing video loads:
```typescript
useEffect(() => {
  if (!videoId || !existingVideo) return;
  if (stableAudioUrl) return; // already loaded

  const tryLoadAudio = async () => {
    // Strategy 1: video-audio bucket (private, use download)
    const extensions = ['.mp4', '.opus', '.m4a', '.webm'];
    for (const ext of extensions) {
      const { data } = await supabase.storage
        .from('video-audio')
        .createSignedUrl(`${videoId}${ext}`, 3600);
      if (data?.signedUrl) {
        setStableAudioUrl(data.signedUrl);
        return;
      }
    }

    // Strategy 2: audio bucket via audio_files table
    const parsed = parseVideoUrl(existingVideo.source_url);
    const ytId = parsed?.videoId;
    if (ytId) {
      const { data: audioRecord } = await supabase
        .from('audio_files')
        .select('storage_path')
        .eq('video_id', ytId)
        .limit(1)
        .maybeSingle();
      if (audioRecord?.storage_path) {
        const { data: urlData } = supabase.storage
          .from('audio')
          .getPublicUrl(audioRecord.storage_path);
        if (urlData?.publicUrl) {
          setStableAudioUrl(urlData.publicUrl);
          return;
        }
      }
    }
  };

  tryLoadAudio();
}, [videoId, existingVideo, stableAudioUrl]);
```

This is a single-file change to `AdminVideoForm.tsx`. No database migrations or edge function changes needed — just smarter frontend detection of existing audio.

