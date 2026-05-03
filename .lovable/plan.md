# Curriculum Coverage Ledger — stop repeating, reinforce on purpose

Add a backend "what's been taught" ledger so the Curriculum Brain stops generating duplicate content and instead either (a) advances the learner or (b) deliberately reinforces a known-but-weak item. This complements Option 4 (split-by-type workspace) — every generator reads from and writes to the same ledger.

## Concept

Three new ideas:

1. **Coverage ledger** — a normalized record of every concept (vocab lemma, grammar point, theme, scenario) that has been published into the curriculum, scoped by dialect + CEFR.
2. **Mastery signal** — per-user evidence of how well a concept is held (from existing SRS reviews, quiz scores, listening accuracy).
3. **Generation policy** — when AI is asked to make new content, the brain is given:
   - a **must-not-repeat** list (recently covered, not due for reinforcement),
   - a **reinforce** list (items the user/cohort is weak on or due for spaced re-exposure),
   - a **next-up** list (concepts the curriculum graph says should come next for this CEFR/stage).

The brain composes new content using ~70% next-up + ~20% reinforce + ~10% novel surprise (tunable).

## New tables

```text
curriculum_concepts
  id, kind ('vocab'|'grammar'|'theme'|'scenario'|'phrase'),
  key (normalized lemma / grammar slug / theme slug),
  display_arabic, display_english,
  dialect, cefr_level, stage_id (nullable),
  first_introduced_at, source_type, source_id,
  metadata jsonb

content_concept_links
  id, concept_id,
  content_type ('lesson'|'vocab'|'picture_scene'|'grammar'|'listening'|'reading'|'daily_challenge'|'conversation'|'game_set'),
  content_id,
  role ('introduce'|'reinforce'|'assess'),
  created_at

user_concept_mastery
  user_id, concept_id,
  exposures int, correct int, incorrect int,
  ease numeric, last_seen_at, next_due_at,
  strength enum ('new'|'learning'|'familiar'|'strong'|'mastered')
  PRIMARY KEY (user_id, concept_id)

curriculum_generation_log
  id, request_id, dialect, cefr, stage_id, content_type,
  prompt_summary, included_concepts uuid[], excluded_concepts uuid[],
  model, created_by, created_at
```

RLS: admins manage `curriculum_concepts`, `content_concept_links`, `curriculum_generation_log`. Users read/write only their own `user_concept_mastery`.

## How it plugs into the existing flow

```text
Admin clicks "Generate vocab set" in workspace
        │
        ▼
useGenerateContent(type='vocab', dialect, cefr, stage)
        │
        ▼
edge: curriculum-chat   ──►  coverage-planner (new edge fn)
                              ├─ reads curriculum_concepts  (what exists)
                              ├─ reads content_concept_links (recent usage, last N days)
                              ├─ reads aggregated mastery   (cohort-wide weak concepts)
                              └─ returns { avoid[], reinforce[], next_up[] }
        │
        ▼
brain prompt now includes those three lists  →  AI returns content
        │
        ▼
On admin Approve:
  • existing approve* mutations run (unchanged)
  • new "extract-concepts" edge fn parses the saved row, upserts into
    curriculum_concepts, writes content_concept_links rows
```

For per-learner experiences (Daily Challenge, Review session, Personalized Path), the same planner is called with `user_id` so it consults `user_concept_mastery.next_due_at` to pick reinforcement targets for that specific learner.

## Reinforcement rules

- A concept is **eligible for reinforcement** if `last_seen_at < now() - interval` based on strength bucket (e.g. learning = 2d, familiar = 7d, strong = 21d).
- A concept is **blocked from reuse as new** if it appeared in any approved content in the last 14 days *and* is not yet due.
- The brain is told the **role** (introduce vs reinforce) for every concept it must include, so reinforcement appears in fresh contexts (new sentence, new scene, new question type) instead of duplicate cards.

## Cohesion across types

Because the ledger is content-type-agnostic, a vocab lemma introduced in a Lesson can be reinforced by a Picture Scene hotspot, then assessed by a Daily Challenge MCQ. The workspace shows admins a small "Concept usage" panel per item: "تفاحة used in 3 lessons, 1 scene, 2 challenges — last seen 4 days ago".

## Admin-facing additions

- New left-rail entry in the Curriculum Workspace: **Coverage** — browse concepts, filter by dialect/CEFR/strength, see where each was used, manually mark "retire" or "boost".
- On every generator form: a read-only chip strip showing what the planner suggested (avoid / reinforce / next-up) with a "regenerate plan" button.
- Generation log viewer (admin) for auditing what the brain was told.

## Edge functions

- `coverage-planner` (new, `verify_jwt = true`) — pure read; returns the three lists.
- `extract-concepts` (new, `verify_jwt = true`) — runs after approval; uses Lovable AI Gateway (Gemini Flash) to normalize Arabic to lemmas + tag grammar points, then upserts.
- `curriculum-chat` (existing, edited) — calls `coverage-planner` first, injects results into the prompt, logs the request to `curriculum_generation_log`.
- `update-mastery` (new, `verify_jwt = true`) — called from review/quiz completion handlers to bump `user_concept_mastery`.

## Build steps

1. **Migration**: create the 4 tables + RLS + indexes (concept_id, dialect+cefr, last_seen_at).
2. **Backfill script** (one-time admin button): scan existing `lessons`, `picture_scenes`, `grammar_exercises`, `listening_exercises`, `reading_passages`, `daily_challenges`, `conversation_scenarios` and populate `curriculum_concepts` + `content_concept_links` via `extract-concepts`.
3. **`coverage-planner` edge function** + shared TS helpers.
4. **Wire `curriculum-chat`** to call planner and log requests; update prompt templates to honor avoid/reinforce/next-up roles.
5. **Wire approval paths** in `useCurriculumApproval` to fire `extract-concepts` on success.
6. **Mastery hooks**: update `useReview`, `useGamification`/quiz handlers, and Daily Challenge completion to call `update-mastery`.
7. **Workspace UI**: Coverage list page, per-item Concept usage panel, planner chip strip on generator forms.
8. **Personalized Path & Daily Challenge** generators switched to per-user planner calls.

## Out of scope (flag now)

- Cross-dialect concept sharing (lemma `بيت` in Gulf vs Egyptian) — for v1 we keep concepts dialect-scoped; merging is a later enhancement.
- Auto-retirement of stale published content — admins decide.
- Cohort analytics dashboards — only the basic Coverage browser ships now.

## Open questions

1. Should the reinforcement target be **per-user** everywhere, or **cohort-average** for shared content (lessons, scenes) and **per-user** only for adaptive flows (Daily Challenge, Review, Path)? Default: cohort for shared, per-user for adaptive.
2. Default mix: 70% next-up / 20% reinforce / 10% novel — OK, or do you want to tune per content type?
