## Listen — AI-generated dialect audio content

A new dedicated page (`/listen`) where users generate rich, varied audio-style content in their chosen dialect — podcasts, TED talks, interviews, narrative stories — on any topic. Episodes are saved to a shared library so everyone benefits, with full immersion learning tools wrapped around playback.

### User flow

1. User opens **Listen** from the home/Today screen.
2. Tabs at top: **Library** (shared, growing list of saved episodes) and **Create**.
3. In **Create**:
   - Pick a **format**: Podcast (2 hosts) · TED talk (solo) · Interview · Story.
   - Pick a **topic**: browse curated topic chips (Tech, Culture, History, Science, Sports, Food, Travel, Psychology, Business, Current Ideas, …) or type a custom topic.
   - Pick a **length**: Short (1–2 min) · Medium (3–5 min) · Long (6–10 min).
   - Pick an **audio mode**: Full TTS (auto-narrated end-to-end with distinct voices per speaker) · Tap-to-hear (no upfront audio; tap any line to play it on demand — cheaper, faster).
   - Dialect inherits from global Dialect context (Gulf / Egyptian / Yemeni).
4. Generate. A loading state shows ("Writing your episode…" → "Recording voices…" when TTS).
5. Player screen:
   - Header: title, format icon, dialect badge, length, host names.
   - Synced transcript: every line is a `TappableArabicText` row with optional speaker label, audio button per line, and global play/pause for full TTS episodes.
   - Display follows global prefs (hide English by default, Tashkil toggle, etc.).
   - **Key vocabulary** panel below: 8–15 auto-extracted words/phrases at the user's CEFR level with one-tap "Add all to My Words".
   - Save / share buttons; episode is automatically added to the public library on first generation.

### Library

- Newest first, filterable by dialect + format + topic.
- Card shows title, one-line teaser, format, length, dialect, play count, who created it.
- Tap → same player view. Anyone can replay; only the creator (or admin) can delete.

### Backend

New tables (in one migration, with grants + RLS):

- `listen_episodes` — `id`, `creator_id`, `dialect`, `format` (podcast|ted|interview|story), `topic`, `topic_category`, `length_bucket`, `title`, `summary`, `script` (jsonb: array of `{speaker, speaker_role, arabic, english, transliteration}` lines), `key_vocabulary` (jsonb: array of `{arabic, english, root?}`), `audio_mode` (full|on_demand), `full_audio_url` (nullable), `duration_seconds` (nullable), `play_count`, `created_at`.
- `listen_line_audio` — `id`, `episode_id`, `line_index`, `speaker`, `audio_url`. Cached per-line TTS for tap-to-hear; reused across users.
- `listen_episode_plays` — lightweight per-user play log for "Continue listening" + play_count increment.

RLS: episodes readable by all authenticated users (shared library); insert by authenticated; delete by creator or admin. Line audio readable by all authenticated; writable by service role only.

New storage bucket `listen-audio` (public read) for full-episode MP3s and per-line clips.

Edge functions:

- `generate-listen-script` — Takes `{format, topic, length, dialect}`. Calls Curriculum Brain / aiBrain with a format-specific prompt that enforces dialect rules (no MSA leakage), produces a structured JSON script aligned to user CEFR, plus title/summary/key_vocabulary. Inserts the episode row and returns it. ~30–60s.
- `generate-listen-audio` — Background function called immediately after script creation when `audio_mode = full`. For each line, picks a voice from the dialect→voice map (re-use Live Voice / Conversation Simulator mapping; distinct voices per speaker role), generates TTS via Munsit (Gulf) or Azure (Egyptian/Yemeni) following the existing ASR/TTS engine priority, stitches per-line clips, uploads full MP3 to storage, updates `full_audio_url` + `duration_seconds`. Per-line clips also saved to `listen_line_audio` so tap-to-hear stays cheap on replays.
- `generate-listen-line-audio` — On-demand single-line TTS for tap-to-hear mode; cache-first via `listen_line_audio`.

All three follow existing patterns: `verify_jwt = false` where invoked by service flows, `SUPABASE_SERVICE_ROLE_KEY` for inserts, daily usage cap via `enforceDailyCap` on `generate-listen-script` (e.g. 3/day free).

### Frontend

- `src/pages/Listen.tsx` — Library + Create tabs.
- `src/pages/ListenEpisode.tsx` — Player view at `/listen/:id`.
- `src/components/listen/CreateEpisodeForm.tsx` — Format/topic/length/audio-mode picker with curated topic chips.
- `src/components/listen/EpisodeCard.tsx` — Library card.
- `src/components/listen/ScriptLine.tsx` — Speaker label + `TappableArabicText` + line play button.
- `src/components/listen/EpisodePlayer.tsx` — Sticky bottom player for full-TTS episodes with line-highlight sync (use a simple per-line duration map persisted in the episode row).
- `src/components/listen/KeyVocabularyPanel.tsx` — Vocab list + bulk add to My Words (reuse existing user_vocabulary hook).
- `src/hooks/useListenEpisodes.ts` and `useListenEpisode.ts`.
- Route added in `App.tsx`. Card added to `Today.tsx` / home shortcuts.

### Prompt approach (per format)

Shared rules: target user's CEFR, dialect-only (uses `_shared/dialectHelpers.ts` + dialect rulebook), output strict JSON schema. Format-specific framing:

- Podcast: warm two-host banter, intro/segment/outro beats.
- TED talk: single speaker, hook → personal story → core insight → call to action.
- Interview: host asks 4–6 sharp questions; guest answers with concrete examples.
- Story: third-person narrative with dialogue, vivid sensory detail, twist or moral.

Topic library is hard-coded in TS (categories with ~10 prompts each, e.g. "Why we procrastinate", "The dying art of pearl diving", "How TikTok changed Khaleeji music", …) but custom input is always allowed.

### Out of scope (for now)

- Comments/likes on episodes.
- Background music beds.
- Multi-language transcripts beyond the existing English/transliteration toggles.
- Admin pre-approval queue (anyone can publish; admins can delete).
