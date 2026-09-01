# Implementation plan: plateau features (chunks, pushed output, monologues, shadowing)

*September 2026. Companion to `docs/plateau-research-2026-09.md`, which verified
the research these features rest on. This plan turns the verified findings into
phased, codebase-grounded work. **Corpus scraping / automated chunk mining is
explicitly out of scope** — we don't have a solid enough foundation for it yet;
everything below builds only on content and infrastructure the app already has.*

## Design constraints carried over from the research review

These are the load-bearing conclusions; each phase cites the ones it implements.

- **R1 — Chunks:** repeated exposure + deliberate attention to specific
  sequences is the evidenced lever, not awareness-raising. Chunk counts
  correlate with rated fluency; SRS-style drilling fits the evidence better
  than "notice the chunks" lessons. Arabic dialect chunk inventories don't
  exist — ours must come from our own curated content.
- **R2 — Output:** engineered output tasks are justified (they fix Krashen's
  scarcity objection), but the one Arabic study (Nassif 2019) says production
  alone doesn't cause noticing — **salience and feedback must be built into
  every output task**, not assumed.
- **R3 — Fossilization:** errors persist because they never impede
  communication enough to get corrected. Targeting known, unresolved errors
  explicitly is the design response.
- **R4 — Monologues:** speed measures + pause *location* carry the signal;
  pause *duration* is personal style; repairs are non-linear — report, don't
  score. ~60s already carries most of the signal; several short prompts beat
  one long one; beginners can't fill 45–120s. **Scale length with level.**
  No published Arabic norms exist — **calibrate thresholds from our own data.**
- **R5 — Shadowing:** score on fluency/prosody/comprehensibility, never
  per-phoneme claims. ~5 reps per passage before plateau; 10–15 min sessions;
  learner-chosen material fights boredom. Durability unverified — measure it
  ourselves.
- **R6 — Framing:** no "research shows" overclaims in copy; don't port English
  vocab-size thresholds; a spoken-dialect goal is a smaller, unmeasured target
  than FSI's 2,200 hours.

---

## Phase 1 — Fluency measurement foundation

*The keystone: both the monologue feature (Phase 2) and shadowing refinements
(Phase 4) consume it. Nothing in the app computes a fluency metric today, but
the ingredients exist: Soniox/Deepgram return word-level timestamps
(`AsrWord` in `_shared/asrConfig.ts`), and `transcriptTimingAlign.ts` /
`LineWordTiming` already model word timings.*

**1a. `_shared/fluencyMetricsCore.ts` (pure, unit-tested).** Input: an array
of `{word, startMs, endMs}` plus total recording duration. Output:

- speech rate (syllables/sec over total time) and articulation rate
  (syllables/sec excluding pauses) — the level-discriminating workhorses (R4).
  Arabic syllable counting from vowelled/unvowelled text needs its own
  heuristic; start with a consonant-cluster approximation over the ASR
  surface forms and refine against transcript data.
- mean length of run (words between silent pauses ≥ 250ms — the standard cut).
- pause inventory: count, total time, and **position** — pause-final vs
  pause-internal relative to runs. True clause-boundary coding (AS-units) is
  English-centric and unsolved for Arabic (research §5), so ship a proxy
  (run-boundary vs mid-run) and store enough raw data to re-derive better
  measures later.
- raw repair/restart counts (repeated tokens, abandoned fragments) — stored
  and shown descriptively, **never scored** (R4).

Everything returns raw numbers; no bands or thresholds in core. Satisfies
`sharedModuleCoverage` via a Vitest test in `src/test/`.

**1b. `useMonologueRecorder` hook.** `useShadowRecorder` auto-stops on 600ms
of silence and caps by clip length — unusable for 1–3 minute speech. New hook
(same MediaRecorder/AnalyserNode approach, reusing its level metering):
manual stop, pause-tolerant, hard cap by task spec, elapsed-time exposure.
Borrow the pause/resume/duration UX from `src/components/admin/AudioRecorder.tsx`.
Co-located test for `hookCoverage`.

**1c. `score-monologue` edge function.** Follows the repo's asymmetric-write
pattern (client reads own rows; service role writes — same as
`learner_errors`): accepts audio, runs ASR with word timestamps
(Soniox first: `stt-async-v5` returns timings; Munsit fallback without
timings degrades to transcript-only metrics), calls `fluencyMetricsCore`,
persists, returns metrics + transcript. `enforceDailyCap` with tier limits;
optional `contributeLearnerAudio` on the existing opt-in lane. Registered in
`_test/` via `loadFunction("score-monologue")` for `edgeFunctionCoverage`.

**1d. `monologue_attempts` table (migration).** `user_id`, `dialect`,
`prompt_id`/`prompt_text`, `duration_ms`, `speaking_time_ms`, `transcript`,
`metrics jsonb` (the full core output, so measures can be re-derived),
`asr_provider`, `created_at`. RLS: owner SELECT only; writes service-role.
Requires: migration replay green, generated types regenerated (or a justified
`typesDrift` entry), factory + emulator support in `src/test/support/`.

**Deliberately deferred within this phase:** any pass/fail scoring. For the
first release we store and *display trends* only (R4: no Arabic norms exist —
the first months of real attempts are the calibration corpus). Add banding
later from our own percentiles.

## Phase 2 — Self-recorded monologue feature

**2a. Level-scaled prompt policy (R4), pure module `src/lib/monologueTasks.ts`:**
A-level ≈ 60s target across 2 short prompts; B-level ≈ 2–3 min across 2–3
prompts on different topics; C/free-form up to 3–5 min single prompt.
Multiple short prompts are preferred wherever a composite is wanted —
task variance beats duration. Targets are *targets*, not gates: stopping
early is allowed and recorded (the Aptis A2 abandonment finding).

**2b. Prompt generation.** New edge function `monologue-prompts` (or an
action on `score-monologue`) via `askBrain()` (`CONTENT` lineup,
`targetRegister: 'dialect'`), conditioned on `learnerPromptBlock()` so
prompts sit inside the learner's known vocabulary with a stretch margin, and
on interests from `profiles`. Prompts should invite (not require) due
production-direction vocab and due chunks (Phase 3) — pushed output with a
safety net.

**2c. Route + page `/speak` (working name).** Record → transcript with
playback → metrics panel (speech rate, articulation rate, MLR, pauses; a
"disfluencies" section listing repairs descriptively) → trend charts over
attempts (per-metric sparklines; no composite score yet). Route manifest
entry, reachability via an `Activity` in `src/lib/surfaces.ts` and a
`TodayTask` in `useTodayQueue`. Page is Playwright-covered
(`e2e/monologue.spec.ts` against the in-memory backend).

**2d. Optional AI content feedback.** After metrics, one `askBrain` pass
returns 2–3 salience-focused notes (R2): what was communicated well, one
reformulation of the learner's own sentence into natural dialect (the
`natural_rewrite` pattern from `practice-sentence-coach`), and one
fossilization callout if the transcript matches an unresolved
`learner_errors` row (R3). Requires a `monologue` value in the
`learner_errors.source` CHECK constraint (migration) and
`recordLearnerErrorsForRequest` wiring.

## Phase 3 — Chunk deck (formulaic sequences, no scraping)

*Principle: promote the chunk entity the app already has rather than invent a
new one. `set_phrases` already models formulaic language richly (variants,
paired replies, formality, scenario, audio, distractors) and has a working
practice surface, quiz generator, and voice scoring.*

**3a. Production-direction schedule for chunks (R1).** Add the seven
`production_*` FSRS columns (mirroring `word_reviews`) to `user_set_phrases`
via migration, and extend `useSetPhrases` + review flow with the
recognition→production unlock rule from `buildReviewUpdate` (recognition
good/easy opens production). Production reviews are *spoken*: reuse
`score-set-phrase-voice` (ASR vs `accepted_variants`) as the grading input,
mapping its accept/quality output onto FSRS ratings. This turns set phrases
from a recognition deck into a true produce-the-chunk drill — the
repeated-exposure + deliberate-attention combination the evidence supports.

**3b. Chunk sourcing from existing curated content (R1, no scraping).**
Two lanes, both from human-reviewed material already in the DB:

- **Transcript compounds:** `WordToken.compoundRef` in
  `discover_videos.transcript_lines` already marks multi-word units in
  reviewed transcripts. Admin surface (a section on the existing video edit
  page or a small `/admin/chunks` queue) listing compounds not yet in
  `set_phrases`, with one-click promote (pre-filled Arabic, gloss, dialect,
  source clip for audio). Native review happens where it already happens —
  the transcript workspace.
- **Lesson phrases:** `parseLessonXlsx` vocabulary entries whose
  `word_arabic` contains multiple tokens get flagged at import for optional
  promotion instead of silently living as "words".

Explicitly *not* in scope: n-gram sweeps over `caption_lines`,
`mine-dialect-corpus` expansion, or any new scraping — that's the future
inventory-mining phase, once the curated foundation is bigger.

**3c. Teddy-bear counterweight (R1).** Learners overuse a few safe phrases.
Two cheap product responses: (i) the chunk deck's "new card" selection
prefers chunks *outside* the learner's already-strong tags/occasions
(diversity-aware ordering in the existing new-card budget path); (ii)
conversation and sentence-coach prompts receive the learner's 3–5 currently
due chunks via `systemPromptExtra` and are asked to create natural openings
for them.

**3d. Learner model integration.** `learnerProfile.ts` currently ignores
`user_phrases`/`user_set_phrases`. Add known/learning chunk lists (with a
budget, like vocab's `DEFAULT_BUDGET`) so generation is conditioned on chunk
knowledge — pure change in `learnerProfileCore.ts` + its unit tests.

## Phase 4 — Pushed-output practice (salience built in)

*The `practice-sentence-coach` loop ("use this word in a sentence" → verdict,
natural rewrite, alternatives, tips) is the template: it already implements
output → salient feedback (R2). This phase generalizes it.*

**4a. Situation tasks for chunks.** Extend `practice-sentence-coach` (or a
sibling `practice-chunk-coach`) to take a `set_phrases` id: present the
scenario (`scenario_english`), learner responds by voice, coach checks the
chunk (or an accepted variant) was used naturally and rewrites what the
learner actually said. Feeds Phase 3a production ratings.

**4b. Fossilization drills (R3).** New generator conditioned on unresolved
`learner_errors` grouped by `target_arabic`+`error_kind` (the read path
`useLearnerErrors`/`mistakes.ts` exists) and weak concepts from
`pickWeakConcepts`: short forced-choice-then-produce items that make the
error impossible to ignore (maximal salience). Clean production calls
`resolveLearnerErrorsForRequest` — the existing decay mechanism. Surface as
a `TodayTask` when the unresolved count crosses a threshold, and as a
section on `/mistakes`.

**4c. Lesson "produce" phase.** `LessonPhase` is only `intro | quiz` today,
while lesson content already carries `real_world_prompts` and
`outputExpected`. Add a third phase type rendering a spoken/typed production
step after the quiz block, graded through the sentence-coach loop. This is
the largest UI change in the plan and can trail the rest — it touches
`lessonFlow.ts` (pure, tested) plus the lesson player.

**4d. Error-source plumbing.** One migration extends the
`learner_errors.source` CHECK with `monologue` and `chunk_coach` (Phases 2d,
4a) — batched together to keep the two-birds migration count down.

## Phase 5 — Shadowing refinements

**5a. Converge the two scoring paths.** `ShadowPlayer` scores via Azure while
`LineShadowPanel` uses Munsit + acoustic similarity through
`score-shadow-attempt`. Converge on the Munsit+acoustic path as primary
(it matches the `shadowScoring.ts` rationale) with Azure's calibrated output
kept for the word/sentence modes it suits.

**5b. Repetition model (R5).** Shadow Mode moves from one-take-per-clip to a
rep loop: target ~5 reps per clip with visible progression (rep counter +
per-rep score trace), auto-advance after plateau or 5 reps. Session shape
targets 10–15 minutes. Clip choice: keep the dialect filter and add a
"choose your source video" entry point — learner-chosen material is the one
motivation lever the literature supports.

**5c. Persist attempts.** New `shadow_attempts` table (same RLS pattern:
owner-read, service-role write via `score-shadow-attempt`): clip ref, rep
number, transcript similarity, acoustic score, duration, timings-derived
speech rate when available. Two payoffs: per-clip progression UI, and — since
gain durability is unverified in the literature (R5) — we can measure it
ourselves by resurfacing a previously-plateaued clip after N days and
comparing first-take scores.

**5d. Reframe feedback (R5).** Present shadowing results as *fluency and
closeness* ("smoothness", speech-rate ratio vs the native clip via Phase 1
core, transcript closeness) and drop any implication of per-phoneme
diagnosis from shadow-mode copy. Azure per-phoneme detail stays in the
word/sentence practice modes where reference-matched reading makes it valid.

## Phase 6 — Plateau visibility and honest framing

**6a. Receptive/productive gap metric (Richards #1).** The data already
exists: `word_reviews` carries independent recognition and production FSRS
schedules. A pure module computes the gap (e.g. mature-recognition vs
mature-production counts) per deck; surface it on the progress/stats page
with the production-practice CTA. No new tables.

**6b. Copy audit (R6).** Sweep marketing/onboarding/progress copy: no
"research shows" claims beyond what the research doc's verdict table
supports; hours framing follows the FSI/DLI language ("FSI's 2,200-hour
figure is for diplomat-grade proficiency including MSA reading; a spoken
dialect is a smaller target"); no English vocab-threshold numbers.

**6c. Instrumentation.** Every new surface logs through the existing
fire-and-forget `featureMetrics` sink. Given the literature gaps, our own
usage data is the only calibration source for: monologue metric percentiles
by level (→ future banding), shadowing rep-plateau shape (validate the 5-rep
default), and chunk-deck retention vs the word decks.

---

## Sequencing and dependencies

```
Phase 1 (fluency core)  ──►  Phase 2 (monologue)  ──►  6a/6c consume both
        └────────────────►  Phase 5 (shadowing reps use timing metrics)
Phase 3 (chunk deck)    ──►  Phase 4a (chunk coach feeds production ratings)
Phase 4b/4d (fossilization drills) — independent, can start immediately
Phase 6b (copy audit) — independent, cheap, do early
```

Suggested order of PRs: **1 → 2 → 3 → 4 → 5 → 6**, with 4b and 6b free to
land whenever. Each phase is shippable alone; nothing blocks on the deferred
scraping work.

## Explicitly out of scope (future work)

- **Corpus scraping / automated chunk mining** — n-gram sweeps over
  `caption_lines`, new source ingestion, `mine-dialect-corpus` expansion.
  Deferred until the curated chunk foundation (Phase 3b) is established.
- **L1 baseline recordings** for partialing personal speaking style out of
  pause measures — valid science, premature product.
- **Composite fluency scores / bands** — only after internal percentile data
  exists (6c).
- **Arabic clause-boundary (AS-unit) pause coding** — proxy now, revisit with
  stored raw timings.

## Per-phase drift-guard checklist (repo-specific)

Every phase must clear the gates that fail on *adding* code:

| Change | Required companion |
|---|---|
| New edge function | `_test/` test naming it via `loadFunction("<name>")` |
| New `_shared/` module | named by a test (Vitest in `src/test/` for pure modules) |
| New `src/lib`/`src/hooks` module | co-located `*.test.ts` |
| New route | `src/test/support/routes/manifest.ts` entry + in-app link (surfaces/TodayTask) or `NO_LINK_NEEDED` reason |
| New table/column | migration replays on stock postgres; regenerate types; emulator factory support |
| New `learner_errors.source` value | CHECK-constraint migration |
| Model-calling function | `enforceDailyCap` with tier limits; models via `modelRegistry` lineups only |
| Score-writing path | service-role writes through the edge function, owner-read RLS |

Coverage thresholds are per-directory ratchets; new `src/lib`/`src/hooks`
code needs real tests to keep the measured numbers above them.
