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
| 1 | The quiz style and the eight-step ladder (ten since Phase 6) | done (PR #422) |
| 1b | Apply the `review_style` migration to the live project | **owner action** |
| 2 | The shared asset store | done (PR #423) |
| 2b | Apply the `word_assets` migration to the live project | **owner action** |
| 3 | A picture for every word | built (PR #424); the pictures themselves are 3b |
| 3b | Deploy `word-asset`, then run `scripts/curriculum-pictures.ts` | **owner action** (after 2b for anything to be kept) |
| 4 | Generated dialogues, and saying the reply | built (PR #425) |
| 4b | Deploy `word-asset` (this version) | **owner action** (after 2b; one deploy covers 3b's) |
| 5 | Animations for action words | built (PR #426); the clips themselves are 5b |
| 5b | Apply the bucket migration, deploy `word-asset`, run `scripts/curriculum-animations.ts` | **owner action** (after 2b) |
| 6 | Words in stories | built (PR #428) |
| 6b | Deploy `word-asset` (this version), then run `scripts/curriculum-stories.ts` | **owner action** (after 2b) |
| 7 | The rest of the game | built: "Why not this one?" (PR #430), the lightning round (PR #431), the boss card (PR #432), ladder climbs (PR #433); XP parity is the owner's question |
| 7b | Apply the `leaderboard_climbs` migration to the live project | **owner action** |
| 8 | Tuning from real reviews | groundwork built (PR #436): each rating records what it was asked as, and the report is written; the tuning itself is 8c |
| 8b | Apply the `quiz_rating_asked` migration to the live project | **owner action** |
| 8c | Run `npm run quiz:ladder-report` after a month of ratings, and set the thresholds | **owner action** (after 8b) |
| 9 | Housekeeping | built (PR #434); a zero-day interval in the scheduler is the owner's question |

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

An independent review before merge found the phrase mismatch, the short-word
leniency, the uncheckable rewrite, the unchargeable-word loop and the URL
bound; all five are fixed above. One design question it raised went to the
owner: step 9 is scored against the exact stored reply, so a learner who
says a correct paraphrase loses on completeness and could be rated Again, a
lapse on a production card at 30+ days. **Decided 2026-10-10 (shipped with
Phase 5, PR #426): such a take is not a lapse.** A reply whose word span
reaches `REPLY_WORD_CLEAR` (0.8) is Hard however low it scored
(`quizGrading.ts`, the `reply` flag on a speech outcome).

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

## Phase 4 — generated dialogues, and saying the reply (built, PR #425)

What shipped, so the later phases know what they stand on (writeups: README
"Reviewing as a quiz instead of flashcards" and "The asset store"):

- **`kind: "dialogue"` in the store** (`_shared/wordDialogue.ts`): `payload`
  is `{ lines: [said, reply] }`, each line `{ speaker, arabic, english,
  transliteration }`; the reply uses the word as a whole word and the line
  said does not (`asStoredDialogue`, read the same way by the function, the
  pool and the frame). Style `text-1`, no bucket, filed with `putAsset`.
- **`word-asset ensure` writes it** through `askBrain` (CONTENT lineup,
  `draft_critic`, `enforceDialect` and `validateDialect`, a quality gate on
  the word), files it only if every line passes the leak detector with the
  rulebook's tokens (quotes stripped first, `dialogueLinesForScan`) and the
  native reviewer passed the shipped text (a rewrite is judged too), and
  charges `word-asset-dialogue` (30 / 100 / 300 a day). A word that is itself
  a leak token is refused before the charge (`word_not_in_dialect`).
- **`_shared/wordAssets.ts`** gains `lookupAsset` (a missing table told apart
  from a miss) and `getAssets` (many keys in one query, at most
  `MAX_KEYS_PER_READ` = 100 keys and `MAX_KEY_BYTES_PER_READ` = 6,000 bytes
  encoded).
- **`useEnsureWordAsset`** keeps every piece of session state per kind.
- **`useQuizPool`**: each word entry carries `dialogueLine`, its stored reply,
  read for the likeliest hundred words in one query (a learner's most settled,
  the curriculum's earliest). Not for the phrase deck.
- **The ladder**: step 9 "Say the reply" (`speak-reply`) at production
  stability `LADDER_THRESHOLDS.replyDays` (30) and up; no reply → step 8, no
  sentence either → say it, no microphone → the flip card. `QUIZ_STEP_COUNT`
  is 9.
- **`QuizSpeakCard`** `speak-reply`: the line is played once, the reply's
  meaning is shown (or a gap when it has no English), the translation of the
  line is help, and the grader sees `wordSpanSimilarity` — the word's span of
  what was heard, an attached و/ب/ال taken off, a word of three letters or
  fewer held to an exact match — so a reply without the word is Again.
- **One rule for "uses the word"**, `lineUsesWord`, on the store's side and
  the quiz's, so a phrase (a fifth of the curriculum) is asked from its
  exchange like a word.
- **`QuizCardFrame`** `storedDialogues` (the curriculum deck and My Words):
  the lesson's dialogue first, else the stored exchange, else one written.
  The picture and the exchange settle through one per-card hook
  (`useCardAsset`), each bounded (`DIALOGUE_LOOKUP_WAIT_MS`,
  `DIALOGUE_WRITING_WAIT_MS` = 12 s); the card waits on a writing only when
  its question could be asked now.
- Guards: `word_asset_test.ts` (17 dialogue cases), `wordDialogue.test.ts`,
  `wordAssets.test.ts`, `quizLadder.test.ts`, `quizDialogue.test.ts`,
  `quizGrading.test.ts`, `QuizSpeakCard.test.tsx`, `QuizCardFrame.test.tsx`,
  `useEnsureWordAsset.test.ts`, `useQuizPool.test.ts`, and `review.spec.ts`
  ("the reply steps, from a word's exchange").

**Decided in this phase** (each argued in the README):

1. *A shared prompt takes nothing from a learner.* The plan below said to give
   the model the word's example sentence. A saved word's sentence is the
   learner's own text, and an exchange is filed for every later learner of
   the key, so a learner's miss carries the key's folded word, folded sense
   and dialect only, as a picture's does. The trusted path (the same
   `isServiceRoleCall` / `requireRole` gate as a picture's `scene`) may add
   `example`, a curriculum word's authored example sentence
   (`authoredExample`); that files as `authored`, uncharged, and takes the
   place of an exchange a learner's miss wrote.
2. *A leaking exchange is not served either.* A line the learner is about to
   choose, or say as a model of the dialect, must not be MSA, so a failed
   leak check or a native "rewrite" answers the graceful
   `{ error, fallback: true }` and the card asks its fallback. The miss was
   charged (the cap is taken before anything is made, as for a picture).
3. *Its own counter, and both word decks may ask.* A picture is kept on the
   learner's row, which a learner cannot write for a curriculum word; an
   exchange lives in the store alone, and the curriculum's are bounded in
   total, so the curriculum deck asks as My Words does.
4. *No exchange while the table is missing.* It has nowhere else to live, so
   one that cannot be filed would be paid for again at every encounter:
   `ensure` answers `503 store_not_ready` before the cap.

An independent review before merge found the phrase mismatch, the short-word
leniency, the uncheckable rewrite, the unchargeable-word loop and the URL
bound; all five are fixed above. One design question it raised went to the
owner: step 9 is scored against the exact stored reply, so a learner who
says a correct paraphrase loses on completeness and could be rated Again, a
lapse on a production card at 30+ days. **Decided 2026-10-10 (shipped with
Phase 5, PR #426): such a take is not a lapse.** A reply whose word span
reaches `REPLY_WORD_CLEAR` (0.8) is Hard however low it scored
(`quizGrading.ts`, the `reply` flag on a speech outcome).

Two things a later phase should know. Step 6 needs three other words with
stored replies before it can ask from a stored exchange, so on a learner's
first few exchanges it picks the word while the exchange is written behind it
(the same bootstrapping as the picture step). And no script fills the
curriculum's exchanges from their authored examples: the trusted path accepts
`example`, but nothing sends it yet, so curriculum words get learner-written
exchanges, which an authored run would replace. That script is the obvious
follow-up if the learner-written ones read worse than the authored lessons.

### Phase 4b — owner action

Deploy `word-asset` (this phase changed it again; one deploy covers 3b's
step 2), after Phase 2b's migration. Until then the deployed function answers
an exchange `kind_not_generated` (Phase 2 or 3) or 404 (none), uncharged, and
the quiz asks its fallbacks: step 6 picks the word, step 9 says the line.
Nothing to run.

**Done when** (4b): a saved word from a video reaches step 6 with a written
exchange in production, and a mature word is asked to say the reply.

### The plan, as it was written

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

## Phase 5 — animations for action words (built, PR #426; the run is 5b)

What shipped, so the later phases know what they stand on (writeups: README
"Reviewing as a quiz instead of flashcards" and "The asset store"):

- **A video model.** `VIDEO_MODEL_IDS.VEO_LITE` (`google/veo-3.1-lite`) in
  `modelRegistry.ts`, with a reasoning floor of `none` and per-second prices
  (`VIDEO_PRICE_USD_PER_SECOND`, beside `IMAGE_PRICE_USD`) for the dry runs.
  `aiGateway.generateVideo`: Google's `predictLongRunning` (the Preview name
  via `GOOGLE_MODEL_ALIASES`) on `GEMINI_API_KEY`, then the same model on
  OpenRouter's `/videos`, silent; never a second render of a job a provider
  accepted, and Google's key only to Google's host. `generateImage` takes
  `aspectRatio`. `modelRegistry.test.ts` scans for hardcoded image and video
  ids as well as chat ones.
- **`kind: "animation"` in the store**, keyed on the action alone
  (`animationConcept`, used by `assetKey`): one clip per action across
  dialects, a qualifier kept ("run (a business)" is never "run"),
  alternatives kept whole, and nothing keyed on a note or a verb with nothing
  to watch. `INK_ANIMATION_STYLE` and `NEUTRAL_FIGURE_LINE` beside
  `INK_PICTURE_STYLE`; `STYLE_VERSIONS.animation` stays `ink-1`.
  `_shared/wordAnimation.ts`: `qualifiesForAnimation`, `isVerbCategory`,
  `ACTION_NOUNS`, the poster and clip prompts, `asStoredAnimation`.
- **A bucket**, `word-animations` (migration
  `20261009140000_word_animations_bucket`): public, service-role writes only,
  MP4 and stills, 8 MB. `uploadNewFile` names a poster as `fileNewAsset`
  names an asset.
- **`word-asset ensure` makes clips on the trusted path only**: a 16:9 Ink
  poster, then Veo with it as first and last frame, both filed under fresh
  names; the service role charged nobody, the content team on
  `word-asset-animation` (ten a day); a learner's ask refused before any spend (`403
  animation_not_for_learners`); `store_not_ready` / `bucket_not_ready` before
  the poster; a render past 100 s finished under `waitUntil` (`202 pending`).
- **`scripts/curriculum-animations.ts`** (`--dialect`, `--stage`, `--limit`
  in clips, `--dry-run` with the bill), its core in
  `curriculum-animations-core.ts`, covered by
  `src/test/curriculumAnimations.test.ts`. Today: 62 clips, about $16.55.
- **The quiz.** `QuizItem.category` (the curriculum deck selects it) and
  `QuizCardFrame` `animations` (the curriculum deck sets it). A third asset
  settled through `useCardAsset` (`ANIMATION_LOOKUP_WAIT_MS`, a read only).
  `QuizSpeakCard` shows the clip in the picture's place at "say it";
  `QuizOptionsCard` deals it at "pick the picture", one visual per word,
  never another word with the same sense or an overlapping action
  (`actionsOverlap`; tense twins such as "ate" and "eat" are not caught), and
  a lone clip held
  still (`MIN_MOVING_OPTIONS`). `QuizAnimation`: muted, looped, inline, no
  controls; the poster under reduced motion, when held still, or when the
  clip will not load. `useQuizPool` reads the curriculum's clips in one query.
- Guards: `modelRegistry.test.ts`, `ai_gateway_test.ts` (the video ladder),
  `wordAssets.test.ts` (animation keys, `uploadNewFile`),
  `wordAnimation.test.ts` (the rule against the real tracks),
  `word_asset_test.ts` (ten animation cases), `curriculumAnimations.test.ts`,
  `QuizAnimation.test.tsx`, `QuizSpeakCard.test.tsx`,
  `QuizOptionsCard.test.tsx`, `QuizCardFrame.test.tsx`,
  `useQuizPool.test.ts`, and `review.spec.ts` ("an animation for an action
  word").

**Decided in this phase** (each argued in the README):

1. *The model is Veo 3.1 Lite* (the owner's choice, 2026-10-09): $0.05/s on
   Google with audio always rendered, $0.03/s silent on OpenRouter; a clip is
   a $0.067 poster plus four seconds, about $0.27. Veo 3.1 Fast doubles that
   for motion a loop of one action does not need; Kling v3.0 std draws true
   squares but has no second route; Sora 2's API was being retired.
2. *A clip is the poster set moving*: drawn first in the Ink picture style,
   then the clip's first and last frame. It loops, keeps the look, and the
   poster is the reduced-motion still.
3. *Only the trusted path makes clips; learners read them.* No learner
   counter, because no learner is charged. The service role (the script) is
   charged nobody; the content team is capped (below).
4. *A learner's saved words do not qualify*: `user_vocabulary` has no part of
   speech, and an English gloss cannot tell "to fly" from "a fly".
5. *Its own bucket*, so it can refuse anything that is not a clip or a still;
   that is a migration, so applying it is part of 5b.
6. *Motion is never the tell*: a clip on the picture question moves only
   when another option does.

An independent review before merge found two ways a clip could be paid for
twice — a download that broke after Google had rendered it, and a start
whose answer could not be read, both of which fell back to OpenRouter — and
a budget that started after the poster and could outrun the worker's wall
clock. All three are fixed above (stop after any start, one 340 s deadline,
no route with under 120 s left). It also found "turned out (to be) / went
out" keying a clip, a word with no category qualifying through the
action-noun list, Google's key able to follow a download redirect, an exact
content-type match deciding whether a paid clip was kept, and near-twin
actions ("watch / see", "watch") dealt side by side; all fixed. One design
point it raised went to the owner: a `content_reviewer` (which an ID login
can be) could make clips uncapped, about four pictures' worth each, through
the same gate as an authored scene. **Decided 2026-10-10: capped.** The
content team's clips are counted on `word-asset-animation`, ten a day per
person (`ANIMATION_STAFF_CAP`); the service role is not counted, and an
admin, as for every cap, is not limited.

**On "done when".** The plan says the Stage 1 verbs. The tracks' Stage 1
verbs are almost all "I want" ("أبي", "اشتي", "تبي"), which has nothing to
watch and is not keyed, so Stage 1 has one clip ("give me / pass me"). The
clips start to matter at Stage 2's daily routine (33 actions). Read "done"
as Stages 1–2.

### Phase 5b — owner action

1. Apply `20261009130000_word_assets.sql` (Phase 2b) if it is not on the live
   project yet, and `20261009140000_word_animations_bucket.sql`. Without
   either the script makes nothing and says which is missing.
2. Deploy `word-asset` (this phase changed it again; one deploy covers 3b and
   4b). An older one answers `kind_not_generated` and the script stops on its
   first action.
3. Run the script, dry first; it prints the clips and the bill. Then a few,
   and look at them before the rest:

   ```sh
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-animations.ts --dry-run
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-animations.ts --stage 2 --limit 3
   ```

   A clip that came out wrong is fixed by deleting its `word_assets` row and
   running again. Two things only a real run can confirm, since nothing here
   reached a provider: that Google takes `durationSeconds` as a number, and
   that a first frame plus a last frame is accepted by Lite. Either
   refusal falls back to OpenRouter, which documents both.

**Done when** (5b): the Stage 1–2 action words have clips, and "say it"
shows them.

### The plan, as it was written

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

## Phase 6 — words in stories (built, PR #428; the run is 6b)

What shipped, so the later phases know what they stand on (writeups: README
"Reviewing as a quiz instead of flashcards", "The asset store" and "The
reading library"):

- **`kind: "story_line"` in the store** (`_shared/wordStoryLine.ts`):
  `payload` is `{ sentences: [first, second], story? }`, each sentence
  `{ arabic, english }`, exactly one using the word (`lineUsesWord`) and the
  word said nowhere else in the two, with a prefix (و, ب, ال, and ال
  contracted: للسوق, عالسوق) or a pronoun or plural ending (قهوتي, بيتين)
  included (`wordUseCount`, beside `lineUsesWord` in `wordDialogue.ts`, which
  now also holds `withoutProclitics`, the grader's rule, so both sides use one
  copy).
  `asStoredStoryLine` is the one reader. Style `text-1`, no bucket, filed with
  `putAsset`.
- **`word-asset ensure`** charges a learner's miss on `word-asset-dialogue`,
  then looks in the reading library (`findStoryPassage`, the source rule
  below; no model; filed as `reviewed`), and otherwise writes one through the
  same writer as an exchange (`writeText`, which `makeDialogue` now shares:
  `draft_critic`, `enforceDialect` and `validateDialect`, a quality gate, the
  leak scan with the rulebook's tokens, quotes stripped). `store_not_ready`,
  `ai_unconfigured` and `word_not_in_dialect` before anything is read or
  charged. The trusted path is charged nothing and may send `example`, as for
  an exchange; a story's passage is still taken first, and on the trusted
  path it takes the place of a written one.
- **The ladder**: step 10 "In a story" (`story-gap`) at production stability
  `LADDER_THRESHOLDS.storyDays` (60, double the reply's) and up; no passage →
  step 9 and what it falls back to; no microphone → `story-choice`, the same
  gap with four options; too few options → the flip card. `QUIZ_STEP_COUNT` is
  10, and the badge has ten dots.
- **`QuizStoryCard`**: the passage with the gap cut by `findPhraseSpan`
  (`src/lib/quizStory.ts`), the meaning named beside the spoken gap, the translation a tap
  away (help), the passage read with the word muted and whole after.
  `story-gap` scores the word against the word in the passage's locale, read
  through `singleWordSimilarity` (prefixes off, short words exact, and a take
  of more words than the item is not the word); `story-choice` offers "Why not
  this one?" on a wrong pick. The muted reading never starts once a take has.
  `QuizTakeResult` is the speak card's result panel, now shared.
- **`useMaskedSentenceAudio`**: the cloze card's muted reading, extracted so
  the two cards share one, with the dialect explicit; the cloze card now
  reads in the card's dialect rather than the learner's active one.
- **`QuizCardFrame` `storyLines`** (the curriculum deck and My Words): a
  fourth asset through `useCardAsset` (`STORY_LINE_LOOKUP_WAIT_MS`,
  `STORY_LINE_WRITING_WAIT_MS` = 12 s, "Finding a story for this word…"),
  asked for and waited for only where its question can be asked now; the
  fallback's exchange is read, never written.
- **`useEnsureWordAsset`** latches the daily allowance per counter, so a spent
  dialogue allowance pauses passages too, and the reverse.
- **"Why not this one?"**: `AskAISentence` takes `label` and `ask`;
  `openChat(seed, { ask })` holds the question as a one-shot `pendingAsk`,
  which `ChatTab` sends once as the learner's message (a fresh conversation
  for a new passage, the next message for the same one). It is never part of
  the seed, so neither the server nor History sees it there.
- **`scripts/curriculum-stories.ts`** (`--dialect`, `--stage`, `--limit` in
  passages filed, `--dry-run`), its core in `curriculum-stories-core.ts`,
  covered by `src/test/curriculumStories.test.ts`. It calls no function and no
  model and costs nothing; it needs the table, not a deploy. It also takes
  back a story passage its story no longer lends (`storyPassageStillLent`).
- Guards: `word_asset_test.ts` (17 story cases, and the "kind not generated"
  case moved to `jingle`), `wordStoryLine.test.ts` (the source rule and the
  search against the emulator, with the factories' real row shapes),
  `wordDialogue.test.ts`, `quizLadder.test.ts`, `quizGrading.test.ts`,
  `quizStory.test.ts`, `QuizStoryCard.test.tsx`, `QuizCardFrame.test.tsx`,
  `ReviewClozeCard.test.tsx`, `useMaskedSentenceAudio.test.ts`,
  `useEnsureWordAsset.test.ts`, `AskAISentence.test.tsx`,
  `AskAiPanel.test.tsx`, `QuizSessionSummary.test.tsx`,
  `curriculumStories.test.ts`, and `review.spec.ts` ("a word in a story").

**Decided in this phase** (each argued in the README):

1. *The source is `authentic_stories` / `authentic_story_lines`; there is no
   `reading_library`.* `reading_passages` is left out: the curriculum
   builder's approval never writes its `dialect`, so every row is "Gulf"
   whatever it is in, and its text has no per-sentence English.
2. *Only the dialect text*, `authentic_story_lines.dialect`: never `arabic`,
   `arabic_vocalized` or `body_fusha` (the MSA source), never `body_dialect`
   (it fills skipped lines with their fusha), and never a rendering that is
   its own fusha word for word.
3. *Published only*: `status = 'published'`, the one status the reader's RLS
   serves to anyone.
4. *Public domain and CC0 only.* CC-BY needs a credit wherever its text is
   shown and a quiz card filed in a public table carries none; CC-BY-SA also
   binds the adaptation, which a dialect rendering cut to two sentences is.
5. *The story's dialect exactly* (`storyDialect`): Levantine and MSA, which
   the story form offers and `normalizeDialect` reads as Gulf, lend nothing.
   And *the word's sense*: the gap sentence's English must name the key's
   sense (`englishNamesSense`), since the folding cannot tell homographs
   apart.
6. *The story's current rendering* (`inCurrentRendering`):
   `translate-story-dialect` keeps a skipped line's old rendering, so a story
   moved to another dialect can hold a line in the first one.
7. *Two sentences, never cutting the word's*: the word's sentence and the one
   before it, else the one after; a line is cut into sentences only where its
   English splits the same way; the shortest passage wins.
8. *A learner's miss charges the exchange's counter, before the search,
   found or written*: a written passage is the same cost class as an
   exchange, and a found one is a shelf search and a public row the
   allowance must bound (see below).
9. *The step-9 rule does not apply.* `REPLY_WORD_CLEAR` exists because a
   reply can be right in other words than the stored one; a take whose
   reference is the word itself has no such gap. Ordinary bands,
   `SPEECH_MATCH_FLOOR`, a different word is Again; `wordSpanSimilarity` reads
   the take, so the attached-prefix and short-word lessons hold.
10. *The meaning is named beside the spoken gap*: running speech fits more
    than one word, and a right other word would be scored as a different one.
    Not beside the four-option gap, which follows the cloze card's later steps:
    with four set options the meaning would turn the passage into a
    translation match.
11. *A device that cannot record gets the four-option gap*, the one choice on
    the production schedule, never better than Good; "rate it myself" still
    gives the flip card, as on every speaking step.

Two things found on the way and fixed in this phase: the cloze card's muted
reading used the learner's active dialect rather than the card's (a mixed
deck's Egyptian sentence read in a Gulf voice), and a Phase 4 frame test
whose loop left each pass's card mounted, so its later passes could find the
previous card's question.

An independent review before merge found four bugs, all fixed above. The
story search matched the Arabic only, so a homograph took another sense's
passage, filed as `reviewed` and so never replaced. A learner's miss searched
the whole shelf and filed a row before any cap, so an account could vary the
gloss to file rows and drive searches for free, even over its allowance (it
is charged first now). `لل` hid the word from the second-use rule. And the
take was read by its best stretch, so a learner naming three candidates was
heard saying the word. It also found a second "Why not this one?" on the same
passage was never asked (now the one-shot `pendingAsk`), a late reading that
could autoplay into a take, a title that could say the word, and docs that
claimed an unset licence was refused when the column defaults to
`public_domain`. Questions it raised for the owner are in 6b.

A second review, cold, before the merge, found five more, all fixed. The
second-use rule compared what a passage said with the word as stored, so a
word stored with its article (السوق, and the curriculum's الحساب, اليوم,
الصبح…) was not counted in للسوق, سوقنا or a bare سوق, and the muted reading
could say the answer in the other sentence; it now counts the word without
its article too, and through curly quotation marks. A sentence a conversion
left as its fusha, inside a line cut into sentences, could be the gap's (the
copy check compared whole lines); each sentence is checked now, and keeps its
place so its neighbours are never paired across it. The take-back check read
a story's first thousand lines only, so a passage cut past them was taken
back on every run; it pages now, as the search does. A written passage kept a
`story` the model might name. And a test that said it reopened the panel
did not. It also asked why the four-option gap does not name the meaning:
decision 10 is about the spoken gap, and the four-option one follows the
cloze card's later steps (said so above). It found the same second-use gap in
Phase 4's exchange, which was not fixed here: an opening line was checked with
`lineUsesWord` alone, so "رحنا للسوق؟" could open an exchange whose reply is
the word السوق (fixed in the follow-ups, below).

**Fixed after the merge** (the Phase 6 follow-ups), three things the reviews
left:

- *A story's title gave the answer away on the four-option gap* (Codex review
  finding 1 on #428). `story-choice` withholds the meaning, but `storyGap`
  checked the title for the Arabic word only, so a passage for السوق from "At
  the Market" named the answer above its choices. A title that names the
  meaning is dropped now too: the card's English folded as the key folds a
  sense, and each meaning a gloss lists, read by `englishNamesSense`. Guards:
  `quizStory.test.ts`, `QuizStoryCard.test.tsx`.
- *A written passage was not held to fourteen words* (Codex finding 2). The
  prompt and the critic asked for at most fourteen a sentence, but the gate
  and the filing check enforced only `MAX_STORY_SENTENCE_LENGTH` (200
  characters), so a longer passage could be filed for every learner of the
  word. The writer reads what it is given by `asWrittenStoryLine` now
  (`MAX_WRITTEN_SENTENCE_WORDS`, 14) in both the critic's gate and the check
  before filing; a passage taken from a story keeps the 200-character rule
  alone. Guards: `word_asset_test.ts`, `wordStoryLine.test.ts`.
- *A Phase 4 exchange could give the word away* (the second review's finding
  above). `asStoredDialogue` now refuses an opening line that says the word
  in any form (`wordUseCount(first, word) === 0`), and the critic and the
  prompt are told so. The browser had the same gap, fixed with the same rule:
  `findReplyLine` takes no reply whose line before says the word, and
  `buildReplyQuestion` and `countWrongReplies` offer and count no "wrong"
  reply that says it with a prefix or an ending. Guards:
  `wordDialogue.test.ts`, `quizDialogue.test.ts`, `QuizCardFrame.test.tsx`,
  `word_asset_test.ts`. No exchange had been filed (2b was still open:
  `word_assets` is not in the generated types), so none needed re-checking.
  A lesson's own dialogue had never been checked at all, bare repetition
  included, so this reaches the authored tracks too: of the 837 curriculum
  words, 322 were asked a reply from their lesson's dialogue and 304 are now
  (3 more move to a later line). The 18 are give-aways ("وش هذا؟" before "هذا
  تمر…", "وبعدها؟" before "بعدها رحت…", "الباب القديم؟" before a reply with
  قديم) bar one: هنا after "السوق هناك", which `wordUseCount`'s ending rule
  reads as هنا with ك. Each falls back to the word's exchange once 2b is
  applied, else the step below. The Phase 4 fixtures that opened on "وين
  السوق؟" before "السوق هناك" (`QuizCardFrame.test.tsx`, `review.spec.ts`)
  were that give-away and now open on another line.

### Phase 6b — owner action

1. Apply `20261009130000_word_assets.sql` (Phase 2b) if it is not on the live
   project yet. Until then no passage is taken, written or read, and the top
   step asks the reply.
2. Deploy `word-asset` (this phase changed it again, and so did its
   follow-ups; one deploy covers 3b, 4b and 5b's). An older one answers a
   passage `kind_not_generated`, uncharged, and the quiz asks the reply.
3. Run the script, dry first; it prints what each word would take, what the
   shelf lends, and why each story left out was. It costs nothing (no model,
   no function), so the real run is safe once the dry run reads right:

   ```sh
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-stories.ts --dry-run
   SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
     scripts/curriculum-stories.ts
   ```

   A passage that reads wrong is fixed by deleting its `word_assets` row; the
   next run takes the next-shortest, or the next learner's miss writes one.
   How many curriculum words the shelf covers is not knowable from here: the
   stories are in the live project, not the repo.

**Questions for the owner**, raised by the review and left as they are:

- *The licence label is trusted.* `license` defaults to `public_domain`, and
  the suggest-and-import flow writes it for the public-domain texts it
  imports. A story an editor imports by hand under CC-BY and leaves on the
  default lends as public domain. Either keep it (the editor's choice is the
  record), or have the form require a licence.
- *A word that skips step 9 never gets an exchange written*: one Good review
  can lift production stability from under 30 to over 60, and step 10 only
  reads the reply's exchange. When its passage cannot be had (a leak, a
  validator rejection), it is asked "say the line" until an exchange exists.
  Writing the exchange behind the fallback would charge a card twice.
- *A retry is graded*, on every speaking step: after a take the answer is on
  screen, and "Try again" grades the last take. Pre-existing; stronger here,
  since the word appears in the gap.
- *A story line's English translates the fusha*, not the rendering, so a
  sentence's English can be a little off its dialect text.
- *A hesitation in the take* ("اه قهوة") is a take of more words than the
  item, so it is a different word, Again. Whether Azure's recognised text
  keeps fillers in Arabic is not known from here; the result shows what was
  heard, and "Try again" is there. A filler list would need care: ايه is
  "yes" in Egyptian and could be the word.
- ~~*Phase 4's exchange can give the word away in its opening line* when the
  word is said there with a prefix (the second review's finding above).~~
  **Fixed in the follow-ups:** `asStoredDialogue` checks the opener with
  `wordUseCount(first, word) === 0`, and the quiz's reply steps hold the line
  said and every wrong reply to the same rule. No exchange had been filed
  (2b still open), so there was nothing to re-check.
- *`wordUseCount` can read another word as this one*, now that it guards the
  reply steps as well as passages. Its prefix and ending rules take كانت for
  إنت (ك off), واحد for أحد (و off), لبس for بس (ل off), هذاك for هذا and هناك
  for هنا (ك on), خمسين and عشرين for خمس and عشر (ين on); and, arguably the
  same word, يوم for اليوم and الأكل for آكل. It never gives an answer away,
  but it costs: a lesson's reply question lost (هنا, above), a wrong reply not
  offered, a passage refused; and in `word-asset` a written exchange or
  passage the rule refuses is a failed write, charged to the learner as any
  failed write is, until `useEnsureWordAsset` pauses the kind after two in a
  row. A short list of such pairs, or narrower ك and ين rules for short
  words, would close it; left as is, since the same rule grades a take
  (`withoutProclitics`) and a change belongs with its own tests.
- *A title is read by `englishNamesSense`, which is strict*, so an irregular
  form of the meaning still shows: "Men of the Desert" for "man", "What We
  Ate" for "eat", "Souk Al-Mubarakiya" for "souq" spelled "souk". Dropping a
  title costs only the title, so a looser rule (a table of irregular forms,
  a shared stem) would be cheap; left as the request asked, the story search's
  own rule.
- *An exchange is not held to its prompt's ten words either*, found while
  fixing the passage's fourteen: `dialoguePrompt` asks for at most ten words a
  line, and `asStoredDialogue` enforces only `MAX_DIALOGUE_LINE_LENGTH` (160
  characters). The same writer-only word count would close it, in the gate
  and before filing; not done in the follow-ups, which fixed only what the
  reviews named.

**Done when** (6b): a mature curriculum word is asked in a story in
production, from a published story's sentences where the shelf has one.

### The plan, as it was written

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

## Phase 7 — the rest of the game (built; the migration is 7b)

One PR per item, in this order, each independent of the asset store:

| item | status |
|---|---|
| 7.1 "Why not this one?" on every choice step | built (PR #430) |
| 7.2 The lightning round | built (PR #431) |
| 7.3 The boss card | built (PR #432) |
| 7.4 Ladder climbs on the leaderboard | built (PR #433); the migration is 7b |
| XP parity for the flip cards | **a question for the owner**, not built |

### 7.1 "Why not this one?" on every choice step (built, PR #430)

What shipped (writeup: README "Reviewing as a quiz instead of flashcards",
"Why not this one?" on every choice step):

- **`src/lib/quizWhyNot.ts`**: `whyNotQuestion`, moved out of
  `quizStory.ts` and keyed on the choice format, one question per family:
  a gap (cloze, cloze with the hint, the story's four options: "In this
  sentence / passage I put «X» in the gap…", the story's text unchanged); a
  meaning picked for the word, seen, heard or pictured ("I picked "house"
  (that's «بيت») for «سوق»…", "I heard «سوق» and picked…"); a word picked
  for a meaning; a reply picked for a line. `quizWhyNot.test.ts` holds every
  `QuizFormat` in a `Record`, so a new choice format with no question fails
  the typecheck and the test.
- **The cards**: `ReviewClozeCard`, `QuizChoiceCard` (meaning, listen) and
  `QuizOptionsCard` (picture, word, reply) offer the chip on a wrong pick, in
  place of "Ask AI", through `AskAISentence`'s `label` and `ask` as the story
  card does. The panel opens on the sentence, the word, the answer, or the
  line said (for a reply).
- **`QuizCardFrame`** hands over the half of the pair the learner never saw:
  a wrong picture option carries its word (unrendered), and `wordForMeaning`
  names the word a wrong meaning belongs to, or none when two different words
  share it.
- Found on the way, and fixed: the meaning questions dealt another gloss of
  the word itself as a wrong meaning (a mixed deck holding السوق as "the
  market" and as "the souq"), so a right pick was graded Again, and "Why not
  this one?" would have named the word as the other one. `englishPool` and
  `wordForMeaning` leave the word out in any spelling now.
- Guards: `quizWhyNot.test.ts`, `ReviewClozeCard.test.tsx`,
  `QuizChoiceCard.test.tsx`, `QuizOptionsCard.test.tsx`,
  `QuizCardFrame.test.tsx` ("why not this one?"), `QuizStoryCard.test.tsx`,
  and `review.spec.ts` ("a wrong pick in the gap asks the tutor why").

**Decided in this item:**

1. *A right pick keeps its plain "Ask AI"*, and the picture question still
   has none after a right pick: the chip replaces, it does not add.
2. *The meaning's word is named only when the deck is sure of it.* A
   meaning two different words share ("house": بيت, دار) names neither; the
   same word in two spellings is one word. A wrong guess would explain a
   mix-up the learner did not make.
3. *The chip sits under the options, as on the story card*, rather than on
   the picked option itself (the plan's "one tap on the picked option"): an
   option is a radio, and a second action on the same control would be easy
   to set off by tapping again to look.
4. *A tap is a tutor turn.* The "Ask AI" chip it replaces only opened the
   panel; this one asks, so each tap is an assistant-chat turn on the chat's
   own cap (a line in `docs/ai-spend-2026-10.md` §2 says so). Nothing is sent
   without a tap. No new route, no migration, and the pick is graded as
   before.

An independent review before the PR found the own-gloss bug above, and
three things in the docs (fixed). One thing it raised is left as it is: in a
mixed session the pool carries no dialect, so a wrong meaning can be named
by another dialect's word for it ("bread" as the Egyptian «عيش» under a Gulf
card, where عيش is rice). The word named is one the learner's deck holds for
that meaning, so the naming is not false, only perhaps not the mix-up they
made; carrying the dialect on `QuizPoolEntry` and naming only the card's own
dialect's word would close it. *Closed in the Phase 7 follow-ups (PR #435):
every pool entry carries its dialect, and `wordForMeaning` names only the
card's own.*

### 7.2 The lightning round (built, PR #431)

What shipped (writeup: README "Reviewing as a quiz instead of flashcards",
the lightning round):

- **`src/lib/lightningRound.ts`**, pure, the clock passed in:
  `lightningFormat` (which right answers are in the round and how each is
  asked), `storedRecording` and `lightningWordFor` (a session's answer as a
  word for the round), `addLightningWord` (once per word),
  `canOfferLightning` (`LIGHTNING_MIN_WORDS`, 3), and the round itself:
  `startLightning` (a seeded order), `answerLightning`, `nextLightning`,
  `expireLightning`, `lightningRemainingMs`, `lightningResult`
  (`LIGHTNING_SECONDS`, 60; `LIGHTNING_REVEAL_MS`, a beat after each answer).
- **`LightningRound`** on the end screen of all three quiz decks, under the
  summary: the offer, the round (a clock bar, "n / total", the score), and
  the result with "Play again" (a new order).
- **`bare`** on `ReviewClozeCard` and `QuizChoiceCard`, and `skip` on
  `useMaskedSentenceAudio`: nothing synthesised, nothing played by itself
  but a stored recording, no translation, sentence hint or tutor.
- **`QuizGraded` carries the `item`** the frame asked, so a page can keep
  the right answers without rebuilding the card.
- Guards: `lightningRound.test.ts`, `LightningRound.test.tsx` (fake timers:
  the minute, the reveal, nothing synthesised), `ReviewClozeCard.test.tsx`,
  `QuizChoiceCard.test.tsx` and `useMaskedSentenceAudio.test.ts` (bare /
  skip), `QuizCardFrame.test.tsx`, and `review.spec.ts` ("the lightning
  round": a session, the round, and no rating, XP or voice from it).

**Decided in this item:**

1. *"Today's" right answers are the session's*: the page's, kept as they
   are answered, like the summary. A round on My Words does not reach back
   into the curriculum session before it.
2. *Each word once, against the clock*; the round ends at the minute or at
   the last word, and the time is part of the result. Words are not dealt
   again to fill the minute, so a short session is a short round.
3. *Three questions, not four*: the gap, the word shown → its meaning (for
   the picture, too), and the word heard. The picture question is not asked
   again: dealing four pictures needs the frame's whole picture logic (one
   visual a word, no sense or action overlap, clips held still), and the
   word → meaning direction is the same question with the meanings as text.
4. *Nothing is synthesised.* A gap is read in silence; a word whose only
   voice was synthesised is shown. A round of fifteen gaps would otherwise
   be fifteen sentence readings (`docs/ai-spend-2026-10.md`: about $0.004
   a line) for a flourish.
5. *No XP*: "score and time only". A combo, a best score kept on the
   device, or XP for a round would each be a separate decision.
6. *Moves on by itself*: half a second after a right answer, 1.2 s after a
   wrong one. The clock runs on through the beat; the last answer stops it,
   and its beat still plays before the result.

An independent review before the PR found two medium problems, both fixed: the
round's meaning questions could offer another gloss of the word itself as a
wrong answer (the frame's guard, from 7.1, was not shared; it is now
`otherMeanings` in `quizDistractors.ts`, used by both), and keyboard focus fell
to the page on every question (it now follows the question, then the result).
And five low ones, fixed: the last answer's reveal was skipped, a replay could
deal the same order and the gap the same options, the "nothing written" checks
were one-shot (they now wait a second), My Words had no test of its wiring (an
e2e now plays a round there), and the clock and score lacked roles. Not
tested on its own: My Phrases' wiring, which is the same three lines. *Now
tested in the Phase 7 follow-ups (PR #435): `e2e/my-phrases.spec.ts`, the deck's
first e2e, plays a round there.*

### 7.3 The boss card (built, PR #432)

What shipped (writeup: README "Reviewing as a quiz instead of flashcards",
the boss card):

- **`src/lib/bossCard.ts`**, pure: `canBeBoss` (a recognition leech with
  lapses), `pickBoss` (the most lapses, the deck's order on a tie),
  `withBossFirst` (reorders, never adds or drops), `isBossTurn` (the
  session's first card, before any answer), `BOSS_MEMORY` (a first look).
- **The decks**: `useDueWords({ bossFirst })`, `useDueUserPhrases(mixAll,
  { bossFirst })` and My Words' due query put the boss first while the quiz
  is on and leeches are tracked; each page marks `QuizItem.boss` (lapses,
  mnemonic, the hook's picture) on its first card.
- **`QuizCardFrame`**: a boss is asked from `BOSS_MEMORY`, under
  `QuizBossBanner` (the hook and its picture behind one tap, which is help);
  `QuizGraded.step` is the card's own step; the leech rescue panel is placed
  by the frame (`leechPanel`), held back under the boss until the answer.
- **The pages** celebrate a win once the rating is on its way (`bossBeaten`):
  saved on My Words and My Phrases, queued on the curriculum deck.
- **`celebrations.ts`**: a `boss` kind, the small tier, "Boss beaten!".
- **`phraseDirection`** moved from `MyPhrasesReview` to `quizLadder.ts`, so
  the phrase deck's due list and its page read a phrase's direction one way.
- Guards: `bossCard.test.ts`, `QuizCardFrame.test.tsx` ("the boss card"),
  `useUserPhrases.test.ts` (new), `quizLadder.test.ts`,
  `celebrations.test.ts`, and `review.spec.ts` ("the boss card").

**Decided in this item:**

1. *Chosen from what is due, recognition only.* Nothing is reviewed early,
   and a first look grades the recognition schedule; a production leech is
   asked as itself.
2. *Graded as a first look*: Good when right, Hard when the hook was opened
   first, Again when wrong. The hook is a tap away rather than in view,
   because in view it would be the answer, and a Good earned off it would
   stretch the interval of exactly the card that needs an honest one.
3. *A leech settled past step 1 is still asked step 1*, as the plan says;
   after its lapses a leech is usually there anyway. Its own step is what
   the session tally sees.
4. *Once per session*, and *only while leeches are tracked*: a learner who
   switched leech tracking off has no leeches to fight.
5. *The small celebration*, on Continue: the session has the rest of its
   cards to go.
6. *The rescue panel waits for the boss's answer.* `LeechHelperPanel` prints
   the hook, so before the answer it would hand over what the banner keeps
   behind a tap (the e2e found this); after it, its tools (a new hook, its
   picture, clearing the leech flag) are there as for any leech.
7. *"The most lapses" is the word's, on either schedule*, as `is_leech` is
   flagged on either; the boss is still asked on the recognition side.

An independent review before the PR found a high one, fixed: the banner
showed the picture from the start, and where a boss falls back to "what does
it mean?" (any phrase, any word whose sentence lacks it) the picture was the
answer, graded Good. The picture now sits behind the hook's tap. And a medium
one, fixed: hiding the rescue panel under the boss hid its tools for good (no
way to make a hook for a boss that has none, or to clear the flag of one beaten
every time), and hid it on the flip-card fallback too; the frame now holds it
back only until the answer. Low ones fixed: "Boss beaten!" played before the
rating was saved (a failed save on My Words was still celebrated), the
ranking read recognition lapses alone while `is_leech` reads both, the
banner's copy said "toughest word" of a phrase, its tap had no
`aria-expanded` and what it revealed was not announced, and its colours were
a raw amber. A question it raised for the owner: a leech whose own step is
well past 1 is still asked a first look, as the plan says, and a right answer
there is Good; the hook stays hidden so that Good is earned, but the question
is easier than its step. Untested at unit level: `useDueWords({ bossFirst })`
and the pages' `isBossTurn` wiring (the e2e covers `/review`). *Closed in the
Phase 7 follow-ups (PR #435): `useReview.test.ts` covers the due list's boss,
the three pages ask one pure `bossFor`, and My Words and My Phrases each have a
boss e2e.*

A last review of the four Phase 7 PRs together, before merging, found one
more, high, in the fix above: with the rescue panel shown after the answer,
its "Not stuck — clear leech flag" patched the deck, the page stopped marking
the card a boss, and the answered card turned into its own step's question
(another wait, possibly a paid picture or exchange, and a second answer that
could replace the first rating; no celebration). Fixed: the frame latches the
boss for the card's presentation, as it latches the picture, reports the
latched boss with the rating, and takes a choice answer once. Also fixed: the
rescue panel waits beside a card still being prepared, as it did before (not
beside the boss), and the celebration's copy no longer says "word" of a
phrase.

### 7.4 Ladder climbs on the leaderboard (built, PR #433; the migration is 7b)

What shipped (writeup: README "Reviewing as a quiz instead of flashcards",
ladder climbs on the leaderboard):

- **Migration `20261010120000_leaderboard_climbs.sql`**:
  `quiz_ladder_step(stability, repetitions, direction)` (the ladder in SQL, an
  inlinable expression) and `leaderboard_climbs(_user_ids uuid[])`, a
  security-definer RPC that counts this UTC week's climbs in `review_log`
  (deck `word`; Hard, Good or Easy only; never a review stamped in the future;
  one per card, direction and day) for opted-in learners only, 100 a call.
- **`src/lib/ladderClimbs.ts`**: `isLadderClimb`, `climbWeekStart` and
  `countWeekClimbs`, the rule in TypeScript; the in-memory backend's
  `leaderboard_climbs` uses it.
- **`useLeaderboard`**: `readClimbs` (null on any failure),
  `useLeaderboardClimbs` (a query of its own, so the board never waits) and
  `climbsFor`; the weekly row shows "n climbs" under the XP, and the page's
  hint says what it counts.
- **`extractQueries`** (the contract inventory) sees a call through
  parentheses and casts, so `schemaContract` now catches a renamed
  `leaderboard_climbs` (and the other RPCs called through a cast).
- Guards: `ladderClimbs.test.ts`; `leaderboardClimbs.test.ts` (the SQL's
  thresholds held to `LADDER_THRESHOLDS`, and the rules the count rests on);
  `migrationReplay.test.ts` (the SQL step against `rungForMemory` on 120
  memory states, and the count on a seeded week, against Postgres in CI's
  replay job); `useLeaderboard.test.ts`; `schemaContract.test.ts`;
  `leaderboard.spec.ts` ("ladder climbs").

**Decided in this item:**

1. *Counted by the database from `review_log`, not posted by the client.* A
   climb comes from a schedule write, not a counter; and since a learner can
   write their own schedule rows (as they can call `award_xp`), the count
   bounds what that buys (see the migration). The cost is coverage: My Words
   and My Phrases are not in the log, so their climbs are not counted.
   Logging them is its own migration.
2. *Every curriculum review counts, flashcard or quiz*: the step is read off
   memory, so a word climbs the same whichever way it was asked.
3. *Beside XP, not instead*: the board still ranks by XP.
4. *No zeros before the migration*: a missing RPC hides the climbs, and the
   board never waits on them.
5. *The step before is inferred*: the log keeps repetitions after a review
   only. One fewer is exact for every review but a lapse and a learning
   card's Hard (which stays at 0, and is read so); lapses and unrated rows
   are left out.
6. *One climb per card, direction and day.* The session summary counts every
   promotion, so a card that climbs twice in a day counts twice there and
   once on the board; it is rare, and it is what keeps a row rewritten in a
   loop from buying a climb per write.

An independent review before the PR found no critical or high problems; its
checks in Postgres agreed with the code. Four medium ones, fixed: the step
function's `SET search_path` kept the planner from inlining it (5 s against
0.3 s on 300k rows) and the board waited on the count (it now has its own
query); climbs could be bought with future-stamped or looped schedule writes
(the bounds above; the docs had claimed nobody could post themselves a
number, which was too strong); `schemaContract` could not see the RPC call
through its cast (the inventory now looks through casts); and the SQL's
behaviour was not tested in CI (it is now, in the replay job). Low ones,
fixed: unrated rows counted, a non-finite stability stepped differently in SQL
and TypeScript, the docs called the week XP's (no migration resets
`xp_this_week`; `weekly_goals` is what follows the UTC week), and the board's
scope was only in a tooltip (it is in the page's hint now). Left as it is, and
older than this phase, for the owner: nothing in the repo resets
`user_xp.xp_this_week` (`award_xp` only adds to it), so unless a scheduled job
on the live project does, "XP this week" is not this week's, while climbs
are.

### Phase 7 follow-ups (PR #435)

What the four Phase 7 PRs left open, closed:

- **The boss, asked one way.** Each page built `QuizItem.boss` itself:
  `isBossTurn`, then the lapses and the hook again, and My Phrases without
  the relearn check (it has no relearn pass). `bossFor` in
  `src/lib/bossCard.ts` is now the one function, with its own tests;
  `QuizItem.boss` is its `BossInfo`.
- **The due list's boss** at unit level (`src/hooks/useReview.test.ts`,
  alongside Phase 9's queued-card tests): the leech with the most lapses on
  both schedules goes first, the rest in their order. It fails if the order
  reads one schedule's lapses only.
- **My Phrases' first e2e** (`e2e/my-phrases.spec.ts`): a due phrase asked
  for its meaning, rated and paid; the boss opening the session and beaten;
  the lightning round offered, played and writing nothing. My Words gains a
  boss e2e, with lapses on both schedules.
- **The dialect on the pool.** `QuizPoolEntry.dialect` is set by all three
  pools (the phrase pool now reads `dialect` too), and `wordForMeaning` names
  only a word of the card's own dialect, comparing without case. An entry or a
  card with no dialect is still named, as before.
- **The banner's hook.** The frame latched the whole boss for the card's
  presentation, so a hook made in the rescue panel after the answer showed in
  the panel but not the banner. It now latches only that the card is the boss
  and reads the hook live while the page still marks it.
- **Doc nits.** `QuizItem.boss` and `bossCard.ts` still said the picture was
  in view; it is behind the hook's tap since the review of 7.3.

A second agent, which had not seen the work, reviewed it and found nothing
high. Fixed from its review:

- *Medium:* the banner went back to the hook it was mounted with when the
  leech flag was cleared after a new hook was made (with the old hook's
  picture, which the panel had cleared). The frame now latches the last hook
  the page marked.
- *Medium:* rating a phrase invalidated My Phrases' due list, so the page's
  next card shifted under it once the refetch landed and a phrase was
  skipped until the end of the list. The rating now refreshes only the
  count, as My Words' does; the page refetches at the end of the list, and
  the e2e asserts the order. A second look found that this broke Undo,
  which refetched and then pointed its index into the server's list, without
  the phrases rated earlier: it now patches the session's list to the row it
  restored and lands on the phrase by id, refetching only when the phrase has
  left the list; an e2e undoes on My Phrases and checks it stays. Both decks
  also drop their due list on leaving the page, as `/review` does, so coming
  back never serves the list from before the visit's ratings.
- *Left as it is:* My Words' Undo refetches its list, as it always has, so
  the index it goes back to can point at another card once the refetch
  lands. The same fix was tried and taken back after review: a saved word's
  two directions are two cards with one id, and an Undo of a relearn rating
  must not rewind the list, so it needs the card's direction and the relearn
  pass in its undo record. That is its own change.
- *Low:* the pages' fallback pools (used when the pool read fails) carried no
  dialect; they do now. `wordForMeaning` compares dialects with
  `normalizeDialect`, as the reply question does. Two boss e2e asserted the
  banner gone while the celebration's dialog hid the page from the
  accessibility tree (the original on `/review` too); they now close it
  first. The saved pools gained mixed-dialect cases.

### 7b — owner action

Apply `20261010120000_leaderboard_climbs.sql` to the live project (ask Lovable
to run it, or `supabase db push`). It adds two functions and touches no table.
Until then the weekly board shows XP alone. Nothing is waiting on a types
regeneration (no column is added), and `typesDrift` has no entry for it.

**Done when** (7b): the weekly board in production shows climbs beside XP.

### XP parity for the flip cards — the owner's question

Not built. A graded quiz answer on My Words or My Phrases pays the flat review
XP and bumps the weekly review count; those decks' flip cards still pay
nothing, while the curriculum deck's flip cards pay. Paying the flip cards
would change existing behaviour (and the board's XP), so it waits on the
owner.

### The plan, as it was written

**Goal.** The flourishes designed in the plan and not yet built. Each is
independent of the asset store.

- **Lightning round**: after the session, a 60-second round over today's
  right answers at steps 1–4; score and time only, nothing written to any
  schedule. Reuses the question cards with a timer; `src/lib/lightningRound.ts`
  pure and tested.
- **Boss card**: the leech with the most lapses opens the session at step 1
  with its mnemonic and picture; clearing it is a `celebrate` tier.
- **Why not this one?**: on a wrong choice, one tap on the picked option
  asks the tutor why it does not fit (`AskAISentence` with the pair). Phase 6
  built it for the story's four-option gap (`label`, `ask`, `whyNotQuestion`
  in `src/lib/quizStory.ts`); what is left is the other choice steps.
- **Ladder climbs on the leaderboard**: a weekly count of promotions beside
  XP (`useLeaderboard`, the `leaderboard_profiles` view).
- **XP parity for the flip cards** on My Words and My Phrases: an open
  question for the owner, since it changes existing behaviour.

**Guards.** Unit tests per module, `routeReachability` if any new route,
e2e for the round.

---

## Phase 8 — tuning from real reviews (groundwork built, PR #436; the tuning is 8c)

**Goal.** The thresholds in `LADDER_THRESHOLDS` are a first guess. Once the
quiz has weeks of ratings, set them from the data.

**What shipped (the groundwork).**

- **Each curriculum rating records what it was asked as.** `QuizGraded`
  carries `askedStep` (the ladder's step for the memory the question was
  asked from: 1 for a boss) beside `format`. The page hands both to the queue
  (`QueuedRating.asked`), and `submitRatingToServer` writes them on the
  rating's own write as `word_reviews.last_quiz_format` and
  `last_quiz_step`, stamped `last_quiz_at` with the same moment as the
  `last_reviewed_at` it writes; nulls for a flip card and for a lesson's
  grade (`useSubmitReview`). Migration `20261010130000_quiz_rating_asked`
  adds those three columns, `review_log.quiz_format`, `quiz_step` and
  `repetitions_before`, and re-creates the log trigger (`log_word_review`,
  still `SECURITY DEFINER`) to copy the question beside the rating. It
  copies it only when `last_quiz_at` is the direction's new
  `last_reviewed_at`, so a write that moves the review without restamping
  the question (an older tab, a device that has stopped sending it) is
  logged with none rather than with the previous rating's; and only a
  format of lowercase words and a step from 1 to 10. The row is the
  learner's own to write; the log keeps nothing else from it, and stays
  trigger-written.
- **Repetitions before.** The report recomputes the step a card was asked
  at from its memory before the review. `repetitions_after - 1` (what the
  climbs count reads) is wrong for a lapse, which leaves repetitions as they
  were: a card missed on its first repetition would read as a first look. The
  trigger logs `OLD.repetitions` (or the production count) instead.
- **Why not `feature_metrics`.** The plan suggested the existing sink; the
  browser cannot write it (insert has been service-role only since
  `20260723000000`), and an edge function to take each rating would be a
  deploy. The log trigger was there already.
- **It cannot break a rating.** Until the owner applies the migration (8b),
  PostgREST refuses a write that names the new columns. `isMissingQuizColumn`
  recognises that refusal (PGRST204, or Postgres's 42703, naming
  `last_quiz_*`), the write is sent again without them, and the device stops
  sending them for a day (`markQuizColumnsMissing`, `src/lib/quizRatingFields.ts`)
  before trying again, so the fields start flowing on their own once the
  migration is applied. The six columns sit in `typesDrift` until a types
  regeneration carries them.
- **The report.** `src/lib/quizLadderReport.ts` (pure, tested on fixtures)
  and `npm run quiz:ladder-report` (`scripts/quiz-ladder-report.ts`, read-only,
  service role). It pages the log on its id until a page comes back empty,
  and refuses a redirect (the key goes to no other host). For each review
  with a question recorded it recomputes the step from the logged memory
  (`stability_before`, `repetitions_before`) and sorts it: on the ladder
  (that step, in its own format), a fallback (that step, another format, for
  want of material), or off it (another step: a boss, or a row logged under
  thresholds since changed); a format the quiz does not ask, or a step
  outside 1–10, is counted apart and nowhere else. It reports accuracy per
  step and per format as asked, and for each threshold the bands of
  stability above it in half-octaves.
- **What it takes to move a threshold.** At least 30 answers (`--min`) from
  at least 5 learners, each learner counted at most 50 times, so one keen
  learner cannot set a threshold for everyone. It *holds* when the band at
  the threshold has at least 10 answers, the step is answered right at the
  target (85%) from there up, and no band above is clearly under it (the top
  of its 95% Wilson interval below the target). It is *raised* to the lowest
  band that meets the same test, but only when the bands it is moved past
  are, pooled, clearly under the target. It *never settles* when the step's
  whole range is clearly under it. Anything else with enough answers is
  *unclear*: thin at the threshold, or under the target without being
  clearly so. Only answers on the ladder move a threshold.
- **What it cannot say.** Whether a threshold could come down: the ladder
  never asks a step's question below its threshold, so the log has no
  answers there. A threshold that holds from its first band may be higher
  than it needs to be; finding out would take an experiment that asks below
  it, which is a decision for later.
- **Scope.** The curriculum deck only: My Words and My Phrases are not in
  `review_log` (logging them is its own migration, and an owner question).
  `LADDER_THRESHOLDS` is unchanged.

**Tests.** `quizRatingFields` (the fields and their stamp, nulls, the
refusal, a day's pause); the queue writes them with the rating, stamped with
its `last_reviewed_at`, nulls for a flip card, and saves the rating without
them when the project refuses them, on an update and on a first rating's
insert (`useReviewQueue.test.ts`); a lesson's grade writes nulls and saves
without the columns (`useReview.test.ts`); the frame reports `askedStep`, 1
for a boss whose own step is 4; the report on fixtures (each verdict, a
lapse read from the repetitions it had, a question the app does not ask,
too few learners, the per-learner cap, a thin band at the threshold, a band
under the target but not clearly, Wilson's interval against published
values, bosses and fallbacks not moving a threshold, the bands, the text,
keyset paging past a short page, a read that does not move forward, the
arguments); the migration replay runs the trigger against Postgres (a quiz
rating, a flip rating, a production rating, a lapse's repetitions before, a
write that moves the review without restamping the question, and values
out of bounds); `reviewLog.test.ts` holds the trigger's latest definition to
`SECURITY DEFINER`; and the e2e `/review` answer writes `cloze-hint` at step
1 while a flip card writes nulls.

### Phase 8b — owner action

Apply `20261010130000_quiz_rating_asked.sql` to the live project (ask Lovable
to run it, or `supabase db push`). It adds three nullable columns to
`word_reviews` and three to `review_log`, and replaces `log_word_review` with
the same trigger plus the copy. Then let the types regenerate and delete the
six `typesDrift` entries. Until then ratings save as before and the log
records no question.

**Done when** (8b): a quiz rating in production leaves a `review_log` row
with `quiz_format` set.

### Phase 8c — owner action

After a month of ratings with the columns live:
`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run quiz:ladder-report -- --since <the day 8b went live>`.
Move each threshold the report raises, leave the ones that hold (and the
unclear ones, until more answers decide them), and note in the README table
that the numbers now come from the data. Moving one touches three things:

- `LADDER_THRESHOLDS` in `src/lib/quizLadder.ts`.
- The ladder in SQL: a new migration re-creating `quiz_ladder_step` (first
  defined in `20261010120000_leaderboard_climbs`) with the same numbers,
  which is itself an owner action to apply. `leaderboardClimbs.test.ts`
  holds the latest definition to the TypeScript, so CI fails until both move.
- `pictureDays` is also when a word's production card is first served
  (`holdsProduction`) and when a saved phrase is asked to be said
  (`phraseDirection`); raising it holds both back. Decide that with it.

Rows logged under the old thresholds then read as off the ladder, so the
next report is run `--since` the day the new ones went live.

**Done when** (Phase 8). The thresholds have been set from at least a month
of ratings and the README table says so.

### The plan, as it was written

A script over `review_log` (which records every curriculum and set-phrase
rating with stability before and after) reporting accuracy per step and per
format, and the stability at which each step's accuracy settles; move the
thresholds to where the next step's accuracy would be about 85%. Add the
format to what the page records (a `review_log.detail` jsonb, or the existing
`featureMetrics` sink) so the report can tell a gap from a picture.

---

## Phase 9 — housekeeping (built, PR #434)

| item | status |
|---|---|
| Delete `ReviewQuizCard` and `ReviewImageQuizCard` | done |
| Delete the stale per-rating `REVIEW_XP` map in `src/config.ts` | done |
| Remove `useTranscriptCloze`'s flip-card branch | nothing left to remove |
| The end-of-queue refetch race | fixed, with a backoff bug found on the way |
| A pass that schedules a card due at once | **found; the owner's question**, not changed |

**What shipped.**

- `ReviewQuizCard` and `ReviewImageQuizCard` are gone with their four test
  files (two in `src/components/review/`, two in `src/test/`). Nothing else
  imported them, and the hooks they named (`useAudioPlayer`, `useAzureTTS`)
  are still named by other tests, so `hookCoverage` holds.
- `src/config.ts` no longer carries the per-rating `REVIEW_XP` map (5 / 10 /
  15 / 20). Nothing imported it; the flat `REVIEW_XP = 15` in
  `useGamification` is the live one, and the reason it is flat is written
  there.
- `useTranscriptCloze` has no flip-card branch left: My Words only runs the
  lookup when the quiz is on (`enabled: quiz && …`).
- **The end-of-queue refetch.** On the curriculum deck the last rating went
  into the queue, and the page refetched at once and showed card 0 of the old
  list while it did. The server, not yet holding the last ratings, could send
  the same cards back, so the session served one it had just rated, and in
  flip mode the rating keys could rate it again. Now:
  - `useDueWords` leaves out any card whose rating is still queued, reading
    the queue before and after its fetch (`withoutQueued` in
    `src/lib/reviewQueue.ts`, keyed on the word and the schedule), on every
    refetch, "Try again" included. A rating hides its card for a day at most
    (`QUEUED_HIDES_CARD_MS`), so a queue that cannot drain does not hide its
    cards for good.
  - The new-card cap: a queued first rating is taken off the budget before the
    ordering (`claimsNewCard`), and a saved one now refreshes the budget
    (`daily-new-card-count`). Before, the curriculum path never refreshed it,
    so every end-of-list refetch could offer the whole day's cap again.
  - `Review.tsx`'s `closeList` marks the walked list spent at once, so it is
    never shown again and the keys have nothing to rate. A ref guards it
    against running twice, and a generation counter keeps a fetch for a deck
    switched away from (Mix All) out of the new one. "Checking for more
    cards…" shows for up to `LIST_WAIT_MS` (4 s, after the panel's own 600 ms
    delay); past that, with the fetch still out, a quiet "Still checking for
    more cards" with a way home, and no celebration, summary or lightning
    round until the answer lands. Offline, React Query holds the fetch until
    the connection is back.
  - Leaving the page drops the due-words cache, so coming back within its
    five minutes does not serve the list from before this visit's ratings
    (offline, it would join that list's paused fetch). Coming back offline
    says "You're offline" until the deck can load: a first fetch paused
    offline is not `isLoading` to React Query, and the page used to read it
    as an empty deck, saying nothing was due or forwarding to another deck.
  - Left as they are, from the review: while ratings are queued the due
    counts (the dock badge, the next deck's "N cards") still count by the
    server's schedule, so they can offer a few cards the list then leaves
    out; and a new card whose first rating has waited in the queue a day is
    served again, and a second first rating fails as a duplicate when the
    queue drains ("One rating couldn't be saved").
  - The unused `goToNext` went with it; it had the same unguarded refetch.
  - My Words and My Phrases save each rating before they move on, so they
    never had the race.
  - A first version waited for the queue to save (`settle`) before refetching.
    The review found it could hang (a refetch paused offline, a request that
    never answers) and, on a failed refetch, patched the cache back over the
    error screen; leaving queued cards out of the list needs no wait at all.
- **Found on the way: the backoff was not guaranteed.** `flush` depended on
  the mutation hooks, which return a new object every render, so every render
  re-ran the drain-on-mount effect. Its cleanup cancelled the pending backoff
  timer and its body called `flush` again, so how soon a failing write was
  retried depended on when the hook re-rendered, not on the backoff (under the
  test clock, hundreds of attempts in two seconds). The drain now reads them
  through a ref, `flush` keeps one identity per user, and "waits out the
  backoff between attempts" holds the attempts to the schedule (it times out
  with the old dependencies).

**Tests.** `withoutQueued`, `ratingsHidingCards` and `claimsNewCard` in
`src/lib/reviewQueue.test.ts`; the backoff and the budget refresh in
`src/hooks/useReviewQueue.test.ts`; in `src/hooks/useReview.test.ts`, the
queued-card exclusion (a rating given while the fetch is out, and one that
lands while it is out), the day's limit on it, and the cap; and five e2e in
`review.spec.ts`, the two below plus "a slow answer at the end of the list is
not the end of the session until it lands", "a card rated before leaving the
page is not served on the way back" and "coming back offline says so, rather
than that nothing is due". "never serves the card just rated while
its rating waits to be saved" fails the write and slows the deck, and expects
"Checking for more cards…", no card, the summary, and the rating saved once
the connection is back. "the keys do nothing once the last card is rated"
presses reveal-and-rate twice and expects one write. Both fail against the
old page.

**The owner's question: a pass that is due at once.** `calculateNextReview`
sets a recalled card's interval (Hard on a graduated card, Good or Easy) to
`Math.round(newStability * intervalFactor)` before the "sub-day intervals keep
minute precision" step, so a stability under half a day rounds to 0, and the
card is due the moment it is rated. It happens to a Good minutes after a lapse
(stability 0.25 in the e2e "asked afresh"), and the card is served again at
the end of the list. Two ways to
fix it, and it is the scheduler, so it waits for a decision:

1. Keep the sub-day value when the rounding would give 0 (only those cards
   change).
2. Drop the rounding there and let the step below round day+ intervals, as its
   comment says. That also moves stabilities between 0.5 and 1 day from a
   1-day interval to 12–24 hours.

### The list, as it was written

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
