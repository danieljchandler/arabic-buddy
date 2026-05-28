# Shadow Mode for Pronunciation Practice (native-video sourced)

A new **Shadow** mode under `/pronunciation-practice` that drills the classic shadowing technique against **real native-speaker clips from Discover videos and saved transcriptions** — no TTS, no synthesized voices anywhere in the loop.

## What the learner experiences

A new "Shadow" tab joins Word / Sentence. Tapping it opens a Shadow session built from a queue of short native-clip "takes".

Per take:
1. **Listen** — the clip plays inline (YouTube/TikTok iframe seek, or saved-transcription `audio_url`) from `segment.start` to `segment.end`, auto-stopping at the end-time (same pattern as `useVideoSync.seekToSegment`).
2. **Echo window** — the instant playback stops, the mic auto-opens with a countdown ring sized to `(end - start) + 800ms`. A live level meter confirms input.
3. **Auto-stop** on 300ms trailing silence or hard cap at `clip_duration + 1500ms`.
4. **Score** — Azure pronunciation assessment runs against `segment.text` using the video's dialect locale (Gulf → `ar-SA`, Egyptian → `ar-EG`, Yemeni → `ar-SA` fallback).
5. **Decide** — `Replay clip`, `Loop` (re-listen + re-record), `Slower` (0.75x / 0.5x via `playbackRate` on the audio element; YouTube iframe `setPlaybackRate`), `Next`.

Auto-advance: if overall score ≥ threshold (default 80) and Auto-advance is on, move on after 1.2s.

Always-visible controls: speed segmented control, take counter, Auto-advance switch, threshold slider behind Settings disclosure.

End-of-queue summary: average score, items below threshold, "Practice these again" button that re-queues failures.

## Where the clips come from

The session queue is filled from native-speaker sources only:

1. **Discover videos** — `discover_videos.transcript_lines` (jsonb). Each line has `start`, `end`, `text`, optional per-word timings. Filter by the user's active dialect (`DialectContext`).
2. **Saved transcriptions** — `saved_transcriptions` rows the user owns (audio file uploads / imported media). Same segment shape.
3. **Tutor uploads** — already-clipped tutor utterances (existing `audioClipper.ts` artifacts), if available for the user.

Selection rules for a good shadowing clip:
- Duration between 1.2s and 6s.
- `text` length ≥ 2 words.
- Skip segments tagged as music/noise where available.
- Prefer clips matching the user's CEFR level (`difficulty` / `cefr_level` on the video).

A `useShadowQueue` hook fetches and shuffles up to 20 eligible clips per session. **No new tables — purely read-side composition over existing data.**

## Playback per source

- **YouTube** — reuse `useVideoSync.seekToSegment` style: YouTube IFrame API `seekTo(start, true)`, `playVideo()`, poll `getCurrentTime` to pause at `end`. Audio comes from the iframe (we never download).
- **TikTok / Instagram** — these are timer-driven in existing code; reuse that pattern. If a platform doesn't expose audio for shadowing reliably, exclude its clips from the queue.
- **Saved transcriptions** — plain `<audio src={audio_url}>` with `currentTime = start`, `playbackRate` for slow mode, `pause()` at `end` via `timeupdate` listener.

If the active source is a YouTube iframe, the **mic does NOT open until the iframe reports paused** (otherwise the iframe's own audio gets recorded). For phone speakers, recommend headphones via a one-time hint; we cannot fully cancel speaker bleed without echo cancellation, but `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` handles most cases.

## Robustness requirements

- **Mic permission**: requested once on entering Shadow mode; denial shows a recoverable card with retry, never a crash.
- **No TTS anywhere** — pronunciation reference is always the native clip; if a clip can't load, skip to the next, don't substitute synthesized audio.
- **Iframe-pause gate**: never start recording while the source player is still emitting audio.
- **Echo & silence detection**: `AnalyserNode` RMS over 50ms windows; trailing-silence auto-stop at 300ms; reject blobs < 4KB or never-crossed-threshold with "We didn't hear you".
- **Stale-response guard**: extends existing `requestIdRef` in `useAzurePronunciation` — switching takes mid-assessment discards results.
- **Locale routing**: derive Azure locale from video's `dialect` field, not hard-coded `ar-SA`.
- **Reduced motion**: countdown ring fades instead of sweeping when `useReducedMotion()` is true.
- **Sound preference**: if `isSoundEnabled()` is false, Shadow tab is disabled with a tooltip — it cannot work silently.
- **Cleanup**: stop `MediaStream` tracks between takes (mic indicator turns off); pause iframe on tab unmount.
- **Empty queue**: if no eligible clips, show an empty state pointing to `/discover` or `/transcribe` rather than a blank page.

## Technical layout

New files:
- `src/components/pronunciation/ShadowPlayer.tsx` — orchestrates per-take state machine. Props: `clip`, `onResult(score)`, `onNext`, `threshold`, `autoAdvance`.
- `src/components/pronunciation/CountdownRing.tsx` — SVG ring, reduced-motion aware.
- `src/components/pronunciation/LevelMeter.tsx` — bar fed by an AnalyserNode.
- `src/components/pronunciation/ClipSourcePlayer.tsx` — abstracts YouTube / TikTok / `<audio>` playback behind a single `{ play(start, end, rate), pause, isPlaying, onEnded }` interface.
- `src/hooks/useShadowQueue.ts` — pulls eligible clips from `discover_videos.transcript_lines`, `saved_transcriptions`, and tutor uploads; filters by dialect/CEFR/duration; returns `{ clips, loading, refresh }`.
- `src/hooks/useShadowRecorder.ts` — wraps `MediaRecorder` + silence detection (using `src/lib/audioSpeechDetector.ts`); exposes `{ start, stop, isRecording, level, lastBlob, error }`.

Edits:
- `src/pages/PronunciationPractice.tsx` — add `mode: "shadow"`; when active, render queue header + `<ClipSourcePlayer>` + `<ShadowPlayer>` instead of the current mic UI. Keep session-stats / score-card styling for parity.
- `src/lib/audioSpeechDetector.ts` — confirm RMS tail-silence helper is exported; add if missing.

No new edge functions. No DB migration. Existing `azure-pronunciation` function handles scoring unchanged.

State machine inside ShadowPlayer:

```text
idle → playing-clip → waiting-pause → echo-window (recording) → scoring → result
  ↑                                                                       │
  └──────────── replay / loop / slower / next ────────────────────────────┘
```

## Out of scope

- Any TTS or synthesized audio (explicitly excluded).
- Word-level karaoke highlight (no per-word timings on most Discover lines).
- Saving learner audio takes to storage.
- New tables, edge functions, or admin UI.

## Acceptance checks

- Every reference audio in Shadow mode comes from a Discover video, saved transcription, or tutor clip — never TTS.
- Mic auto-opens only after the source player has paused.
- Loop replays the same native clip without re-fetching.
- Slower mode changes playback rate of the native clip; reference text unchanged.
- Score card matches the existing Word/Sentence styling.
- Denying mic, empty queue, and clip-load failure all show recoverable UI.
- Reduced-motion and sound-off users get correct fallbacks (fade / disabled tab).
