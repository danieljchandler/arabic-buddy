# Admin Memes Section — Plan

Memes don't fit the normal video pipeline (often no speech, heavy on-screen text, music tracks tricking ASR into hallucinating). Instead of bolting toggles onto the video flow, give memes their own first-class admin module that mirrors the user-facing Meme Analyzer but is tuned for curation, persistence, and learner publishing.

## 1. New admin route: `/admin/memes`

- `AdminMemes` (list) — table of saved memes with thumbnail, dialect, status (draft/published), date, "Has speech" badge, vocab count.
- `AdminMemeForm` (`/admin/memes/new` and `/admin/memes/:id`) — single-screen workflow: upload → analyze → review/edit → publish.
- Add a tile on the Admin Dashboard ("Memes") and link from the existing Videos page ("Looking for memes? Use the Memes section →").

## 2. New table: `meme_posts`

Columns:
- `id`, `created_by`, `created_at`, `updated_at`
- `dialect` (Gulf/Egyptian/Yemeni)
- `media_url`, `media_type` (image|video), `thumbnail_url`
- `title`, `title_arabic` (auto-generated, editable)
- `on_screen_text` jsonb — array of `{ arabic, translation, frameTimestamp, bbox? }`
- `audio_lines` jsonb — array of `{ arabic, translation, startMs, endMs }` (empty when no speech)
- `vocabulary` jsonb, `grammar_points` jsonb
- `meme_explanation` jsonb `{ casual, cultural }`
- `has_speech` boolean, `has_music` boolean, `audio_skipped_reason` text
- `status` text (draft/published), `published_at`
- `source_url` text (optional original link)

RLS: admins manage; anyone can read where `status='published'`. Storage uses existing `meme-uploads` bucket.

## 3. Meme-specialized pipeline (new edge function `analyze-meme-admin`)

Built on top of existing `analyze-meme` and `extract-visual-context`, but with stricter, meme-aware rules:

### a. Visual harvest (always)
- Image: single OCR + scene description pass.
- Video: extract 6–10 frames using `extractFramesWithTimestamps`, deduplicate near-identical frames (perceptual hash on downsized canvas), then OCR each frame with timestamps.
- Use Gemini 2.5 Flash for OCR + dialect-aware translation. Output is the canonical `on_screen_text` array — preserved verbatim, no AI rewriting.

### b. Audio detection gate (new)
Before transcribing, classify the audio track:
1. Decode audio with Web Audio API client-side.
2. Compute simple features: average RMS, voiced-frame ratio (silence detection), spectral flatness (music tends high, speech low).
3. Send a 5-second representative clip + features to Gemini Flash with prompt: "Does this clip contain spoken Arabic? Reply JSON `{speech: bool, music: bool, confidence}`."
4. If `speech=false` → skip ASR entirely, set `audio_skipped_reason = 'no_speech'` or `'music_only'`. **AI is forbidden from inventing audio lines.**
5. If `speech=true` → run Munsit/Soniox transcription as today. If music is also detected, prepend a system instruction telling ASR + post-processor to ignore lyrics/instrumental.

### c. Anti-hallucination contract
The analysis prompt is rewritten with hard rules:
- "On-screen text MUST come only from the OCR frames I provide. Do not invent words."
- "Audio lines MUST come only from the ASR transcript I provide. If absent, return `audio_lines: []`."
- "Vocabulary entries must reference a word that appears in either OCR or ASR output."
- Server-side validation: drop any `arabic` string that doesn't substring-match the union of OCR + ASR text. Log dropped items for debugging.

### d. Title + thumbnail
- Auto-title from first OCR line or meme explanation (existing helper).
- Thumbnail: pick the frame with the highest OCR character count (memes' "money frame"), fallback to 25% timestamp.

## 4. Admin UI flow (`AdminMemeForm`)

1. **Upload** — drag/drop image or video into existing `meme-uploads` bucket.
2. **Analyze** button → calls `analyze-meme-admin`. Live progress: Frames → OCR → Audio gate → Transcribe → Synthesize.
3. **Review screen** (single page, collapsible cards):
   - Frame strip with OCR overlay; click a frame to edit its extracted Arabic + translation.
   - "Audio status" card: shows `has_speech`, `has_music`, skipped reason. Manual override: "Force transcribe anyway".
   - Audio transcript editor (reuses `AdminTranscriptEditor`) — only shown when speech detected.
   - Vocabulary chips (add/remove/edit).
   - Meme explanation (casual + cultural) — editable textareas.
   - Title / Arabic title / Dialect / Thumbnail picker.
4. **Save Draft** / **Publish** buttons. Publishing exposes the meme to learners.

## 5. Learner-facing surface (small additions, optional but recommended)

- Add a "Memes" filter chip on `Discover` (or a new `/memes` page) that lists `meme_posts` where `status='published'`.
- Reuse `LineByLineTranscript` to display OCR + audio lines, identical to the public Meme Analyzer.
- Tapping a word → save to My Words (already wired through `useAddUserVocabulary`).

## 6. Suggested extras worth adding

- **Bulk import**: paste a list of TikTok/X meme URLs; backend downloads + queues each. Reuses `download-media` function.
- **"Why it's funny" multi-tier**: beginner / intermediate / native explanations toggleable in admin; learners pick based on level.
- **Cultural tags**: free-text tags ("ramadan", "football", "khaleeji-tv") for filtering and recommendations.
- **Difficulty auto-rating**: A1–C1 estimated from vocab CEFR distribution (Curriculum Brain already does this for lessons — reuse).
- **Reaction set**: 4–5 emoji reactions stored on the meme so learners signal "got it / didn't get it" — useful curation signal.
- **"Quote it"**: one-tap copy of the on-screen Arabic line for learners to paste in chats.
- **Audit log**: record every regenerate/edit so we can compare AI output vs. admin-curated final.

## Technical summary (for engineers)

| Area | Change |
|---|---|
| DB | New table `meme_posts` + RLS; migration only, no edits to `discover_videos`. |
| Edge | New function `analyze-meme-admin` (orchestrator). Reuses `extract-visual-context`, `munsit-transcribe`/`soniox` for ASR, Gemini Flash for OCR + speech-vs-music gate. `verify_jwt = false` (admin auth enforced in code via service role check). |
| Frontend | New pages: `src/pages/admin/AdminMemes.tsx`, `src/pages/admin/AdminMemeForm.tsx`. Routes added to `src/App.tsx`. Dashboard tile in `src/pages/admin/Dashboard.tsx`. |
| Shared | Extract a small `src/lib/audioSpeechDetector.ts` (RMS + flatness) used by both the admin form and a future public version. |
| Storage | Use existing public `meme-uploads` bucket. |
| Decoupling | Memes are no longer routed through `process-approved-video` or `discover_videos`. The `is_meme` toggle on the video form can be removed in a follow-up cleanup. |

## What this fixes vs. today

- No more silent memes producing fake transcripts (audio gate + validation).
- OCR text is preserved verbatim, never paraphrased into the audio transcript.
- Admins get a meme-shaped UI (frame strip, audio status, money-frame thumbnail) instead of a video editor that doesn't fit.
- Music-only memes are explicitly handled and labeled.
