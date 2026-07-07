## Problem

The current `generate-story-video-full` function produces incoherent English-feeling clips because:
1. The scene planner only receives a 3000-char slice of the story and returns 4 disconnected prompts with no shared character/setting anchor, so each Veo clip invents its own look.
2. Prompts don't forbid English text, English speech, or Latin signage — Veo 3.1 defaults to adding English on-screen text and English narration audio.
3. Clips are generated independently with no visual continuity between them.
4. Veo caps a single generation at ~8s, so "one video of the whole story" isn't possible in one call — but we can make N clips read as one continuous film.

## Fix

### 1. Two-pass planning (read the whole script first)

Pass the **entire** Arabic story (plus English translation if present) to Gemini 2.5 Pro in one planning call that returns a single JSON object:

```
{
  "style_anchor": "one paragraph describing lighting, palette, era, location, film grain",
  "characters": [{ "id": "juha", "appearance": "..." }],
  "scenes": [
    { "index": 0, "arabic_beat": "...", "visual_prompt": "...", "duration": 8 },
    ...
  ]
}
```

Rules baked into the planner prompt:
- Scenes must cover the story start-to-end in order, no gaps.
- Every `visual_prompt` MUST prepend the `style_anchor` and any characters that appear, so all clips share look and cast.
- No on-screen text, no subtitles, no signage in Latin script, no English dialogue.
- Setting explicitly named as Gulf/Egyptian/etc. per `story.dialect`.
- 3–6 scenes, chosen by story length, not a hardcoded 4.

### 2. Continuity between clips

For scene `i > 0`, request Veo with `image` seeded from the **last frame of scene i-1** (Veo 3.1 supports reference-image conditioning). Extract the last frame server-side with a tiny ffmpeg-wasm call, or use Veo's `lastFrame` from the previous operation response when available. This makes the sequence feel like one continuous film.

### 3. Silence / Arabic-only audio

In the Veo request, set `generateAudio: false` (Veo 3.1 flag) so clips have no English narration. Story audio already exists separately and can be layered by the player.

### 4. Prompt hardening

Every per-scene prompt appended with a strict negative block:
`Negative: english text, latin letters, subtitles, captions, watermarks, logos, western signage, modern clothing if period story, cartoonish style.`

### 5. UI unchanged

Admin still sees sequential segments; no player changes needed. Optionally add a "Regenerate scene N" button later — out of scope for this pass.

## Files to change

- `supabase/functions/generate-story-video-full/index.ts` — rewrite `planScenes` to return the structured plan above, rewrite `generateClip` to accept `{ prompt, referenceImageBytes?, durationSeconds }` and pass `generateAudio:false`, and add `extractLastFrame(bytes)` using a lightweight approach (call Veo's returned `lastFrame` if present; otherwise fall back to no reference for that scene).
- No DB migration, no frontend change.

## Technical notes

- Model stays `veo-3.1-fast-generate-preview`. Reference-image field on the `instances[]` payload is `image: { bytesBase64Encoded, mimeType }`.
- Planner model: `google/gemini-2.5-pro` via Lovable gateway (higher reasoning than flash, one call per story, cheap enough).
- Keep `MAX_SCENES = 6`, min 3.
- If last-frame extraction fails, degrade gracefully to prompt-only continuity (style_anchor already covers most of it).
