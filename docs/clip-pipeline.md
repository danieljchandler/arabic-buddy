# Clip pipeline — mining beginner clips from the dialect channel corpus

The lower-level (A1) curriculum is built from 5–10 second authentic clips
mined out of curated YouTube channels, instead of flashcards. This doc is the
runbook for the pipeline that finds those clips. The full design (research,
costs, integration map) lives in the planning artifact from 2026-08-22; this
file is what you need to *operate* it.

## The shape

```
content_channels ──> channel_videos ──> caption_lines ──> clip_candidates ──> published_clips ──> /clips
   registry            enumeration        the index          verification        publication       player
   (admin UI)        (harvest script)  (captions script)   (edge functions)    (edge function)   (learner)
```

- **Concept-keyed vocabulary**: `vocab_concepts` (100 A1 concepts seeded,
  key = snake_case English) with per-dialect surface forms in
  `concept_realizations` (status `draft` → `approved`, native-review gated).
  Lessons and clips reference the concept key, never an Arabic string, so one
  syllabus drives three dialect tracks.
- **Dialect scoring** is `_shared/dialectMarkers.ts` everywhere — the inverse
  of the MSA-leak detector, sharing its `normalizeArabic`. Line-level scores
  live on `caption_lines`; channel-level rollups on `content_channels`.

## Stage 1 — vet channels (`/admin/channels`)

~48 research candidates are seeded (2026-08 research pass; open questions in
each row's notes). Approving a channel puts it in the harvesting and mining
pool; nothing is mined from candidates or rejected channels.

## Stages 2–3 without a terminal (recommended)

Both harvesting and caption indexing also run as edge functions behind
buttons on `/admin/channels`, so no local tooling is needed:

- **Harvest videos** → `harvest-channel-videos` (reuses the existing
  `YOUTUBE_API_KEY` secret). A couple of channels per click, oldest first;
  the toast says how many remain — click until zero.
- **Index captions** → `index-channel-captions`, which fetches Arabic
  caption tracks through the Supadata transcript API instead of local
  yt-dlp. One-time setup: create a free key at supadata.ai (free tier ≈ 100
  videos/month; a few dollars per thousand after) and add it as the
  `SUPADATA_API_KEY` edge-function secret in Supabase. ~8 videos per click;
  the toast reports indexed / no-captions / remaining.

Both fill the same index with the same normalization and scoring as the
local scripts below, which remain the bulk/power path.

## Stage 2 — harvest (`scripts/harvest-channels.ts`)

```sh
YOUTUBE_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-env --allow-net scripts/harvest-channels.ts \
  [--dialect Gulf] [--channel moshaya] [--include-candidates] [--dry-run]
```

Enumerates each channel's uploads playlist (1 quota unit per 50 videos) into
`channel_videos` with duration, embeddability and a caption hint. It never
calls `search.list` unless you pass `--resolve-names` — since mid-2026 that
endpoint is capped ~100 calls/day in its own bucket. Channels seeded with
neither an id nor a handle either get `--resolve-names` spent on them or a
hand-filled `yt_channel_id`.

## Stage 3 — index captions (`scripts/fetch-captions.ts`)

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-env --allow-net --allow-run --allow-read --allow-write \
  scripts/fetch-captions.ts [--dialect Gulf] [--limit 50] [--sleep 2]
```

Runs `yt-dlp` (must be on PATH) per video — manual Arabic track preferred,
auto-generated as fallback — normalizes and dialect-scores every line into
`caption_lines`, and rolls channel scores up. Run it **from a residential
connection, not cloud egress** (YouTube blocks datacenter IPs), keep `--sleep`
≥ 2, and know the posture: bulk caption download sits outside YouTube ToS.
The alternative that shifts that risk is a commercial transcript API
(~$5/1k transcripts) — swap the `fetchTrack` implementation if volume grows.
If subtitle requests come back empty, YouTube wants a PO token — install the
`bgutil-ytdlp-pot-provider` plugin. Videos with no Arabic captions are marked
`caption_status = 'none'`; those are the ASR-fallback pool (Yemeni will be
mostly this).

## Stage 4 — mine and verify (`/admin/clips` or headless)

- `mine-clip-candidates` (edge function): expands a concept's **approved**
  realizations (surface + spelling variants — الكلب must be listed as a
  variant of كلب or definite occurrences are invisible) into caption-index
  searches, ranks by dialect-minus-MSA score, and writes `pending`
  candidates. The admin UI can also mine ad-hoc Arabic terms before
  realizations exist. Sweep mode (no conceptKey) targets concepts that still
  lack clips in a dialect.
- `verify-clip-candidate` (edge function): the verification stack — term
  containment (hard fail), dialect markers over the line ±20s of context,
  playability (embeddable/available/1.2–10s), and one short `askBrain` judge
  call (UTILITY lineup) for dialect/target/safety/beginner-fit. Tiers:
  hard fail → `rejected`; all green → `verified`; anything else — including
  a judge outage — → `needs_review`. Evidence lands in
  `clip_candidates.verification` and renders as chips in `/admin/clips`.

Headless automation calls both with the service-role key as the bearer token
plus an `x-pipeline-secret` header matching the `CLIP_PIPELINE_SECRET`
function secret. Nothing auto-publishes unjudged; the `needs_review` queue is
the only place a human is meant to work routinely.

## Stage 5 — publish (`publish-verified-clips`) and the learner player (`/clips`)

`publish-verified-clips` (edge function) moves `verified` candidates onto
`published_clips`, the learner-facing table: one row per clip with the
YouTube id + window, the target term and gloss, the caption line, and a
translation + transliteration generated at publish time (one
TRANSLATION-lineup call per clip; a clip whose translation fails stays
`verified` and is retried, never shipped untranslated). Same gating as the
other functions. The ingested source video deliberately stays out of the
Discover feed — 4 good seconds do not vouch for the other 10 minutes.

Learners get `/clips` (Word Clips, linked from the Skills chooser): themes in
syllabus order, only concepts that have clips, played through the official
YouTube iframe at the clip's window — watch → replay → reveal English → save
the word into the SRS (`user_vocabulary`, `source: 'clip'`). Grouping logic
is pure and tested in `src/lib/clipLessons.ts`.

`lesson_clips` (lesson ↔ clip join) exists in the schema for authored-lesson
integration but nothing writes it yet — the concept-keyed player above is the
pilot surface.

## What is deliberately not built yet

1. **Lesson integration** — attaching published clips to authored lessons via
   `lesson_clips` (a "Clips" sheet in the lesson xlsx and/or CurriculumBuilder
   suggestions), and shadowing/pronunciation scoring inside the clip player.
2. **Scheduled loop** — a cron/Routine chaining draft-realizations →
   sweep-mine → verify → publish → digest. The secret-header path exists for
   exactly this; each stage is bounded per call, so the loop is four invokes.
3. **Link-rot sweep** — `videos.list` in 50-id batches (1 unit/call) +
   oEmbed HEADs, refreshing `channel_videos.availability`/`embeddable` and
   retiring published clips whose video died.

## Open decisions (need a human call)

- **Embed-paywall clause**: YouTube's Required Minimum Functionality rules
  prohibit charging users to watch embedded content. Decide how clip lessons
  sit relative to the subscription gate before learners see them.
- **Caption acquisition route**: local yt-dlp (ToS-gray, free) vs commercial
  transcript API (vendor carries the risk, ~$5/1k).
- **AVP licensing**: the seeded concept list is original; if the Arabic
  Vocabulary Profile A1 list should drive the full syllabus, email its
  authors first (no license is published).

## Costs at a glance

Enumeration is effectively free; captions are free (yt-dlp) or ~$5/1k
(API); ASR for caption-less videos ≈ $0.10–0.26/audio-hour (Soniox/Deepgram)
or ~$1–3 (Munsit, dialect specialist); the judge call is one UTILITY-lineup
completion per candidate.
