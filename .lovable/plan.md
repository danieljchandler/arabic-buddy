## Can this actually be done?

Yes, but with an important limitation: Veo-style video generation is not reliable enough to guarantee exact Arabic speech inside the generated clip. Even with strong prompts and negative prompts, it can still produce English, omit speech, or improvise.

The reliable architecture is to stop asking the video model to create spoken dialogue, and instead generate:

1. A script-accurate silent visual clip from the full Arabic story plan
2. A separate Arabic narration/audio track from the exact approved Arabic script lines
3. A final composed video where the Arabic audio is overlaid onto the visual clip

That makes the preview and full video useful for learning because the speech is controlled by our backend, not guessed by the video model.

## Proposed fix

1. **Preview generation**
   - Keep preview as an admin-reviewable short video.
   - Generate visuals only: no speech, no subtitles, no text.
   - Use a prompt based on the full Arabic story, not just the English summary.
   - Add strict negative prompt forbidding English, Latin letters, captions, signs, subtitles, and generated speech.

2. **Arabic narration track**
   - Generate Arabic audio separately from exact `body_fusha` / approved Arabic script excerpts.
   - Prefer the project’s existing Arabic TTS stack and dialect-aware voice selection.
   - The preview will have Arabic narration/audio over the generated visuals.

3. **Full story video**
   - Have the planner read the whole Arabic script once.
   - Split the story into ordered beats that quote exact Arabic text.
   - Generate visuals per beat, with no model-generated speech.
   - Generate one Arabic narration/audio track from those exact beat lines.
   - Compose the clips/audio into a single final video if the runtime path supports it; otherwise store ordered segments plus exact audio and present them continuously in the player.

4. **Admin approval flow**
   - Admin creates preview.
   - Admin reviews the preview with Arabic narration.
   - Only after approval does the app generate the full story video.

5. **Validation and failure handling**
   - Reject planner output if any planned narration contains Latin/English characters.
   - Store the exact Arabic lines used for narration alongside the video metadata.
   - Surface generation errors clearly in the admin UI instead of silently producing incoherent output.

## Technical details

- Update `generate-story-video` so the preview uses Arabic script content and includes `negativePrompt`.
- Update `generate-story-video-full` so Veo prompts are visual-only and never request spoken lines from Veo.
- Add a deterministic Arabic audio generation step using the existing backend TTS services.
- If final MP4 composition is feasible inside the current edge/runtime limits, compose video + audio into one stored MP4; if not, use the existing player to play ordered visual segments with the exact narration audio track.
- Keep all backend secrets server-side and reuse existing storage buckets.

## Expected result

The video model will no longer be responsible for speaking Arabic. It will only create visuals, while the Arabic narration comes from exact script text. This is the practical way to get a precise, Arabic-only learning video.