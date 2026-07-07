# Story slideshow (pivot from video)

Video generation via Veo was too expensive and unreliable (English speech leaks, quota exhaustion). Pivoted to a **slideshow**: AI-generated scene images + exact Arabic narration audio, played sequentially in the admin preview / player.

## Architecture
- `generate-story-video` → generates **1 preview scene image** (`google/gemini-3.1-flash-image`) + **1 narration audio clip** (Munsit / ElevenLabs / Azure via `planProvider(dialect)`). Saves image url to `story_video_url` and audio url to `video_preview_url`.
- `generate-story-video-full` → plans 3–6 scenes with a shared style anchor + character sheet, then for each scene generates image + audio. Writes into `story_video_segments` (jsonb array of `{ image_url, audio_url, narration_arabic, arabic_beat, duration_seconds, prompt, index }`).
- Admin approval flow unchanged: generate preview → approve preview → generate full slideshow.
- Reader-facing pages already play per-line audio; no changes required there.

## Constraints
- All narration comes from exact Arabic script (`body_fusha` / approved lines) — the image model never generates speech.
- Image prompts explicitly forbid text/captions/subtitles/signs/Latin/Arabic letters so no on-image writing appears.
- Legacy `url` field kept on segments alongside `image_url` for backwards compat.
