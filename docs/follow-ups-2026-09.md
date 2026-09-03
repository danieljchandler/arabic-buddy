# Follow-ups after the September 2026 research branch

*What is left after `docs/language-learning-research-2026-09.md` and
`docs/language-learning-plan-2026-09.md` were implemented. Nothing here is
half-built; each item is either a decision, an action outside the codebase,
something that needs time to accumulate, or an optional extension recorded so
it is not rediscovered.*

## Needs a person

1. **Email Soliman & Familiar for the Arabic Vocabulary Profile list**
   (Critical Multilingualism Studies 11(1):266–286). ~1,200 A1–A2 items,
   openly published as an article but not confirmed as machine-readable
   data. Use: a validation set for the frequency ranks
   `derive-word-frequency` derives — not the ranking itself, it is too small.
2. **Write to UBC-NLP before touching Casablanca** — even for evaluation.
   CC-BY-NC-ND-4.0 and "academic research and non-commercial use only";
   the ND clause independently rules out fine-tuning. Only validation/test
   splits are released anyway. Research §8.
3. **Licence checks:** each Arab Voices dataset individually (31 datasets,
   licences vary); the Sentence-ALDi model before switching the ALDi signal
   on; Casablanca as above.
4. **Do not put the anxiety benefit in onboarding or marketing copy** until
   placement history and C-tests (Phase 6) can measure it. Two designs show
   AI speaking practice lowers speaking anxiety (d = 0.39–0.76); neither is
   randomized and neither shows a skill gain. Claim the on-ramp, never the
   accelerator. Research §6.

## Needs a deployment switch

5. **Schedule `derive-word-frequency`** nightly (an external scheduler
   calling the function with the `x-frequency-secret` header; set
   `FREQUENCY_DERIVE_SECRET`). Until it runs, `frequency_rank` is null
   everywhere and new cards fall back to due-date order — correct, just not
   common-first. Optional body: `{ "dialect": "Gulf", "minDialectScore": 0.05 }`.
6. **Set `ALDI_HF_MODEL`** (and a HuggingFace key) once the licence is
   cleared. The signal is inert without it; when on it is log-only — an
   `aldi_score` beside `msaLeakDetector`'s verdict in
   `dialect_rule_violations.metadata`. Compare the two against native-review
   outcomes before making either a gate. `docs/testing.md` has the note.
7. **Migrations.** Six new ones on this branch (`review_log`, conversation
   error sources, `user_perception_progress`, `dialect_word_frequency` +
   `frequency_rank`, `profiles.fsrs_weights`, `placement_results` +
   instruments). All replay on stock Postgres. `word_reviews.last_result`
   is created `IF NOT EXISTS` because the generated types always listed it
   and no migration had ever created it.

## Needs time, not code

8. **Per-learner FSRS fitting** becomes usable at 1,000 rated reviews per
   learner in `review_log`, which only starts filling when the trigger
   migration deploys. Until then Settings says "not enough history" and the
   calibration multiplier remains the cold-start path. Research §1: fitting
   is worth more than the algorithm version.
9. **Every threshold documented as a starting point** is meant to be refit
   against real rows once they exist: the beginner block at 200 reviews
   (`BEGINNER_REVIEW_THRESHOLD`), the caption `dialect_score` floor (0.05),
   Sound Pairs' 60-day durability check, the monologue bands the plateau
   plan deferred, the 90-day / 300-review re-placement rule.

## Optional extensions, recorded so they are not rediscovered

10. **`fsrs-browser` WASM trainer** as a drop-in for the coordinate-descent
    step in `src/lib/fsrsFit.ts`. The gate (held-out log loss must beat the
    defaults by 0.5%) and the bounds are the parts that matter and are
    independent of the optimizer. `computeParameters(ratings, delta_ts,
    lengths, …)` over flat arrays; ~330 KB WASM; single-threaded without a
    thread pool.
11. **Sound Pairs:** clip-based audio from `published_clips` (needs the
    YouTube iframe API for a ten-second item — the reason it launched on word
    recordings + TTS) and talker variety, which the evidence says helps only
    higher-proficiency learners (research §5b).
12. **Set-phrase practice** is common-first within each occasion band now;
    the personal word deck deliberately is not ranked (the learner chose
    those words).
13. **`conversation-practice` is gone.** Nothing called it. If a server-side
    conversation turn is ever wanted again, `free-chat` plus
    `extract-learner-errors` is the shape to extend.

## Known-good state at branch tip

- Typecheck (app + e2e), lint ratchet (530, unchanged), coverage-thresholded
  Vitest (359 files / 6,085 tests), migration replay on Postgres 16,
  `deno check` and the full edge suite on CI's pinned deno 2.9.5
  (1,858 passed), full Playwright suite (2,131 passed; one load-induced
  timeout in `alphabet.spec` that passes alone).
- The twelve edge tests that were red on `main` under the pinned deno are
  fixed on this branch (Google's OpenAI-compatible route is now stubbed
  beside OpenRouter where a tool answer is needed; the harness warns at call
  time when that shape bites).
- The migration-replay job that was red on `main` (a dashboard-generated
  duplicate migration) is fixed on this branch.
