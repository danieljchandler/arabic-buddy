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
  word said nowhere else in the two, an attached و/ب/ال included
  (`wordUseCount`, beside `lineUsesWord` in `wordDialogue.ts`, which now also
  holds `withoutProclitics`, the grader's rule, so both sides use one copy).
  `asStoredStoryLine` is the one reader. Style `text-1`, no bucket, filed with
  `putAsset`.
- **`word-asset ensure`** looks for it in the reading library first
  (`findStoryPassage`, the source rule below): no model, nobody charged, filed
  as `reviewed`. Otherwise it writes one through the same writer as an
  exchange (`writeText`, which `makeDialogue` now shares: `draft_critic`,
  `enforceDialect` and `validateDialect`, a quality gate, the leak scan with
  the rulebook's tokens, quotes stripped), charged on `word-asset-dialogue`.
  `store_not_ready` before anything is read or charged; `word_not_in_dialect`
  before the search. The trusted path may send `example`, as for an exchange;
  a story's passage is still taken first, and on the trusted path it takes the
  place of a written one.
- **The ladder**: step 10 "In a story" (`story-gap`) at production stability
  `LADDER_THRESHOLDS.storyDays` (60, double the reply's) and up; no passage →
  step 9 and what it falls back to; no microphone → `story-choice`, the same
  gap with four options; too few options → the flip card. `QUIZ_STEP_COUNT` is
  10, and the badge has ten dots.
- **`QuizStoryCard`**: the passage with the gap cut by `findPhraseSpan`
  (`src/lib/quizStory.ts`), the meaning named beside it, the translation a tap
  away (help), the passage read with the word muted and whole after.
  `story-gap` scores the word against the word in the passage's locale, read
  through `wordSpanSimilarity`; `story-choice` offers "Why not this one?" on a
  wrong pick. `QuizTakeResult` is the speak card's result panel, now shared.
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
- **"Why not this one?"**: `AskAISentence` takes `label` and `ask`; the seed's
  `ask` is sent once by `ChatTab` as the learner's first message, and the
  server is sent only `{ arabic, english }` as the seed.
- **`scripts/curriculum-stories.ts`** (`--dialect`, `--stage`, `--limit` in
  passages filed, `--dry-run`), its core in `curriculum-stories-core.ts`,
  covered by `src/test/curriculumStories.test.ts`. It calls no function and no
  model and costs nothing; it needs the table, not a deploy.
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
6. *The story's current rendering* (`inCurrentRendering`):
   `translate-story-dialect` keeps a skipped line's old rendering, so a story
   moved to another dialect can hold a line in the first one.
7. *Two sentences, never cutting the word's*: the word's sentence and the one
   before it, else the one after; a line is cut into sentences only where its
   English splits the same way; the shortest passage wins.
8. *A written passage charges the exchange's counter*: the same cost class,
   and no new daily text allowance for a step reached after two months.
9. *The step-9 rule does not apply.* `REPLY_WORD_CLEAR` exists because a
   reply can be right in other words than the stored one; a take whose
   reference is the word itself has no such gap. Ordinary bands,
   `SPEECH_MATCH_FLOOR`, a different word is Again; `wordSpanSimilarity` reads
   the take, so the attached-prefix and short-word lessons hold.
10. *The meaning is named beside the gap*: running speech fits more than one
    word, and a right other word would be scored as a different one.
11. *A device that cannot record gets the four-option gap*, the one choice on
    the production schedule, never better than Good; "rate it myself" still
    gives the flip card, as on every speaking step.

Two things found on the way and fixed in this phase: the cloze card's muted
reading used the learner's active dialect rather than the card's (a mixed
deck's Egyptian sentence read in a Gulf voice), and a Phase 4 frame test
whose loop left each pass's card mounted, so its later passes could find the
previous card's question.

### Phase 6b — owner action

1. Apply `20261009130000_word_assets.sql` (Phase 2b) if it is not on the live
   project yet. Until then no passage is taken, written or read, and the top
   step asks the reply.
2. Deploy `word-asset` (this phase changed it again; one deploy covers 3b, 4b
   and 5b's). An older one answers a passage `kind_not_generated`, uncharged,
   and the quiz asks the reply.
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
