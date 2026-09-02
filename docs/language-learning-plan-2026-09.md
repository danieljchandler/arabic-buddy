# Implementation plan: SRS logging, mode-aware input, speaking loop, perception training, frequency

*September 2026. Companion to `docs/language-learning-research-2026-09.md`,
which verified the research and compared it against the codebase. This plan
turns the ten recommendations there (P0–P10) into phased, codebase-grounded
work, in the same shape as `docs/plateau-plan-2026-09.md`. Every item names the
files it lands in and the drift guards it must clear.*

**Two things this plan does not do.** It does not use the Casablanca corpus
(licence forbids it — research §8), and it does not bump FSRS before review
histories exist (per-user fitting is worth more than the version — research §1).
Both are the counterintuitive calls the research settled; the sequencing below
is built around them.

## Constraints carried over from the research

- **R1 — Log before you optimise.** Per-user FSRS fitting beats two algorithm
  generations. Nothing can be fitted without a review-event log, and the log
  needs months of data before it pays. It ships first, alone, immediately.
- **R2 — Coverage thresholds are mode-dependent.** Reading 98/95, listening 95,
  viewing 95/80. One band pair for every surface is wrong for every surface.
- **R3 — Video is the on-ramp, not the acquisition channel.** Lowest coverage
  requirement of any mode; lowest vocabulary pickup of any mode (7%/5%).
- **R4 — Don't interleave a beginner's first exposures.** Only the negative
  finding is evidenced; keep the change minimal.
- **R5 — Speaking practice lowers anxiety (d = 0.39–0.76); skill gain is
  weak-to-null.** Claim the on-ramp, not the accelerator. Instrument, don't market.
- **R6 — Perception training (HVPT) is the best-evidenced new feature:**
  g = 0.92, durable at 2.3 months. Identification not discrimination; text
  labels not pictures; ~400 minutes then plateau; few talkers for beginners;
  site it early.
- **R7 — Explicit ASR feedback beats indirect (0.86 vs 0.50); segmental beats
  suprasegmental (0.82 vs 0.37); nothing under five weeks (0.07).**
- **R8 — MSA frequency is the wrong ranking, no dialect frequency list exists,
  the AVP is ~1,200 items and not confirmed machine-readable.** Derive frequency
  from our own transcripts; treat the AVP as a validation set.
- **R9 — Retrieval gains are driven by high-frequency words.** Frequency
  ranking and SRS compound; do both.
- **R10 — Errors are only actionable where they are captured.** Open
  conversation is the richest production source and records nothing.

---

## Phase 0 — Four small things, this week

Each is independent, each is cheap, and one of them (0a) is the most important
item in the plan.

### 0a. `review_log` — via trigger, not client writes (P0, R1)

There are **three** places that write a schedule: `useReview.ts`
(`submitRatingToServer`, ~line 429, `word_reviews` update/insert),
`useSetPhrases.ts` (lines 218/236 compute, 286/303 write `user_set_phrases`),
and `Review.tsx:320` (in-session relearn; local requeue only, the DB write still
goes through `useReview`). Client-side logging would have to be threaded through
all of them and would miss any future writer. (One client change is still
needed — see the `rating` row — but it is a single line in the one function
every `word_reviews` writer already goes through.)

**Do it as a Postgres trigger instead.** `AFTER INSERT OR UPDATE ON
word_reviews` and `ON user_set_phrases`, inserting one row per schedule change
into `review_log`:

| column | source |
|---|---|
| `user_id`, `deck` (`word` \| `set_phrase`), `card_id` | the row |
| `direction` | `recognition` unless only `production_*` columns changed |
| `rating` | `word_reviews.last_result` — the column **exists but is never written** (only `exportData.ts` reads it), so `buildReviewUpdate` in `useReview.ts:344` starts setting `last_result: rating`; that one line covers every `word_reviews` writer. `user_set_phrases.last_quality` is already written (`useSetPhrases.ts:214`) and maps to a rating in the trigger |
| `stability_before/after`, `difficulty_before/after` | `OLD`/`NEW` ease_factor + difficulty (production_* when direction is production) |
| `elapsed_days` | `NEW.last_reviewed_at − OLD.last_reviewed_at` |
| `scheduled_days` | `OLD.interval_days` |
| `reviewed_at` | `NEW.last_reviewed_at` |
| `duration_ms` | nullable; not available server-side, reserved for a later client write |

Append-only: owner `SELECT` under RLS, no client `INSERT`/`UPDATE`/`DELETE`
policies at all — the trigger runs as definer. This is strictly more
trustworthy than a client write (nobody can post themselves a history) and
covers every present and future write path for free.

Guards: migration replay on stock Postgres (trigger + function are plain SQL);
regenerate types; `factories/index.ts` gets a `reviewLogId` maker and the
emulator learns the table (it derives schema from the types file, so the
regenerate is what does it). One Vitest in `src/test/` asserting the emulator
persists a row on review. Note `srsStats.ts` should *not* be switched to read
from the log yet — it needs months of history first.

### 0b. Mode-dependent comprehension bands (P5, R2)

`comprehensionBand(coverage)` in `src/lib/comprehension.ts:174-178` takes a
`mode: "reading" | "listening" | "viewing"` argument:

| mode | comfortable | stretch floor |
|---|---|---|
| reading | ≥ 0.98 | ≥ 0.95 |
| listening | ≥ 0.95 | ≥ 0.90 |
| viewing | ≥ 0.95 | ≥ 0.80 |

Below the floor is `"too-hard"` (renamed from `"challenge"`, which read as a
recommendation). Consumers already know their mode: `useComprehensionMap` is
used by `Discover.tsx` (viewing), `ReadingLibrary.tsx` (reading) and
`Listen.tsx` (listening); `ComprehensionBar` takes the band. Pure change plus
`comprehension.test.ts` cases per mode. The `src/lib/**` coverage threshold is
90% lines — the new branches need tests, not just the happy path.

### 0c. A speaking task in the daily queue (P2, R5)

`useTodayQueue.ts` gains a `"speaking"` `TodayTaskId` rotating by calendar
day between `/monologue`, `/set-phrases/practice` (chunk-in-situation via the
chunk coach) and `/pronunciation`, with `estMinutes` ~10 and `done` from
`isTaskCompletedToday("speaking")`. Shadow reps have no standalone route —
they live inside the video player — so they are not in the rotation. The
three target pages call `markTaskCompletedToday("speaking")` on a scored
attempt. It **displaces** rather than stacks, and that needed no code: the
daily goal is a fixed *count* of tasks the learner chooses, so a ninth task
competes for the same slots instead of adding to them (the evidence is for
substitution, R5).

Copy: the task subtitle says nothing about learning faster. Onboarding copy for
anxious learners waits for Phase 6 measurement (R5).

Guards: `TodayTask` reachability is satisfied by the existing routes;
`useTodayQueue.test.ts` covers rotation and completion.

### 0d. Don't interleave new cards for beginners (P5, R4)

`buildReviewOrder` in `reviewOrder.ts:101-124` round-robins new cards into
reviews and interleaves directions within the new set. Add
`OrderOptions.blockNewCards: boolean`; when true, new cards come as one
contiguous block *after* reviews, recognition direction only, no direction
interleaving. Callers set it from `useSRSStats` when the learner's total
completed reviews are under a threshold (start at 200; revisit once 0a has
data). Mature scheduling is untouched — the finding is scoped to first
exposures. `reviewOrder.test.ts` gains the blocked path.

## Phase 1 — Capture errors from open conversation (P3, R10)

`recordLearnerErrorsForRequest` is called from six scoring functions and none of
the three conversation surfaces. The three differ in shape:

- **`conversation-practice`** turned out to have **no client caller** — the
  Conversation Simulator drives `free-chat`, and nothing else references the
  function. It is left untouched rather than given an extraction path nobody
  would exercise; it is a candidate for removal in a later cleanup.
- **`free-chat`** streams via `streamBrain` and never holds the reply, but its
  tutor prompt already makes the model prepend a `[[CORRECTION]]` line when the
  learner's message had a genuine mistake, and the client splits that line out.
  That is the trigger: **only a turn carrying a correction** is posted to the
  new edge function **`extract-learner-errors`**
  (`{dialect, source, userText, assistantText, correction}`), which asks a
  `UTILITY` model to list what the tutor corrected and drops every item it
  does not mark `corrected_by_assistant` (pure core in
  `_shared/learnerErrorExtractionCore.ts`). Bounded cost, and the
  "only what the tutor itself corrected" rule is exact rather than aspirational.
  Service-role write; `recordLearnerErrors` already caps rows per call.
- **Realtime voice** never touches our server — the client gets Whisper
  transcripts of the learner's speech at
  `useOpenAIRealtime.ts` (`input_audio_transcription.completed`). When the
  assistant's next turn finalizes, the pair is posted to
  `extract-learner-errors` with `source: 'voice'` and
  `asrProvider: 'openai-realtime'`. **Gated off by default** behind
  `isVoiceErrorCaptureEnabled()` in `uiPrefs.ts` (localStorage, opt-in):
  dialect ASR runs at 60%+ WER (research §5), so a "voice error" is as likely
  to be the transcriber's as the learner's. The same `corrected_by_assistant`
  filter applies, and the prompt tells the model the transcript's spelling is
  the transcriber's, not the learner's.

Migration: extend the `learner_errors.source` CHECK (last touched in
`20260901040000_chunk_coach_source.sql`) with `conversation` and `voice`, one
migration. `mistakes.ts` `SOURCE_LABEL` gains the two labels. `mistake-drill`
needs no change — it already reads all unresolved rows.

Guards: `extract-learner-errors` named in `_test/` via `loadFunction`;
`enforceDailyCap` on it (it calls a model); `learner_errors` writes stay
service-role.

## Phase 2 — Perception training programme (P8, R6)

The best-evidenced new feature, and the app has every ingredient. Built to the
moderators, which contradict the obvious design at four points.

**2a. Contrast inventory — no external resource needed.** The contrasts that
gate Arabic listening are orthographic: ع/ء, ح/ه, ق/ك, ص/س, ط/ت, ض/د, ذ/ز, ث/س,
غ/خ. Pure module `src/lib/perceptionPairs.ts`: given the dialect's word
inventory (`vocabulary_words.word_arabic` + `set_phrases`), find minimal pairs by
single-letter substitution on a contrast letter after `normalizeArabic`, and
near-pairs (same consonant frame, one contrast position) when true pairs are
scarce. Ranked by whether both members have audio. MADAR's CAPHI transcriptions
are *not* required for this; they become useful later for vowel and gemination
contrasts that orthography hides.

**2b. Item shape — identification with text labels.** Play one word; show two
to four **Arabic-script options** (g = 0.90–1.03 for orthographic labels vs 0.47
for pictures — do not reuse the flashcard-image pipeline). Never "same or
different?" (g = 0.57 vs 0.95). Feedback is immediate and names the contrast
("that was ح, not ه"), which is what the ASR literature also says works (R7).

**2c. Audio sourcing — few voices first.** Shipped on
`vocabulary_words.audio_url`, with the dialect TTS voice as the fallback for a
word that has no recording; `published_clips` (real speech, `start_ms`/
`end_ms`) are a later addition because playing a clip segment means the
YouTube iframe API, which is too heavy for a ten-second identification item.
One voice per word covers beginners. More talkers only helped higher-proficiency learners, so talker
variety is a *later* addition gated on level, not a launch requirement. Munsit
and Azure voices already routed per dialect by `ttsVoiceRoutingCore.ts` give
two or three talkers for free when needed.

**2d. Programme, not drill.** Gains plateau at ~400 minutes total. The surface
is a *completable* course — progress toward 400 minutes per contrast set, with
an end state — not an infinite queue. Per-contrast accuracy in a new
`user_perception_progress` table (owner-read; client-write is acceptable here,
it is self-report of a self-graded item, same trust level as
`user_letter_progress`).

**2e. Siting.** Longer L2 experience predicted smaller gains, so it belongs
where beginners are: a "Sounds" track alongside the Alphabet Journey
(`useAlphabetProgress` and `user_checkpoint_progress` are the pattern), route
`/alphabet/sounds`, surfaced from `AlphabetJourney` and from the `listen`
activity in `surfaces.ts`. Route manifest entry; `e2e/perception.spec.ts` against
the in-memory backend, following `e2e/alphabet.spec.ts`.

**2f. Measure durability ourselves.** Resurface a completed contrast set after
60 days and record first-attempt accuracy — the literature says no decay at 2.3
months; we can check that for Arabic, which nobody has.

## Phase 3 — Frequency-ranked vocabulary (P4, R8, R9)

**3a. Derive it from what we hold.** `caption_lines` already carries
`text_normalized`, `dialect_score` and `msa_score` per line
(`dialectMarkers.ts`, written by `index-channel-captions` and
`mine-clip-candidates`), and reviewed `discover_videos.transcript_lines` are
native-checked. New edge function **`derive-word-frequency`** on the existing
`pg_cron` pattern (`reap-stuck-video-transcriptions` in
`20260831081005_….sql` is the precedent), nightly: tokenise with
`comprehension.ts`'s `tokenizeArabic` + clitic stripping, **filter lines by
`dialect_score` and the video's dialect** (research §5: "dialectal" corpora are
often mostly MSA — filter by measured dialectness, not by label), count token
and document frequency per dialect, and write a `dialect_word_frequency`
table (`dialect`, `token`, `count`, `doc_count`, `zipf`). Reviewed transcript
lines weight higher than raw captions. `scripts/derive-yemeni-artifacts.py`
already does this shape offline for Yemeni and is the reference.

**3b. Join it to the decks.** Nightly, the same job fills a new
`frequency_rank` column on `vocabulary_words` and `set_phrases` by matching
their normalised forms against the table for their dialect.

**3c. Admit new cards by rank.** `buildReviewOrder` sorts the new-card set by
`frequency_rank` (nulls last, due date breaking ties) before applying
`newCardCap`, in both the interleaved and the beginner-blocked shapes. Pure;
tested. This is where R9 compounds: the retrieval-practice gain was driven by
high-frequency words, and this makes those the ones a learner meets first.
Shipped for the curriculum deck (`vocabulary_words`), whose words the app
chooses; the personal deck is the learner's own picks, where a frequency
order would second-guess them. `set_phrases` receive ranks from the same job
but their practice order is not yet driven by it.

**3a, as shipped.** The caption source joins `caption_lines` →
`channel_videos` → `content_channels.dialect`, keeps lines whose own
`dialect_score` clears a threshold (default 0.05, a parameter on the request
so it can be tightened once the table exists to compare against), and adds
published `discover_videos.transcript_lines` at three times the weight. The
job is secret-guarded (`x-frequency-secret`), replaces the dialect's rows
each run, and rewrites only the ranks that changed. A word the corpus never
says gets `NULL`, not a guess.

**3d. Validation set, not source.** Email Soliman & Familiar for the AVP A1–A2
list (human action). When it arrives, a script compares our A1/A2-ranked words
against it and reports overlap — a sanity check on ~1,200 words, not the
ranking itself. Do **not** import Khallaf's list: MSA-only, dialect removed,
unlicensed.

Guards: new edge function in `_test/`; migration replay; types regenerate;
`derive-word-frequency` calls no model, so no cap needed, but it must use the
service role and be reachable only by the scheduler secret.

## Phase 4 — FSRS-6 with per-learner weights (P1, R1)

**Gated on 0a data**, but the code can be built ahead.

**4a. Port `spacedRepetition.ts` to FSRS-6.** 21 weights (adds the learnable
forgetting-curve decay and revises the same-day formula that motivated the
FSRS-5 choice). Keep the post-lapse cap and the in-learning-keeps-state rule —
they are not version-specific. `calculateNextReview` gains `options.weights?:
number[]`, defaulting to stock FSRS-6. Every existing test still passes on
stock weights with intervals within rounding of today's; add tests for the
decay parameter's effect. Update the `CLAUDE.md` note, which currently
explains why v5.

**4b. Fit per learner, on the learner's device.** `fsrs-rs` ships a WASM
build (`fsrs-browser`) with the optimizer; the review log (0a) is
owner-readable, so fitting can run client-side over the learner's own history
with no server compute and no data movement. Trigger it from Settings and
opportunistically after a review session when `review_log` count ≥ 1,000 and
the last fit is > 30 days old. Store in a new `profiles.fsrs_weights jsonb`;
**clamp every weight on read** to the optimizer's own bounds so a hand-edited
row cannot produce a degenerate schedule. `useFsrsCalibration`'s multiplier
stays as the cold-start path — it is what it is good at — and is bypassed
when fitted weights exist.

**4c. Prove it before trusting it.** Before fitted weights schedule anything,
compute log loss of stock-vs-fitted on the learner's held-out most-recent 20%
of `review_log` and only adopt the fit if it wins. This is the benchmark's own
criterion and it is cheap.

Guards: `spacedRepetition.ts` is the most heavily commented file in `src/lib`
for a reason — keep the FSRS-5 rationale in the history and the FSRS-6
rationale in the file. WASM in Vite needs the plugin wiring checked against the
e2e build.

## Phase 5 — Feedback that names the error; video as carrier (P6, P7, R3, R7)

**5a. Pronunciation feedback names the phoneme.** `useAzurePronunciation`
already returns per-phoneme scores (`PhonemeResult`) and
`pronunciationScoringCore.worstPhoneme()` picks the worst — but
`PronunciationPractice.tsx` renders neither. Render the worst phoneme mapped
back to its letter and `sound_hint` from `src/data/arabicAlphabet.ts`, with a
one-line contrast note (which Phase 2 makes actionable: "practise ح vs ه").
Explicit beats indirect nearly two-to-one (R7). Word/sentence modes only —
shadow mode stays on fluency and closeness, as `shadowScoring.ts` argues and
the research confirms.

**5b. Five-week framing in the UI.** Under-five-week programmes measured
g = 0.07. The pronunciation surfaces show a "week N of 5" progress marker
against first use, and the feature's `featureMetrics` events carry it, so
retention past week five becomes a number we watch.

**5c. Transcript-primary playback.** In `DiscoverVideo`, the transcript is
visible by default with the focused line tracked (the `usePageAiContext`
`position` layer already knows it), and the word-focus affordances lead.
`featureMetrics` records transcript-visible time separately from watch time.
Video stays the on-ramp — it has the *lowest* coverage requirement of any mode
(R3) — and the 0b bands express that difference directly. This is design-led
and can trail the rest.

## Phase 6 — Measure proficiency; second dialect signal (P9, P10)

**6a. Recurring placement.** `profiles` already stores
`placement_level_{gulf,egyptian,yemeni}` and `placement_taken_at_*`, but
overwrites them. New `placement_results` table (append-only, owner-read,
written where `PlacementQuiz.tsx:272` writes today) and a `TodayTask`
"re-check your level" when the last placement is > 90 days old *and* ≥ 300
reviews have happened since. `LearningAnalytics` gets a level-over-time line —
the first proficiency measure the page will have shown.

**6b. Two instruments from the Duolingo battery.** A dialect **C-test**
generator (`askBrain`, `CONTENT`, cloze over a passage at the learner's level)
and **productive vocabulary** from monologue transcripts (types and tokens —
`fluencyMetricsCore` already tokenises them). Both are stored against
`placement_results` so level and productive-vocabulary trends can be read
together. This is what turns "is it working?" from unanswerable to a chart, and
it is the precondition for any efficacy or anxiety claim in copy (R5).

**6c. ADI2 as a second dialect signal — a spike.** ALDi is a hosted model, not
a provider API; the app already has an HF integration (`src/lib/huggingface.ts`,
`hf-chat`). Spike: call Sentence-ALDi through it inside `msaViolationLogger`,
**log only** alongside the existing detector's verdict for a month, then
compare against native-review outcomes from the flywheel. Check the model
licence first. Adopt as a gate only if it beats the word lists on that data.
Also: note in `docs/testing.md` that Yemeni is absent from AL-QASIDA and our
golden set is the only Yemeni instrument.

**6d. Audit MSA-sourced elicitation.** `convert-to-fusha`,
`translate-story-dialect` and `fushaBridge`: confirm which direction each
elicits in. Where dialect is generated *from* MSA input, add the MSA-priming
caution to the prompt and measure the leak rate before and after with
`scripts/eval-dialect-live.ts --compare`.

---

## Human actions (not code)

1. **Email Soliman & Familiar** for the AVP A1–A2 list (Phase 3d).
2. **Write to UBC-NLP** if Casablanca data is wanted for anything, including
   internal evaluation — and ask counsel whether evaluation-only use is inside
   CC-BY-NC-ND before touching it.
3. **Check licences** of any Arab Voices dataset before use; they vary.
4. **Check the ALDi model licence** before the Phase 6c spike.

## Sequencing

```
Phase 0 (this week, four independent items)
   0a review_log trigger ─────────────────────────► Phase 4 (fit, gated on data)
   0b mode bands ──► 5c transcript-primary
   0c speaking task ──► Phase 1 error capture ──► mistake-drill grows
   0d beginner blocking
Phase 2 perception programme — independent, start any time
Phase 3 frequency ──► 3c ranked admission ──► (future) chunk mining
Phase 5a/5b pronunciation — independent
Phase 6 measurement — 6a/6b gate any efficacy copy; 6c/6d independent
```

Suggested PR order: **0a → 0b+0d → 0c → 1 → 2 → 3 → 5a → 4 → 6**, with 5c and
6c/6d free to land whenever. Each phase is shippable alone.

**If only one PR ships: 0a.** It is a trigger and a table, it makes every
later SRS decision measurable, and it needs months of data before Phase 4 can
run — every week it waits is a week added to when fitting becomes possible.

## Explicitly out of scope

- **Casablanca or any NC-licensed corpus** in training or products (research §8).
- **Bumping FSRS on stock weights as a standalone change** — do it with 4b.
- **Corpus scraping / chunk mining** — still deferred (plateau plan); Phase 3's
  frequency table is the foundation it will use.
- **Talker-variety expansion for beginners** in Phase 2 — the evidence says it
  doesn't help them.
- **Anxiety-benefit copy in onboarding or marketing** until 6a/6b can measure it.
- **L1 baseline recordings, composite fluency bands** — unchanged from the
  plateau plan.

## Per-phase drift-guard checklist

| Change | Required companion |
|---|---|
| New edge function (`extract-learner-errors`, `derive-word-frequency`) | `_test/` test via `loadFunction`; `enforceDailyCap` if it calls a model |
| New `_shared/` module | named by a Vitest in `src/test/` |
| New `src/lib` / `src/hooks` module (`perceptionPairs`, `usePerceptionProgress`) | co-located `*.test.ts`; `src/lib/**` is at a 90%-lines ratchet |
| New route (`/alphabet/sounds`) | `routes/manifest.ts` entry + in-app link (surfaces / AlphabetJourney) |
| New table / column / trigger (`review_log`, `dialect_word_frequency`, `placement_results`, `frequency_rank`, `fsrs_weights`, `last_result` on `user_set_phrases`) | migration replays on stock Postgres; regenerate types (or `typesDrift` entry); emulator + factory support |
| New `learner_errors.source` values (`conversation`, `voice`) | CHECK-constraint migration; `mistakes.ts` labels |
| New `TodayTaskId` (`speaking`, re-placement) | `useTodayQueue.test.ts`; pages call `markTaskCompletedToday` |
| Model-calling path | `modelRegistry` lineups only; `enforceDailyCap` |
| Score- or history-writing path | service-role or trigger writes; owner-read RLS; never client-writable history |
| Every new surface | `featureMetrics` events — our own data is the only Arabic calibration source there is |
