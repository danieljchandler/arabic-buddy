# The quiz: phases and what each one needs

*October 2026. The execution roadmap for the quiz review style. The design
and the decisions behind it are in `docs/quiz-modes-plan-2026-10.md`; the
writeup of what ships is the README section "Reviewing as a quiz instead of
flashcards". This document is the list of phases, in order, each with what
it depends on, what to build, which guards it must satisfy, and what "done"
means — so a session can pick up the next phase cold.*

| phase | what | status |
|---|---|---|
| 0 | Proposal and decisions | done |
| 1 | The quiz style and the eight-step ladder | done (PR #422) |
| 1b | Apply the `review_style` migration to the live project | **owner action** |
| 2 | The shared asset store | done (PR #423) |
| 2b | Apply the `word_assets` migration to the live project | **owner action** |
| 3 | A picture for every word | built (PR #424); the pictures themselves are 3b |
| 3b | Deploy `word-asset`, then run `scripts/curriculum-pictures.ts` | **owner action** (after 2b for anything to be kept) |
| 4 | Generated dialogues, and saying the reply | next, after 2 |
| 5 | Animations for action words | after 2 and 3 |
| 6 | Words in stories | after 2 |
| 7 | The rest of the game | any time after 1 |
| 8 | Tuning from real reviews | once the quiz has weeks of history |
| 9 | Housekeeping | any time |

Conventions that hold in every phase, from `CLAUDE.md`:

- A migration merged through GitHub is **not** applied to the live project.
  Every phase that adds a table or column ends with the owner applying it
  (Lovable, or `supabase db push`), and until then the feature must degrade
  rather than break. Add a `typesDrift` entry naming the migration; delete it
  once a types regeneration carries the columns. Never hand-edit `types.ts`.
- A new edge function needs a file in `supabase/functions/_test/`; a new
  `_shared` module needs a `sharedModuleCoverage` entry; a new `src/lib` or
  `src/hooks` module needs a co-located test (`libCoverage`, `hookCoverage`).
- Model calls go through `askBrain` / the gateway, never a bare `fetch`;
  model ids come from `modelRegistry.ts`; image generation uses
  `IMAGE_MODEL_IDS`.
- Everything generated is on brand (Ink; see `docs/brand-refresh.md`) and in
  dialect, never MSA — Arabic text goes through the Brain's leak detector.
- The quiz never writes a rating from anything but the answer. Game chrome
  rides on XP and celebration only.

---

## Phase 1 — done

What shipped in PR #422, so the later phases know what they stand on:

- `profiles.review_style` (migration `20261009120000_profile_review_style.sql`),
  `src/lib/reviewStyle.ts`, `useReviewStyle`, the Settings row and the
  header switch (`ReviewStyleSwitch`).
- The ladder (`src/lib/quizLadder.ts`): eight steps read off memory state,
  with fallbacks; `holdsProduction` keeps "say it" until the picture step.
- Grading (`src/lib/quizGrading.ts`), the session tally and combo
  (`src/lib/quizSession.ts`), seeded options (`src/lib/quizDistractors.ts`),
  the reply question from lesson dialogue (`src/lib/quizDialogue.ts`).
- Cards: `ReviewClozeCard` (gap, now seeded and with a hint), `QuizChoiceCard`
  (meaning / listen), `QuizOptionsCard` (picture / word / reply),
  `QuizSpeakCard` (word / line, from the picture when there is one) over
  `useTakeRecorder`; `QuizCardFrame` dispatches; `QuizRungBadge`,
  `QuizSessionSummary`.
- Pools: `useQuizPool` draws wrong options, pictures and recordings from the
  wider deck. `useDueWords` selects the example sentence, transliteration and
  the lesson's dialogue; My Words selects the transliteration.
- The three review pages branch on the style; graded answers on My Words and
  My Phrases pay the flat review XP.
- Playwright: `review.spec` (gap, re-ask, picture, reply, meaning fallback,
  header switch), `my-words.spec`, `settings.spec`.

### Phase 1b — owner action

Apply `20261009120000_profile_review_style.sql` to the live project. Until
then the preference is device-local. Once the next types regeneration carries
`profiles.review_style`, delete its entry in
`src/test/support/postgrest/typesDrift.ts` (the `typesDrift` test will say so).

---

## Phase 2 — the shared asset store (done, PR #423)

What shipped, so the later phases know what they stand on (writeup: README
"The asset store"):

- `word_assets` (migration `20261009130000_word_assets.sql`), unique on
  `(concept_key, kind, coalesce(dialect, ''), style_version)` — an expression
  index, so a null-dialect row is unique on any Postgres; `style_version` is a
  column rather than a `meta` field so it can be in the key. `kind` is not a
  CHECK, so a later phase's kind needs no migration.
- `_shared/wordAssets.ts`: `assetKey` keys on the folded Arabic **plus the
  folded English sense** (`كتاب|book`), because the folding strips the harakat
  that tell homographs apart; every kind but a recording needs a sense
  (`kindNeedsSense`), a recording is keyed on its exact text, harakat kept,
  and Fusha is refused. `key.sense` is what a shared prompt is built from.
  `getAsset` / `putAsset` take any client and never throw. `fileNewAsset`
  uploads a new file under a name of its own and files it — the one way to
  add a file. `inkPicturePrompt` / `INK_PICTURE_STYLE` are the picture look
  (`ink-1`). Two kinds beyond the list below: `word_audio` and `jingle`.
- `word-asset`: `get`, and `ensure` for `kind: "image"`. Charged only on a
  miss, on the `generate-flashcard-image` counter. The prompt is built from
  the sense and dialect alone; Phase 3's authored `image_scene` is the
  `scene` argument `inkPicturePrompt` already takes, to be passed only from
  a trusted (service-role or admin) caller.
- Wired: `GenerateImageDialog` (first picture), `persist-word-audio`,
  `generate-word-jingle` with `share: true` (lyrics filed only when they pass
  the leak detector with the rulebook's tokens). `generate-flashcard-image`
  now draws in the Ink style and confines a caller-named `storage_path`
  (learners to `tutor/<id>/`, never `word-assets/`).
- `useWordAsset` (read-only).

### Phase 2b — owner action

Apply `20261009130000_word_assets.sql` to the live project and deploy
`word-asset` with the other changed functions. Until then every lookup misses
and nothing is kept. Once a types regeneration carries `word_assets`, delete
its entries in `src/test/support/postgrest/typesDrift.ts`.

### The plan, as it was written

**Goal.** Every picture, animation, recording or line made for a word is
made once and kept, for every learner and every later phase. Today a My
Words image or jingle is generated per learner onto their own row; two
learners who save "jump" pay twice, and nothing can reuse what was made.

**Depends on.** Nothing; this is the foundation for 3–6.

**Build.**

1. Migration `word_assets`:
   `id`, `concept_key text` (the normalised Arabic plus the dialect for
   dialect-bound kinds; the English concept for language-neutral kinds such
   as an animation of jumping), `kind text` (`image`, `animation`,
   `sentence_audio`, `dialogue`, `story_line`), `dialect text null`,
   `url text null`, `payload jsonb null` (a dialogue's lines, a story line),
   `meta jsonb` (prompt, model, style version, duration), `source text`
   (`generated` / `authored` / `reviewed`), `approved_at timestamptz null`,
   `created_at`; unique on `(concept_key, kind, dialect, style_version)`.
   Public read (anon and authenticated select), service-role writes only.
   `typesDrift` entries for every column.
2. `_shared/wordAssets.ts`: `assetKey(word, dialect, kind)` (pure; uses the
   same normalisation as `arabicWord.ts`), `getAsset`, `putAsset`. Tested
   from `src/test/` like the other pure shared modules.
3. Edge function `word-asset` with two actions: `get` (by key and kind) and
   `ensure` (get, else generate under the current style version through the
   Brain's image or text lineup, store, return). Rate-limited through
   `usageCap`; the generation cost is charged to the caller who missed.
   `_test/word_asset_test.ts` covers hit, miss-then-store, and the
   unconfigured-provider path.
4. Wire the existing generators to look up before they generate: the My
   Words image dialog (`GenerateImageDialog`), `persist-word-audio`, and the
   word jingle on a shared row. A hit copies the url onto the learner's row
   as today, so nothing downstream changes.
5. `src/hooks/useWordAsset.ts` for the client (`get` only; `ensure` is for
   the generators), with a test.

**Guards.** `typesDrift`, `schemaContract` (every `.from("word_assets")`
column must exist), `edgeFunctionCoverage`, `sharedModuleCoverage`,
`hookCoverage`, README section "The asset store".

**Done when.** A second learner generating an image for a word another
learner already generated gets the stored one without a model call, and the
`_test` file proves it. The migration is applied to the live project.

---

## Phase 3 — a picture for every word (built; the run is 3b)

What shipped, so the later phases know what they stand on (writeups: README
"The asset store" and "Reviewing as a quiz instead of flashcards"):

- **The trusted path in `word-asset`.** A service-role call
  (`isServiceRoleCall`) or the content team (`requireRole`,
  `CONTENT_MANAGER_ROLES`) may send `scene`, a track word's authored
  `image_scene`; a learner's is ignored, as before. Nothing on that path is
  charged to anyone. What it files is `source: "authored"` with the scene in
  `meta`, and the answer says `authored: true`. A scene too short to be a
  description is not one (`MIN_SCENE_LENGTH`), and a staff member's authored
  draw, which is uncapped, is named in the function log.
- **Decided: an authored scene replaces a gloss-only picture filed earlier**
  under the same key (curriculum and learners share keys). `isReplaceable`
  is the rule — only an unapproved `generated` asset gives way — and
  `replaceAsset` in `_shared/wordAssets.ts` does it: the row is updated in
  place and conditionally, the new picture is a new object, and the old file
  is never written over or deleted, so a learner whose own row carries it
  keeps it. Only the trusted branch calls it.
- **`scripts/curriculum-pictures.ts`** (`--dialect`, `--stage`, `--limit`,
  `--dry-run`), with its deciding half in `curriculum-pictures-core.ts` and
  `src/test/curriculumPictures.test.ts`. It reads the scene from
  `vocabulary_words.image_scene_description` (the seed writes it there), not
  from the track JSON, and writes the url onto `image_url` even when the
  store kept nothing.
- **The lazy path.** `useEnsureWordAsset` (the `ensure` call, apart from the
  read-only `useWordAsset`, which it invalidates; one ask per word, a pause
  after two failures in a row or a cap answer, never a toast). `QuizCardFrame` takes
  `onPictureMade` from My Words: a saved word at step 3 with no picture gets
  the store's, or has one made on the learner's daily picture allowance, and
  the page keeps it on `user_vocabulary.image_url`. It takes `sharedPictures`
  from the curriculum deck: the store's picture is shown for a row that has
  none, read only.
- **Pictures that can be told apart.** `PICTURE_DISTINCT_LINE` in the prompt
  template; the frame deals each url once and never the word's own.
- Guards: `word_asset_test.ts` (the trusted scene path, replacement, nothing
  charged), `wordAssets.test.ts`, `curriculumPictures.test.ts`,
  `useEnsureWordAsset.test.ts`, `QuizCardFrame.test.tsx`, and
  `review.spec.ts` ("a picture for a word that has none").

Two things a later phase should know. The card waits up to 12 seconds for a
drawing, and only when three other words in the pool have pictures — so on a
learner's first few pictured words the fallback is asked and the picture
lands behind it. And every lazy picture comes off the learner's daily
picture allowance (20 a day on the free tier), the same one the "Generate
image" button draws on: a long quiz session of unpictured words can use the
day's allowance up. If that turns out to bite, the fix is a counter of its
own for the quiz in `word-asset`, not a client-side limit.

### Phase 3b — owner action

1. Apply `20261009130000_word_assets.sql` (Phase 2b) if it is not on the live
   project yet. Without it the script still fills every row, and says so,
   but nothing it draws is kept in the store.
2. Deploy `word-asset` (this phase changed it). Until then the script stops
   on its first word, since no earlier version accepts the service-role key.
   The quiz's own ask is turned away uncharged if no `word-asset` is deployed
   at all, and served as Phase 2 serves it if that one is.
3. Run the script, dry first — it prints how many image generations the run
   comes to. The authored tracks are 837 words across the three dialects;
   the script takes every `vocabulary_words` row with no picture, so words
   imported from a workbook are in the count too, drawn from their gloss
   where they have no scene:

   ```sh
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-pictures.ts --dry-run
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-pictures.ts --dialect Gulf --stage 1 --limit 10
   ```

   Look at those ten before running the rest; a picture that came out wrong
   is fixed by clearing the row's `image_url` and its `word_assets` row and
   running again.

**Done when** (3b): every Stage 1–3 word in the three dialects has a picture.

### The plan, as it was written

**Goal.** Steps 3, 5 and 7 of the ladder only fire for words that have a
picture, and the authored tracks ship without one. Fill them in, on brand,
once per word.

**Depends on.** Phase 2.

**Build.**

1. A script `scripts/curriculum-pictures.ts` (service role, local tool like
   `curriculum-brain.ts`): for every `vocabulary_words` row with no
   `image_url`, call `word-asset ensure` with `kind: "image"` and the word's
   authored `image_scene` from the track JSON as the prompt (every track
   word carries one), in the Ink style; write the url onto `image_url`.
   `--dialect`, `--stage`, `--limit`, `--dry-run`.
2. The same for a learner's My Words, lazily: when the quiz reaches step 3
   for a word with no picture, `QuizCardFrame` asks `useWordAsset` for one
   (an `ensure` through the function, capped per day); the picture lands on
   the learner's row and in the store.
3. Pictures must be tellable apart: the picture question needs four
   distinct scenes. The prompt template says so, and the distractor dealing
   in `QuizCardFrame` already de-duplicates by url.

**Guards.** The script is a local tool (no CI gate, like the other
`scripts/`); the lazy path has a unit test in `QuizCardFrame.test.tsx` and
an e2e in `review.spec.ts` with the function stubbed.

**Done when.** Every Stage 1–3 word in the three dialects has a picture, and
a saved word gets one the first time the quiz asks for a picture.

---

## Phase 4 — generated dialogues, and saying the reply

**Goal.** "Someone says something, choose the reply" (step 6) exists only
for words whose lesson dialogue uses them. Give every word a two-line
exchange, and add the spoken form: hear the line, say the reply.

**Depends on.** Phase 2.

**Build.**

1. `kind: "dialogue"` in the asset store: `payload` is two lines
   `{ speaker, arabic, english, transliteration }`, the second using the
   word. Generated once per word and dialect by `word-asset ensure` through
   `askBrain` (CONTENT lineup, `draft_critic`, native validator on), with
   the word's example sentence as context. Keyed on the word and dialect.
2. `QuizCardFrame` falls back from the lesson dialogue to the stored one
   when the lesson has none (`buildReplyQuestion` already takes any lines;
   the wrong replies come from other stored dialogues in the pool, so
   `useQuizPool` grows a `dialogueLine` per entry).
3. A new format `speak-reply` at a new step 9 ("Say the reply"): the line
   plays, the learner says the reply; scored with `azure-pronunciation`
   against the stored reply, the word required (`arabicSimilarity` on the
   word's span, else Again). `QuizSpeakCard` gains the `speak-reply` format;
   `rungForMemory` places it above "say the line" on the production
   schedule; `QUIZ_STEP_COUNT` becomes 9; README and the badge follow.

**Guards.** `quizLadder.test.ts` (new step and fallbacks),
`quizDialogue.test.ts` (stored dialogue path), `QuizSpeakCard.test.tsx`,
`_test/word_asset_test.ts` for the dialogue kind, e2e for the spoken reply
with the scorer stubbed.

**Done when.** A saved word from a video reaches step 6 with a generated
exchange, and a mature word is asked to say the reply.

---

## Phase 5 — animations for action words

**Goal.** For a verb or an action noun, an animation of the concept (someone
jumping) replaces the picture as the "say it" prompt.

**Depends on.** Phases 2 and 3.

**Build.**

1. `kind: "animation"` in the asset store, keyed on the **English** concept
   (language-neutral: every dialect's "jump" shares one), a short looping
   clip in the Ink style, generated through the video lineup once it is in
   `modelRegistry.ts` (none today — adding it is part of this phase, with a
   `reasoningFloor` and a gateway route).
2. Which words qualify: `vocabulary_words.category` of `Verb`, plus an
   allow-list of action nouns; a script fills them like Phase 3's.
3. `QuizSpeakCard` shows the animation where the picture would be; the
   picture question (step 3) can also show it as one of the four.

**Guards.** As Phase 3, plus `modelRegistry.test.ts` for the new lineup.

**Done when.** The Stage 1 verbs have animations and "say it" uses them.

---

## Phase 6 — words in stories

**Goal.** A mature word turns up in a short passage: a gap to say, or a
question about the line.

**Depends on.** Phase 2.

**Build.**

1. `kind: "story_line"`: a two-sentence passage using the word, from the
   reading library where a published story already contains the word
   (search `reading_library` content), else generated once through
   `askBrain` and stored.
2. A format `story-gap` at a new step above the reply: the passage with the
   word blanked, read aloud with the gap muted (the cloze card's masked TTS
   already does this), the learner says the word; scored. For a learner
   whose device cannot record, the four-option gap instead.
3. "Why not this one?" on a wrong story pick, through `AskAISentence`.

**Guards.** As Phase 4.

---

## Phase 7 — the rest of the game

**Goal.** The flourishes designed in the plan and not yet built. Each is
independent of the asset store.

- **Lightning round**: after the session, a 60-second round over today's
  right answers at steps 1–4; score and time only, nothing written to any
  schedule. Reuses the question cards with a timer; `src/lib/lightningRound.ts`
  pure and tested.
- **Boss card**: the leech with the most lapses opens the session at step 1
  with its mnemonic and picture; clearing it is a `celebrate` tier.
- **Why not this one?**: on a wrong choice, one tap on the picked option
  asks the tutor why it does not fit (`AskAISentence` with the pair).
- **Ladder climbs on the leaderboard**: a weekly count of promotions beside
  XP (`useLeaderboard`, the `leaderboard_profiles` view).
- **XP parity for the flip cards** on My Words and My Phrases: an open
  question for the owner, since it changes existing behaviour.

**Guards.** Unit tests per module, `routeReachability` if any new route,
e2e for the round.

---

## Phase 8 — tuning from real reviews

**Goal.** The thresholds in `LADDER_THRESHOLDS` are a first guess. Once the
quiz has weeks of ratings, set them from the data.

**Build.** A script over `review_log` (which records every curriculum and
set-phrase rating with stability before and after) reporting accuracy per
step and per format, and the stability at which each step's accuracy
settles; move the thresholds to where the next step's accuracy would be
about 85%. Add the format to what the page records (a `review_log.detail`
jsonb, or the existing `featureMetrics` sink) so the report can tell a gap
from a picture.

**Done when.** The thresholds have been set from at least a month of
ratings and the README table says so.

---

## Phase 9 — housekeeping

- `ReviewQuizCard` and `ReviewImageQuizCard` are superseded by
  `QuizOptionsCard` and still imported by nothing but their tests; delete
  them with their tests.
- `src/config.ts` carries a stale per-rating `REVIEW_XP` map; delete it.
- The old even-card cloze on My Words is gone from the flip cards; remove the
  `useTranscriptCloze` lookup's flip-card branch if any remains.
- The end-of-queue refetch on the review pages races the queue's flush and
  can re-show a just-rated card as due (a race the flip cards always had;
  `review.spec.ts` "asked afresh" notes it). Fix by awaiting the queue's
  flush before the refetch, or by patching the deck cache from the queued
  rating.
