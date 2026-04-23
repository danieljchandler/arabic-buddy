

## Goal
Make TikTok videos sync subtitles automatically — like YouTube — without manual "Start sync" buttons. Audio plays/pauses with the transcript, and seeking a phrase actually jumps the playback.

## The trick
The admin already uploaded the source MP4 to our private `video-audio` bucket for transcription. **That file is the perfect sync source** — we have full JS control over it (HTML5 `<audio>` API), and its timeline is exactly what the transcript timestamps were generated from.

We keep the TikTok iframe visible (so viewers see the official TikTok player as required), **mute it**, and play our own hidden `<audio>` element underneath as the source of truth for time. The user hears our audio; the iframe is purely a visual.

```text
┌─────────────────────────────┐
│   TikTok iframe (muted)     │ ← visible, autoplay muted loop
│      visual only            │
└─────────────────────────────┘
        ▲
        │ user taps overlay play button
        ▼
┌─────────────────────────────┐
│ Hidden <audio> from         │ ← drives currentTimeMs
│ video-audio bucket (signed) │ ← seekable, pausable, speedable
└─────────────────────────────┘
        │
        ▼
   Transcript highlight + phrase-mode pause
   (same logic as YouTube path)
```

## Changes

### 1. `src/lib/vocabularyAudioContext.ts` — `resolveDiscoverVideoAudioUrl`
Already resolves the source MP4 from the `video-audio` bucket via signed URL. Reuse it.

### 2. `src/pages/DiscoverVideo.tsx`

**a. Add a hidden `<audio ref={tiktokAudioRef}>` for TikTok videos**
- `src` = signed URL from `resolveDiscoverVideoAudioUrl(video)` (resolved on mount).
- Listeners: `timeupdate` → `setCurrentTimeMs(audio.currentTime * 1000)`, `play`/`pause` → set a `tiktokPlaying` state.

**b. Treat TikTok like YouTube in the `activeLineId` calculation**
- Drive the highlight from `currentTimeMs` (from our hidden audio), not the manual `timerMs`.
- Delete the manual "Start subtitle sync" / "Reset" / timer button row entirely.

**c. Wire `handleSeek` for TikTok**
- `tiktokAudioRef.current.currentTime = ms / 1000; .play()`. Now clicking a transcript line or phrase arrow actually jumps audio + subtitle in lock-step (same as YouTube).

**d. Phrase-mode auto-pause**
- The existing YouTube `useEffect` that watches `currentTimeMs >= phraseEndMs` and pauses can be generalized to also call `tiktokAudioRef.current?.pause()` when `isTikTok`.

**e. Speed control**
- `tiktokAudioRef.current.playbackRate = playbackSpeed` in the existing speed-change effect.

**f. Visible play/pause button**
- Add a single big play/pause overlay (or a toolbar button) that toggles the hidden audio. The TikTok iframe stays muted underneath as decoration.
- iframe `src` gets `&muted=1&autoplay=1&loop=1` appended so it plays silently as a moving visual; audio comes only from our element.

### 3. Fallback
If `resolveDiscoverVideoAudioUrl` returns null (rare — e.g. legacy TikTok entries imported before the upload requirement), fall back to the current manual timer button so nothing breaks.

## Out of scope
- Frame-perfect lip sync between the muted TikTok visual and our audio. The audio is authoritative; the iframe is a looping visual companion. Most users won't notice given short clips, and it's vastly better than no sync at all.
- Hiding the TikTok branding/UI.

## Result
TikTok videos behave like YouTube: tap play, audio + transcript advance together, click any line to seek, phrase mode auto-pauses at end of line, speed control works. No manual sync button.

