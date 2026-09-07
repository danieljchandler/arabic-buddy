# Curriculum tracks — where this stopped, and how to resume

*Written 2026-09-07 when authoring was paused deliberately. Nothing here is
broken; it is unfinished. Everything that exists is validated, seeded and
shipping.*

## State

54 of the 114 lesson slots are authored (38 syllabus slots × 3 dialects).

| Dialect | Stage 1 (of 12) | Stage 2 (of 14) | Stage 3 (of 12) | Words |
| --- | --- | --- | --- | --- |
| Gulf | 10 | 8 | 5 | 357 |
| Yemeni | 9 | 5 | 6 | 304 |
| Egyptian | 4 | 3 | 4 | 176 |

`curriculum/tracks/STATUS.md` has the slot-by-slot table. Every authored lesson
passes the full contract — syllabus slot, all target concepts realised, stage
word minimum, no word introduced twice in a dialect, MSA-leak scan for its
dialect — and the seed migration compiles exactly what is on disk. CI is green.

## What is done and needs nothing

- The syllabus (`curriculum/tracks/syllabus.json`), the schema and authoring
  guide (`SCHEMA.md`), the validator (`src/lib/curriculumTracks.ts`).
- The seed generator and its migration; the schema migration for the new
  lesson/vocabulary columns; `Learn.tsx` rendering the grammar, culture and
  dialogue sections.
- The video-needs manifests (`curriculum/video-needs/<dialect>.md`).
- The drift guards, which ratchet on the counts above: add lessons freely,
  raise `AUTHORED` in `src/test/curriculumTracks.test.ts` in the same commit.

## What is unfinished

1. **60 lesson slots.** The empty cells in `STATUS.md`. Nothing depends on them
   — the app shows what exists.
2. **The Brain review has never been run.** `scripts/curriculum-brain.ts` is
   written and typechecks, but needs provider keys, so no lesson has had its
   native-speaker pass. Until then the Arabic is model-authored and
   leak-scanned, not natively reviewed.
3. **Video coverage has never been run.** `scripts/curriculum-video-coverage.ts`
   needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; no
   `coverage-<dialect>.md` exists yet, so nobody has matched the authored words
   against the videos already uploaded.
4. **No images or audio.** Every word carries an `image_scene` and the lessons
   name their sounds, but no illustration or recording has been generated.
5. **The draft `concept_realizations` rows** the seed writes are `status:
   'draft'`. The clip miner only expands **approved** realisations, so a native
   reviewer has to approve them before mining finds anything.

## How to resume authoring

The material the authors worked from is committed in
`docs/curriculum-research/`: the three dialect briefs (`gulf.md`,
`egyptian.md`, `yemeni.md` — sources, grammar paradigms, identity vocabulary,
culture thread, video sourcing) and the nine authoring prompts
(`prompt-<dialect>-<stage>.md`) that produced the existing lessons. The prompts
are self-contained: hand one to an agent, tell it which lesson numbers are
missing, and it writes them in the same shape.

Per lesson, the loop is:

```sh
npx vite-node scripts/check-curriculum-tracks.ts --dialect Gulf --stage 2 --partial
```

and when a batch is done:

```sh
npm run curriculum:check        # all dialects, full contract
npm run curriculum:seed         # regenerate the seed migration
npm run curriculum:video-needs  # regenerate the shopping lists
npx vitest run src/test/curriculumTracks.test.ts src/test/curriculumSeed.test.ts
```

Then raise the counts in `AUTHORED` (`src/test/curriculumTracks.test.ts`) —
the failure message prints the number to use.

Two rules that bit the first pass, worth carrying forward:

- **A word may be introduced once per dialect, across all three stages.** When
  two syllabus slots want the same idea (`but` in Stage 2 and `however` in
  Stage 3), the later slot needs its own word — Gulf took مع هذا, Egyptian
  إنما. Recycle freely in examples and dialogue; just not in `vocabulary`.
- **The leak detector is the floor, not the bar.** It catches the known list;
  it cannot catch a stiff sentence or a Kuwaiti form labelled Saudi. That is
  what the Brain review (item 2 above) is for.

## To see it in the database

Apply `20260905100000_curriculum_tracks_schema.sql` and
`20260905110000_seed_curriculum_tracks.sql`. Both are idempotent — lessons
upsert on `source_key`, words insert then update, nothing is deleted — so
re-running a regenerated seed is safe and keeps learner progress. Replayed
against stock Postgres 16 the seed produces 54 lessons, 837 words with example
sentences, 681 draft realisations and 17 grammar concepts.
