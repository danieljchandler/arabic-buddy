## Pivot: Slideshow stories instead of video

Replace Veo video generation with AI-generated scene images played as a timed slideshow synced to the existing Munsit/ElevenLabs/Azure Arabic narration. Same admin approval flow, dramatically cheaper, and the Arabic audio remains exact to the script.

## What changes

### 1. Content model
- Split each story into ordered **scenes** (already how the planner thinks). Each scene stores:
  - `image_url` — AI-generated illustration
  - `audio_url` — Arabic narration for that scene's exact script lines
  - `arabic_text` / `english_text` — the lines being narrated
  - `duration_ms` — from the generated audio
- Store as a JSON array on the story row (reusing `video_preview_url` / a new `scenes_json` column), so no heavy schema churn.

### 2. Preview generation (admin "Generate Preview")
- Planner picks **1 representative scene** from the Arabic script.
- Generate **1 image** via Lovable AI Gateway (`google/gemini-3.1-flash-image`, cheap + fast, good for illustrated scenes).
- Generate **1 Arabic narration clip** via existing `planProvider(dialect)` → Munsit / ElevenLabs / Azure.
- Save `{ image_url, audio_url, arabic, english }` as the preview payload.

### 3. Full story generation (after admin approves preview)
- Planner returns N ordered beats quoting exact Arabic lines.
- For each beat, in parallel-with-limit:
  - Generate scene image (same model, consistent style prompt so characters/setting stay coherent).
  - Generate Arabic narration audio for that beat's exact lines.
- Store the ordered scenes array on the story.

### 4. Player (StoryPlayer / admin preview)
- New lightweight slideshow component:
  - Shows current scene image full-bleed
  - Plays its audio; on `ended` advances to next scene
  - Crossfade between images
  - Controls: play/pause, prev/next, replay, show/hide Arabic + English captions (respecting global immersion prefs)
- Admin form: preview player shows the single preview scene (image + audio, tap to play).

### 5. Cleanup
- Stop calling Veo. Remove Veo prompt-building and the `veo-3.1-fast-generate-preview` code paths from `generate-story-video` and `generate-story-video-full`.
- Keep the same edge function names and admin buttons so existing UI wiring works; only the internals change.
- Update `.lovable/plan.md` to reflect the slideshow pivot.

## Technical details

- **Image model:** `google/gemini-3.1-flash-image` via `/v1/images/generations` (Vertex `generateContent` body). Non-streaming, upload PNG to `story-scenes` storage bucket, save public URL. Add a shared "style anchor" prefix to every scene prompt (e.g. "warm watercolor illustration, consistent character design, no text, no captions") so scenes look like one story.
- **Negative constraints in prompt:** no Latin text, no captions, no subtitles, no signs — image must be purely visual.
- **Audio:** reuse `synthesizeLine(dialect, "narrator", arabicText)` from `_shared/listenTts.ts`. Upload MP3 to existing audio bucket, save public URL, capture duration.
- **Storage:** one bucket `story-scenes` (public read) for images; audio goes to the existing narration bucket already used by story generation.
- **DB:** add `scenes_json JSONB` column on `interactive_stories` (or reuse an existing JSONB column if present). Preview writes a 1-element array; full generation writes the full array. `video_preview_url` becomes optional/legacy.
- **Player:** new `src/components/stories/SlideshowPlayer.tsx` used by `StoryPlayer.tsx` and the admin form preview. Uses existing `useAudioPlayer` pattern.
- **Cost note:** ~1 image + ~1 short TTS clip per scene, vs. a Veo generation per story. Order-of-magnitude cheaper and no per-project video quota.

## Out of scope
- No MP4 stitching (unnecessary — slideshow is the delivery format).
- No changes to the story planner's dialect rules, MSA leak checks, or admin approval gating.
