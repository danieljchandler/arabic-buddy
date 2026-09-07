# Curriculum tracks — authoring guide

`curriculum/tracks/` is the source of truth for the authored Stage 1–3
curriculum (Pre-A1 → B1) in every dialect. It is checked into git, validated
in CI, and compiled into a seed migration; nothing here is edited in the
database.

```
curriculum/tracks/
  syllabus.json                 one dialect-neutral syllabus: 38 lesson slots
  SCHEMA.md                     this file
  <dialect>/stage-<n>/_stage.json      { dialect, stage, variety }
  <dialect>/stage-<n>/<nn>-<slug>.json one TrackLesson per file
```

`<dialect>` is `gulf`, `egyptian` or `yemeni`. Types live in
`src/lib/curriculumTracks.ts`; that module's `validateTrack` is what
`npm test` and `npx vite-node scripts/check-curriculum-tracks.ts` run.

## The syllabus is the contract

`syllabus.json` fixes, per lesson slot: `slug`, `lesson_number`, the CEFR
target, can-do goals, grammar targets (one of the six shared categories:
`verb-conjugation`, `pronouns`, `negation`, `possessives`, `questions`,
`sentence-structure`), the cultural thread, the `target_concepts` every
dialect must realise, and the scene a clip for the lesson should show.

A dialect file for a slot must:

- carry the same `slug` and `lesson_number`;
- include **one word per target concept**, with `concept_key` set to the
  concept's key (dialect-specific extras are welcome and need no key, or may
  reuse a key from `vocab_concepts`);
- meet the stage's `words_per_lesson` minimum (12 / 14 / 14);
- never introduce the same Arabic string as a new word twice in the dialect
  (a recycled word belongs in examples and dialogue, not in `vocabulary`);
- have grammar notes when the syllabus targets grammar, at least one culture
  note, a dialogue of ≥ 2 lines, a lesson sequence, real-world prompts and
  `video_needs`.

## A lesson file

```jsonc
{
  "slug": "greetings-and-replies",
  "lesson_number": 2,
  "title": "Greetings and Their Replies",
  "title_arabic": "التحيات وردودها",
  "description": "One or two sentences a learner reads on the lesson card.",
  "cefr_target": "Pre-A1",
  "duration_minutes": 15,
  "approach": "GPA Phase 1 — receptive first; every greeting is heard with its reply before it is said.",
  "unlock_condition": "≥9/12 on the final listen-and-tap quiz",
  "icon": "👋",
  "can_do": ["Greet someone and answer their greeting"],
  "grammar": [
    {
      "category": "pronouns",
      "title": "-ak / -ik: who you are talking to",
      "explanation": "Plain-language, no meta-language the learner has not met. Two to five sentences.",
      "examples": [{ "arabic": "إزيك؟", "transliteration": "izzayyak?", "english": "how are you? (to a man)" }]
    }
  ],
  "culture": [
    {
      "title": "The reply is the lesson",
      "note": "What a learner needs to know to behave well, in 2–6 sentences.",
      "phrases": [{ "arabic": "…", "transliteration": "…", "english": "…" }]
    }
  ],
  "vocabulary": [
    {
      "arabic": "إزيك",
      "transliteration": "izzayyak",
      "english": "how are you? (to a man)",
      "category": "greeting",
      "teaching_note": "Why this word, what to notice, the trap to avoid.",
      "image_scene": "What the illustration shows so the meaning is self-evident.",
      "concept_key": "how_are_you",
      "variants": ["ازيك", "إزيّك", "إزيكم"],
      "example": { "arabic": "إزيك يا أحمد؟", "transliteration": "izzayyak ya aḥmad?", "english": "How are you, Ahmed?" },
      "video_hint": "Two people meeting; the greeting is the first thing said."
    }
  ],
  "dialogue": [
    { "speaker": "Ahmed", "arabic": "…", "transliteration": "…", "english": "…" }
  ],
  "sound_spotlight": [
    { "sound": "ق", "example": "قهوة", "explanation": "…" }
  ],
  "lesson_sequence": [
    { "step": "Listen & see", "detail": "…" }
  ],
  "real_world_prompts": [
    { "prompt": "In-app copy the learner reads.", "context": "When it is shown and what it activates." }
  ],
  "video_needs": {
    "queries": ["ازيك عامل ايه", "تحية مصرية"],
    "channels": ["Easy Arabic"],
    "scene": "Two people greeting at a door; the reply audible."
  }
}
```

## Rules that the validator cannot check but review will

- **Dialect, never MSA.** Every Arabic field is run through the MSA-leak
  detector (`supabase/functions/_shared/msaLeakDetector.ts`) for its dialect
  and a hit fails the build. That list is the floor, not the bar: no
  `أريد`, `أذهب`, `ماذا`, `كيف حالك` in Egyptian, and so on.
- **Spelling follows how the dialect is actually written online** (the way
  the clip miner will find it in captions), with `variants` covering the
  other common spellings, the definite form and the plural where a learner
  will meet them.
- **Transliteration follows the dialect's rules** in
  `getDialectTransliterationRules` (`_shared/dialectHelpers.ts`): Gulf ق → g,
  ج → y where the variety says so; Egyptian ج → g, ق → ʔ (written ʾ or 2);
  Yemeni ق → g in Ṣanʿāni.
- **Examples are one short, natural sentence** a learner at that level could
  say, recycling earlier lessons' words wherever possible.
- **Teaching notes explain why this word now** and name the trap (the MSA
  form the learner may know, the false friend in another dialect).
- **Images must make the meaning self-evident** without text — the Stage 1
  flashcards are image-only on the front.

## Paper trail for video

`video_needs` and each word's `variants` / `video_hint` are compiled into
`curriculum/video-needs/<dialect>.md` by
`npx vite-node scripts/build-video-needs.ts`, and matched against what is
already uploaded by `scripts/curriculum-video-coverage.ts`. Every word with a
`concept_key` is also seeded into `vocab_concepts` / `concept_realizations`
(status `draft`) so the clip miner can hunt for it.

## Regenerating the seed

```sh
npx vite-node scripts/check-curriculum-tracks.ts        # validate + leak-scan
npx vite-node scripts/build-curriculum-seed.ts          # rewrite the seed migration
npx vite-node scripts/build-video-needs.ts              # rewrite curriculum/video-needs/
```

`src/test/curriculumSeed.test.ts` fails when the migration is stale.
