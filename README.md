# Hikaya — Learn Spoken Arabic

Hikaya is a web app for learning **spoken (dialectal) Arabic** — Gulf (Khaliji),
Egyptian, and Yemeni — with native audio, spaced-repetition flashcards, and
lessons built from real Arabic media. The emphasis throughout is on authentic
dialect, never Modern Standard Arabic (MSA / فصحى).

## Tech stack

- **Frontend:** Vite + React + TypeScript, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (Postgres + Row-Level Security, Auth, Edge Functions)
- **AI:** dialect-aware generation orchestrated through a shared "Brain"
  (`supabase/functions/_shared/aiBrain.ts`) that layers dialect identity, an
  MSA-leak detector, a repair pass, and an optional native-speaker validator on
  top of the underlying models. Model IDs are centralized in
  `supabase/functions/_shared/modelRegistry.ts` — do not hardcode them in
  feature code — and `supabase/functions/_shared/aiGateway.ts` decides which
  provider serves each of them: Gemini via Google's API (`GEMINI_API_KEY`), GPT
  via OpenAI (`OPENAI_API_KEY`), everything else via OpenRouter
  (`OPENROUTER_API_KEY`), which also stands in for any vendor whose own key is
  missing or whose API rejects the call. Nothing goes through a hosting
  provider's gateway.
- **Learner model:** generated content is conditioned on what each learner
  actually knows. `supabase/functions/_shared/learnerProfile.ts` assembles their
  known / in-progress / weak vocabulary from real SRS state across both decks,
  plus CEFR placement and stated interests, and generators pass it to `askBrain`
  as `systemPromptExtra`. Its pure half (`learnerProfileCore.ts`) is unit-tested
  from the Vitest suite. Never send a client-supplied "words the user knows"
  list — build it server-side.
- **Assistant context:** what the Ask AI tutor can see, in five layers. Pages
  publish structured context via `usePageAiContext` — the line in focus, the
  *whole* document it sits in (transcript, article, passage), editorial
  metadata, and the learner's position — budgeted by
  `_shared/pageContextCore.ts`, which windows a long document around the
  focused line rather than truncating it. On top of that: semantic retrieval
  over `content_embeddings` (`_shared/contentRetrieval.ts`), three tools the
  tutor can call (`_shared/assistantTools.ts` — read the source article, search
  the library, check a word's review history), a timestamped record of what is
  on screen (`_shared/visualTimelineCore.ts`), and notes carried between
  sessions (`_shared/learnerMemory.ts`). See "Assistant context" below.
- **Grammar mastery:** the learner model also carries *structural* weakness, not
  just lexical — see "Grammar mastery" below.

## Local development

Requires Node.js (or Bun) and the Supabase CLI for the backend.

```sh
# Install dependencies
npm install          # or: bun install

# Start the dev server
npm run dev
```

Copy `.env.example` to `.env` and fill in the client variables
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Server-side secrets for
the edge functions are configured in the Supabase dashboard, not committed.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the codebase |
| `npm test` | Run the Vitest suite |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Run the Playwright end-to-end suite |
| `npm run test:e2e:ui` | Run the E2E suite in Playwright's UI mode |
| `npm run lint:ratchet` | Fail only if lint errors increased (what CI runs) |
| `npm run check:edge` | Typecheck the Deno edge functions (needs `deno` installed) |
| `npm run curriculum:check` | Validate `curriculum/tracks/` against the syllabus and the MSA-leak detector |
| `npm run curriculum:seed` | Regenerate the curriculum seed migration from `curriculum/tracks/` |
| `npm run curriculum:video-needs` | Regenerate the per-dialect video shopping lists in `curriculum/video-needs/` |

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request,
in jobs split so a failure names its own kind:

- **Typecheck, lint & unit tests** — `tsc` over `src/`, the lint ratchet, Vitest,
  and the production build.
- **Typecheck edge functions (Deno)** — `deno check` over
  `supabase/functions/**`. See below.
- **Migration replay** — every migration against a stock `postgres:16`.
- **End-to-end** — Playwright. A failed run uploads its HTML report as an
  artifact.
- **Deploy edge functions** — on `main` only, after the first two pass. See
  below.

**Edge functions deploy from CI, because merging is not deploying.** They do not
ship with the app: a merge changed the repository and left production serving
the previous copy, which is the worst kind of difference because it is
invisible. The code says one thing, the running system does another, and every
symptom debugged in between belongs to code nobody is looking at. That is not
hypothetical — it cost several rounds of chasing a transcription bug that had
already been fixed, twice.

Redeploying all 119 functions on every merge is the blunt version, and slow
enough that someone eventually turns it off. So
`scripts/edge-functions-to-deploy.mjs` works out the smallest correct set from
the push's own diff: a change under `supabase/functions/<name>/` deploys that
function, and a change under `_shared/` deploys every function whose imports
*reach* it, followed transitively — a module three hops down is still bundled
into whatever imports it, and missing that is exactly how a function gets left
behind. `_test/` changes deploy nothing. `src/test/edgeDeployTargets.test.ts`
covers the resolver, including against the real functions tree, so a regex that
quietly stopped matching fails the suite rather than shipping an empty deploy.

Deploying needs one secret, `SUPABASE_ACCESS_TOKEN`, added under **Settings >
Secrets and variables > Actions** from a token minted at
<https://supabase.com/dashboard/account/tokens>. **A project managed by Lovable
Cloud does not give you one** — the project is not in an account you can mint
tokens for — so without the secret the job *skips* rather than failing, warning
which functions were left on their previous version. A permanently red `main`
would be worse than no check: it trains everyone to ignore the one signal that
matters. Set the secret and the job takes over. The project ref is read from
`supabase/config.toml` rather than duplicated as a second secret. To deploy by
hand — after changing a secret, say, when no code changed — run the workflow
from the Actions tab: leave the input blank for the last commit's functions,
name specific ones space-separated, or pass `all`.

**When you cannot deploy from CI, the app says so instead.**
`supabase/functions/_shared/edgeBuild.ts` holds one `EDGE_BUILD` marker that
both halves compile in. The deployed function reports it — `{ probe: true }` to
`process-approved-video`, answered before it reads any other argument — and
`EdgeBuildBanner` on the Manage Videos pages compares that against the value in
the frontend bundle, which *does* redeploy on merge. When they differ, a content
manager sees a banner naming both builds, with the deploy request to paste. That
is the check that ends the failure mode this all came from: a fix that had
already landed looking like it did nothing, for three rounds, because the
backend was still serving the previous copy. **Bump `EDGE_BUILD` whenever an
edge function changes in a way worth telling apart in production** — leaving it
alone is what makes the check quietly stop working.

**The edge functions need their own typecheck.** They are Deno, they import over
`https://`, and `tsc` cannot resolve those specifiers — so `tsconfig.app.json`
covers `src/` and the shared modules the Vitest suite imports, but never the
functions themselves. That left roughly 15k lines with no typechecker at all.
Adding `deno check` found eight real defects in its first three runs, including
a `corsHeaders` reference from a scope that did not contain it (every response
from `dialect-violations-digest` threw a `ReferenceError`, success path
included), a `fallback()` call missing the argument that carries CORS headers,
and an unguarded `analyzeData.result` dereference in the transcription pipeline.

Unlike lint, this one is a clean gate rather than a ratchet: the whole directory
passes today, so there is no debt to tolerate. The Deno version in the workflow
is pinned exactly — `deno check` bundles its own TypeScript, so a Deno release
can turn the job red with no repo change, and that is how a check stops being
trusted. Bump it deliberately.

**Lint is a ratchet, not a clean-lint gate.** The repo carries a few hundred
pre-existing errors — almost all `no-explicit-any` — so requiring zero would
make every build red and train everyone to ignore CI. `scripts/lint-ratchet.mjs`
fails only when the error count goes *up*, and prints the new number to use when
you bring it down. Lower `BASELINE` in that file in the same commit that reduces
it.

### End-to-end tests

`e2e/` runs the real app in a browser. It needs **no Supabase credentials**:
`playwright.config.ts` points the dev server at a fake Supabase host, and
`e2e/support/supabase.ts` seeds an auth session into `localStorage` and answers
every request from fixtures. The suite is hermetic — no network, no shared
state — so it verifies the app's own routing and rendering rather than that
queries match the production schema.

## Curriculum

Stages and lessons live in `curriculum_stages` / `lessons` and are walked by the
learner at `/curriculum` (`src/pages/Curriculum.tsx`), with progress in
`lesson_progress`. The path state — which lesson is "next up", completion
percentages, best-score merging — is pure and tested in `src/lib/lessonPath.ts`.

Gating is deliberately **soft**: `lessons.unlock_condition` is free text imported
from a spreadsheet, not a machine-readable rule, so it's shown as guidance while
exactly one lesson is marked "Next up" and anything can be opened.

### What reaches the review deck

Curriculum cards are **opt-in**. `/review` used to build its deck from every
`vocabulary_words` row in the active dialect, so signing up was enough to have
the whole authored curriculum — stages nobody had opened included — queued for
spaced repetition, in the same session as the words the learner had collected
themselves (mined from a clip, saved from a translation, added by hand). The
daily task counted the two together, so "Review 3 words" opened onto a deck of
curriculum cards with the learner's own three somewhere behind them.

Two things now count as asking for a curriculum word, and `useDueWords` admits
nothing else (the decision is pure and tested in `src/lib/curriculumDeck.ts`):

- **Studying it.** Opening a lesson writes `lesson_progress`, answering its quiz
  writes `word_reviews` — either admits the word. This is the ordinary path and
  has no setting attached. Legacy topic-backed words have no `lesson_progress`
  row to be started by, so they arrive only once reviewed.
- **Asking for the lot.** Settings → Review Preferences → "Review the whole
  curriculum" (`useCurriculumDeckScope`, off by default) restores the old
  behaviour for learners who want the curriculum as one big deck.

A word that already carries a `word_reviews` row is always kept, whatever the
setting: that row is a live FSRS schedule, and dropping it would lose the
learner's history with the word rather than merely decline to add a card.

Note what did *not* change: `useReviewStats`' `dueCount` — the dock badge, the
chooser's "N cards ready now", the daily flashcards task — has always counted
review rows, so it only ever counted studied words. The badge was right and the
deck was wrong; they agree now.

Lesson plans imported from `.xlsx` (`src/lib/parseLessonXlsx.ts` →
`useLessonImport`) persist their authored sections. `sound_spotlight`,
`lesson_sequence` and `real_world_prompts` are rendered to the learner in
`src/pages/Learn.tsx`; `image_scenes`, `flashcard_spec` and `design_rationale`
are stored as authoring metadata and have no learner-facing surface. Every
section renders nothing when empty, so lessons imported before this was wired up
are unaffected.

### Saving a rating, and the end of the list

A curriculum card's rating goes through an offline queue (`useReviewQueue`,
stored in localStorage by `src/lib/reviewQueue.ts`), so the page moves on
before the server has answered. A network error is retried on a backoff (1 s,
2 s, 5 s, 15 s, 60 s); a write the server rejects is dropped with a toast, so
it cannot wedge the ratings behind it. My Words and My Phrases save each rating
before moving on and have no queue. Three things this must keep:

- **A card whose rating is still queued is not due.** Until the queue saves it,
  the server holds the card's old schedule and calls it due, so `useDueWords`
  reads the queue before and after its fetch and leaves such a card out
  (`withoutQueued`), on the schedule the rating is for. Every refetch gets this,
  "Try again" on a failed one included, however slow or absent the connection.
  For a day at most (`QUEUED_HIDES_CARD_MS`): a queue that cannot drain does not
  hide its cards for good. A queued first rating is counted against today's
  new-card cap before the server counts it (`claimsNewCard`), and a saved one
  refreshes the budget, so an end-of-list refetch does not offer the whole cap
  again.
- **The walked list is spent at the end.** When the last card is rated the page
  asks what is due next. It used to show the walked list's first card while the
  refetch was out, and the server, not yet holding the last ratings, could send
  the same cards back, so the session served a card it had just rated (and the
  rating keys, still live, could rate it again). Now the list is marked spent at
  once and never shown again (`closeList` in `Review.tsx`), and the keys have
  nothing to rate. "Checking for more cards…" shows for up to 4 s
  (`LIST_WAIT_MS`); past that, with the fetch still out, a quiet "Still checking"
  with a way home, and no celebration or summary until the answer lands (the
  end of the session, or more cards). Offline, React Query holds the fetch until
  the connection is back. Leaving the page drops the deck it built, so coming
  back never serves the list from before this visit's ratings; coming back
  offline says "You're offline" until the deck can load, rather than that
  nothing is due (a first fetch paused offline is not, to React Query,
  loading).
- **`flush` keeps one identity per user.** The mutation hooks it calls return a
  new object every render. While they were its dependencies, every render re-ran
  the drain-on-mount effect, whose cleanup cancelled the pending backoff and
  whose body called `flush` again, so how soon a failing write was retried
  depended on when the hook re-rendered, not on the backoff (under the test
  clock, hundreds of attempts in two seconds). The drain now reads them through
  a ref, and a test holds the attempts to the backoff.

### Reviewing as a quiz instead of flashcards

Settings → Review Preferences → **How you review** (and the same switch in
every review page's header) chooses between the flip card and the quiz. The
choice lives on `profiles.review_style` so it follows the learner across
devices, with a device-local cache under it (`src/lib/reviewStyle.ts`,
`useReviewStyle`) so no page flashes the wrong style while the profile loads;
until the migration that adds the column is applied to the live project the
cache is the whole preference, and the profile write fails quietly.

The quiz serves the same due cards from the same two schedules — recognition
and production, exactly as the flashcards do — and changes only the question
and who grades it. The question is read off the card's memory state by the
ladder in `src/lib/quizLadder.ts`:

| step | when (recognition stability unless stated) | question |
|---|---|---|
| 1 First look | new, or under a day (just lapsed) | the authored or saved sentence with the word blanked, four Arabic options, the meaning shown as a hint |
| 2 Fill the gap | under 4 days | the same gap, no hint |
| 3 Pick the picture | under 8 days | the word, seen and heard → four pictures (an action word's clip among them, where it has one) |
| 4 Hear it | under 16 days | the word's audio alone → pick the meaning |
| 5 Pick the word | under 30 days | the picture (or the meaning) → four Arabic words, each with its recording |
| 6 Answer the line | 30 days and up | a line of dialogue (the lesson's, else the word's stored exchange), said aloud → pick the reply that uses the word |
| 7 Say it | production card, under 14 days | the picture alone — an action word's clip, where it has one — or the meaning → say the word; scored |
| 8 Say the line | production card, 14 to 30 days | the English line → say the Arabic sentence; scored |
| 9 Say the reply | production card, 30 to 60 days | a line of dialogue, said aloud, and the reply's meaning → say the reply; scored, the word required |
| 10 In a story | production card, 60 days and up | two sentences of a story, shown and read aloud with the word muted, and the word's meaning → say the word; scored |

The climb within recognition goes from form to meaning (the gap, the picture,
the audio) to meaning to form (pick the word) to use (answer the line);
production goes from the word to the line to the line said back in a
conversation, and at the top to the word heard in someone else's sentences,
at speed, and said into its place. The reply steps are built from a dialogue (`src/lib/quizDialogue.ts`):
the reply is the first line that uses the word whose line before does not say
it, the prompt is that line before, and on step 6 the wrong replies are the
dialogue's other lines, topped up from the other lessons in the deck and from
the other words' stored replies. Neither the prompt nor a wrong reply may say
the word in any form `wordUseCount` counts, a prefix or an ending attached
included: "رحنا للسوق؟" before a reply with السوق hands over the answer, and a
"wrong" reply with للسوق in it is not wrong.
The lesson's authored dialogue (`lessons.dialogue`) comes first; a word it
never uses is asked from its exchange in the shared store (below). A
translation of what was said, or the meaning behind a picture, is a tap away
and counts as help.

The decks unlock production on the first Good and serve the production card
the moment it is due — in the same session, for the flashcards. The quiz
holds it until the word's recognition stability reaches the picture step
(`holdsProduction`), so "say it" follows the earlier steps rather than
arriving on the refetch after the first right answer; the production schedule
itself is untouched, the card waits.

A card without the material for its step falls back a question (no sentence →
ask the meaning; no picture, or too few other pictures → hear it; no dialogue →
pick the word, or on the production side say the line (and with no sentence
either, the word); no story passage → say the reply, and so on down; too few
other words for four options, or a device that cannot record → the ordinary
flip card with its rating buttons), so the ladder never refuses to serve a
card. The top step is the one production step with a choice below it: a
device that cannot record is asked the story's gap with four options, which is
never better than Good, rather than handed the flip card, whose buttons go up
to Easy.

**An exchange for a word its lesson has none for.** Steps 6 and 9 need a line
that uses the word, and only some words appear in their lesson's dialogue —
none of a learner's saved words do. So the frame (`storedDialogues`, set by the
curriculum deck and My Words) looks the word's exchange up in the shared store:
two lines, someone says something and the reply uses the word, made once per
word, sense and dialect and kept for every learner after (`kind: "dialogue"`,
"The asset store" below). A word with none has one written: `useEnsureWordAsset`
asks `word-asset`'s `ensure`, which writes it through the Brain from the word,
its sense and its dialect alone — never the sentence a word was saved from,
which is the learner's own text — and charges this learner's daily dialogue
allowance, a counter of its own (a stored one costs nothing). Unlike a
picture, an exchange needs no row of the learner's to land on, so the
curriculum deck may ask for one too; the curriculum's whole catalogue of
exchanges is bounded (one per word and dialect, ever, per style), and an
authored one can still take the place of one a learner's miss wrote. The card
looks the store up inside the same settle step as its picture and waits for an
exchange being written for at most `DIALOGUE_WRITING_WAIT_MS` (12 s), saying
"Writing a line for this word…", and only when its question could be asked
now: saying the reply needs nothing more, but choosing it needs three wrong
replies, which come from the other words' stored replies (`useQuizPool`
gives each pool entry its `dialogueLine`, read for the likeliest hundred words
in one query), so on a learner's first few exchanges step 6 asks "pick the
word" while the exchange is written behind it. As with pictures, a question is
fixed once it is on screen, and an exchange that arrives after it is for the
next time the word is asked. A stored exchange whose reply does not use the
word as written is not one; nor is one when the store's table is not on the
live project, where step 6 picks the word and step 9 says the line.

**A picture for a word that has none.** Steps 3, 5 and 7 want a picture, and
neither the authored tracks nor a learner's saved words come with one, so the
frame looks beyond the card's own row (`QuizCardFrame`; the store is "The
asset store" below):

- *The curriculum deck* (`sharedPictures`). A word whose row has no
  `image_url` is shown the shared store's picture, if one is filed, on any of
  the three steps. It is a read of a public table through `useWordAsset`, and
  nothing is written: a learner cannot write `vocabulary_words`. The rows
  themselves are filled by `scripts/curriculum-pictures.ts`, and a word
  nobody has drawn yet is simply heard instead.
- *A learner's own words* (`onPictureMade`). The same lookup, and a saved word
  that reaches "pick the picture" with no picture anywhere has one made:
  `useEnsureWordAsset` calls `word-asset`'s `ensure`, which draws it in the
  Ink style, files it for every later learner of the word, and charges this
  learner's existing daily picture allowance (a picture the store already had
  costs nothing). The url goes on the learner's `user_vocabulary.image_url`,
  only where the row still has none, and is patched into the deck and the
  pool so the next word's question can deal it as a wrong picture. Only step
  3 has a picture drawn; steps 5 and 7 show one when there is one. And only
  on a deck the quiz can ask questions of: with too few saved words for four
  options every card is the flip card, and nothing is drawn for those.

Nobody pressed a button for this, so it is quiet and careful with the
allowance (`useEnsureWordAsset`): a word is asked for once, whatever came
back, and a failure is not retried for ten minutes; nothing is asked for an
hour after an answer says the day's allowance is spent; two failures in a
row pause the asking altogether, because `word-asset` charges before it draws
and a provider that is down would otherwise cost a picture per card for
nothing; and no failure raises a toast — the card is asked its fallback. The
card waits for
the drawing, saying "Drawing a picture for this word…", for at most
`PICTURE_DRAWING_WAIT_MS` (12 s), and only when a picture question could
follow, which takes three other words with pictures; a learner whose words
have none yet is asked the fallback at once while the picture is drawn behind
it, so the picture question starts to appear once four of their words have
one. A question is fixed when it goes on screen — the card's own picture as
it was dealt, and the pool its wrong answers came from — so a picture that
arrives afterwards, the card's own or another word's patched into the pool,
is for the next card and never a different question, or different pictures,
under the learner's finger. Wrong options, pictures and recordings come from the
wider deck (`useQuizPool`), so a two-card session still gets four of each. The sentence a word was met in is always a tap
away; opening it before a choice answer counts as help. Nothing is typed —
most learners have no Arabic keyboard, and saying the word is the skill — so
the speaking steps record a take through `useTakeRecorder` and score it with
`azure-pronunciation` (the calibrated score, never Azure's raw one) against
the target, showing what was recognised beside the score. On "say the reply"
the line is played once by itself, the reply's meaning is shown (a reply with
no English is asked as a gap), and the target is the whole reply; what the
grader compares is the word's span of what was heard (`wordSpanSimilarity`:
the closest run of recognised words to the word, with an attached و, ب or
ال taken off), since a reply said well without the word is a different
reply. A word of three letters or fewer must be heard exactly: زين and وين
are one letter apart, well inside the allowance a longer word gets.

**An animation for an action word** (quiz Phase 5). For a verb, a still is
the weakest picture there is: a person holding a cup is "cup" as much as
"drink". So the curriculum deck (`animations`) shows an action word's clip —
four seconds of the action in the Ink style, looping, from the shared store
(`kind: "animation"`, "The asset store" below) — where its picture would be:

- *Which words.* A curriculum word whose authored category's head is "verb"
  ("Verb", "Verb — routine", "Verb — past" and six more spellings; not
  "Adverb", "Verb phrase" or "Verb frame"), or whose action is on
  `ACTION_NOUNS` ("traffic / crowd", "trip"), and whose gloss names an action
  at all (`qualifiesForAnimation` in `_shared/wordAnimation.ts`): "I want",
  "was / were" and "I think (that)" are verbs with nothing to watch, and get
  none. **Decided: a learner's saved words do not qualify.** `user_vocabulary`
  carries no part of speech (no category, and its `tags` are the learner's
  own), so the gloss would be the only evidence, and an English gloss is
  exactly what cannot tell "to fly" from "a fly" once a learner or a model has
  written it "fly", or "run (a business)" from "run" once it is "to run". A
  saved word keeps its picture.
- *"Say it"* (step 7, and the steps that fall back onto it) shows the clip in
  the picture's frame and in its place — never both — with the meaning behind
  a tap, as for a picture.
- *The picture question* (step 3) deals one visual per word: its clip where
  the pool has one (`useQuizPool` reads the curriculum's clips in one query
  of their own, beside the stored replies'), else its picture. It never deals
  another word with the same sense, or whose action shows the same motion
  (`actionsOverlap`: the same action, an alternative in common — "watch" beside
  "watch / see" — or a third-person "s"), which would be a second right
  answer; a past tense beside its present ("ate", "eat") is not caught. A clip that would be the only option moving is shown as its
  poster, so motion is never the tell (`MIN_MOVING_OPTIONS`, 2).
- *Motion that respects the learner.* A clip plays muted, looped and inline,
  with no controls (`QuizAnimation`). Under `prefers-reduced-motion` — read
  live — it is its poster, the still it starts and ends on; so is a clip that
  cannot load or that the browser will not autoplay.
- *Read, never made.* A clip costs a poster and four seconds of Veo, several
  pictures' worth, and takes longer to render than any card waits, so the quiz
  only looks one up (`useCardAsset`, free, `ANIMATION_LOOKUP_WAIT_MS` at
  most); they are made by `scripts/curriculum-animations.ts`. A card with no
  clip filed — every card, until that has run — is asked with its picture, or
  its meaning, exactly as before, and a clip filed while a question is on
  screen is for the next time it is dealt.

**A word in a story** (quiz Phase 6). The top step puts a mature word back
where a learner will meet it: in the middle of someone else's sentences,
heard at speed. Two sentences of a story, one of which uses the word, are shown
with the word cut out and read aloud with it muted, and the learner says the
missing word (`QuizStoryCard`):

- *The passage* is the shared store's (`kind: "story_line"`, "The asset store"
  below): two sentences from a published story in the reading library that
  already uses the word where there is one, else two written for the word,
  once, and kept for every learner after. The curriculum deck and My Words
  ask for one (`storyLines`); the phrase deck does not.
- *The gap* is cut by `findPhraseSpan` (`src/lib/quizStory.ts`), the quiz's
  one rule for a word's span, so a phrase is cut whole. A passage the word is
  said in twice is no passage — not even with a prefix (و, ب, ال, or the
  article contracted, as in للسوق and عالسوق) or a pronoun or plural ending
  (قهوتي, بيتين) on the second, which would say the answer the gap mutes. A
  story title that says the word is not shown either, nor, on either gap, one
  that names its meaning, which the four-option gap withholds: "At the
  Market" above a gap for السوق. The title is read against the card's English
  folded as the key
  folds a sense, and each meaning a gloss lists, by the rule the story search
  reads a sentence's English by (`englishNamesSense`).
- *The reading* is the cloze card's (`useMaskedSentenceAudio`, which both
  cards now share): the word is replaced by a pause in the text the voice is
  given, so no voice can say it, and both readings — muted before the take and
  whole after it — are in the passage's dialect's voice. The cloze card used to
  read in the learner's active dialect; it now reads in the card's.
- *The meaning is named beside the spoken gap.* A gap in running speech fits
  more than one word, and a right word that is not this one would be scored as
  a different word. The passage's translation is a tap away, and counts as help.
- *The take* is the word, scored against the word in the passage's locale and
  read through `singleWordSimilarity`: the word heard with a prefix attached
  (و, ب, ال, لل) is the word, a word of three letters or fewer must be heard
  exactly, and **a take of more words than the item is not the word**. That
  last rule is what stops a learner naming candidates ("شاي قهوة حليب") or
  reading the sentence back: the best stretch of a take, which a reply is
  read by, would be the word, and a pronunciation score charges extra words
  only a few points. It is banded like any single-word take, and a different
  word is Again. The muted reading never starts once a take has. The
  four-option gap does not name the meaning: with four set options the
  meaning would make it a translation match rather than a reading of the
  passage, and it follows the cloze card's later steps, which do not name it
  either; the translation is still a tap away, as help. **The
  step-9 rule (`REPLY_WORD_CLEAR`) does not apply:** it lifts a reply out of
  Again because a learner can answer a line rightly in other words than the
  stored reply and lose on completeness, and here the reference is the word
  itself, so a low score is a verdict on the word.
- *Settling.* The passage is a fourth thing a card may wait for, through the
  same per-card `useCardAsset` as its picture, exchange and clip
  (`STORY_LINE_LOOKUP_WAIT_MS`, then `STORY_LINE_WRITING_WAIT_MS` = 12 s for one
  being found or written, saying "Finding a story for this word…"). It is asked
  for, and waited for, only where its question can be asked now: said on a
  device that records, or picked from four, which needs three other words.
  The card's fallback (say the reply) reads the word's exchange but never has
  one written, so a card is not charged for its passage and its fallback both.
  A passage that arrives after the question is on screen is for the next time.
- *On a device that cannot record*, the same passage and gap with four
  options. A wrong pick offers **"Why not this one?"**, which opens the tutor
  on the passage and asks, by itself, why the word picked does not fit where
  the right one does (`AskAISentence` with `label` and `ask`; `openChat`
  holds the question as a one-shot `pendingAsk`, which the chat sends once as
  the learner's message: the first of a new conversation, or the next one
  when the panel is already about that passage. It is never part of the
  seed, so the server is sent only the sentence, and History never replays
  it). Every other choice step offers the same since Phase 7 (below).
- *Until the store's table is on the live project* there is no passage and the
  card is asked the reply, exactly as before Phase 6.

**"Why not this one?" on every choice step** (quiz Phase 7). A wrong pick is
the moment a learner most wants to know what they mixed up, so every question
with options — the gap, the meaning seen or heard, the picture, the word, the
reply, and the story's four-option gap — offers **"Why not this one?"** once
the pick is wrong, in place of its "Ask AI" chip (the picture question had
none, and still has none after a right pick; nor after a wrong picture filed
with no meaning to name it by). One tap opens the tutor and asks, by
itself, about the pair and what it was picked for (`whyNotQuestion` in
`src/lib/quizWhyNot.ts`, one question per choice format; a test fails if the
ladder gains a choice format with none):

| step | the panel opens on | it asks |
|---|---|---|
| the gap (1, 2) and the story's (10) | the sentence, or the passage | why the word put in the gap does not fit there |
| the meaning (shown) and the picture (3) | the word | how to tell the word from the meaning picked, naming that meaning's word |
| hear it (4) | the word | how to hear the difference, naming that meaning's word |
| pick the word (5) | the answer | why the word picked, with its own meaning, is not the word |
| answer the line (6) | the line said | why the reply picked does not answer it |

The word behind a wrong meaning or a wrong picture is the half of the pair the
learner never saw, and it is the confusion to explain (سوق heard as ساق), so the
frame hands it to the card: a picture option carries its word, unrendered, and
a meaning is looked up among the other words (`wordForMeaning`), naming none
when two different words share it — a wrong guess there would explain the
wrong mix-up. The question is the one-shot `pendingAsk` described above, never
part of the seed, so unlike the "Ask AI" chip it replaces, a tap is a tutor
turn (`docs/ai-spend-2026-10.md` §2), on the chat's own cap. The pick is
graded exactly as before, and opening the tutor after it changes nothing.

The meaning questions never deal another gloss of the word itself as a wrong
meaning (a mixed deck's other dialect, the same word saved twice): picking it
was a right answer graded Again. Found while building this, and fixed with it.

Grading is `src/lib/quizGrading.ts`: a right choice is Good (never Easy when
the options were on screen — the lesson quiz's and debrief's rule), a right
choice reached with help is Hard, wrong is Again; a spoken take is banded by
its score, and a take that was a different word — or, for a reply, one without
the word in it — is Again whatever it scored. **Decided (2026-10-10): a reply
with the word clearly in it is never Again.** The score is taken against the
one stored reply, so a learner who answers the line rightly in other words
loses on completeness and can land under the Hard band; that would be a lapse
on a production card a month or more old, for a right answer. When the word's
span of what was heard reaches `REPLY_WORD_CLEAR` (0.8; a word of three
letters or fewer only when heard exactly), a low-scoring reply is Hard
instead.
Every rating then goes down the page's existing path — the offline queue,
relearn, leeches, production unlock, the `review_log` trigger — so nothing
downstream knows the style. `QuizCardFrame` is the one place the ladder, the
cards and the grading meet; the pages hand it a card and get a rating back.

The game chrome rides on XP and never on scheduling: a combo of consecutive
right answers pays small XP at milestones (`src/lib/quizSession.ts`), the step
badge on each card shows where the word is on the ladder, and the end-of-deck
summary counts words that climbed. A graded answer on the My Words or My
Phrases decks also pays the flat review XP that the curriculum deck pays and
those decks' flip cards never did. Under Flashcards, My Words serves plain flip
cards — the every-other-card cloze it used to show now lives in the quiz.

**The lightning round** (quiz Phase 7). On each quiz deck's end screen, under
the summary, a session with at least three right answers at the ladder's
first four steps is offered sixty seconds over those words
(`LightningRound`, its rules pure in `src/lib/lightningRound.ts`). Each word
is asked once, in an order of its own ("Play again" never deals the same order
twice, nor the same options in the same places), and moves on by itself after
a beat (half a second after a right answer, 1.2 s after a wrong one, so the
right one can be read); the round ends when the clock runs out, mid-question or
not, or when the last word is answered (the clock stops on that answer, and its
beat still plays), and the result is the score and the time ("Every word in
23 s", or "Time!"). Focus moves to each new question and then to the result,
so the round can be played from the keyboard. The questions are the session's own
cards, asked **bare** (`bare` on `ReviewClozeCard` and `QuizChoiceCard`):

- a gap (steps 1 and 2) is asked as the gap, without the first look's hint;
- the picture, and the meaning shown, as the word shown → pick its meaning
  (the picture question's direction, with the meanings as words), never
  offered another gloss of the word itself (`otherMeanings`, which the
  frame's meaning questions use too);
- the word heard alone as the word heard alone, but only when it has a
  stored recording — otherwise as the word shown.

It is fenced off from everything the session does. No answer in it is a
rating, nothing is written, and no XP is paid. And it costs nothing: a bare
card synthesises no voice and plays nothing by itself but a stored
recording, and offers no translation, sentence hint or tutor, so the round
calls no function at all. That is why a word the session heard in a
synthesised voice is shown rather than heard (and why a page's `blob:` url,
revoked once its card changes, is dropped from the word: `storedRecording`).
The words are the session's, kept on the page as they are answered right
(`lightningWordFor` makes the word, `addLightningWord` keeps it once), and a
deck switch starts afresh with the summary.

**The boss card** (quiz Phase 7). A quiz session opens on the learner's
most-missed card: of the cards due, the recognition leech with the most lapses
(on either schedule, the word's misses) goes first (`withBossFirst` in
`src/lib/bossCard.ts`, applied by the three decks' due lists while the quiz is
on and the learner tracks leeches — Settings' leech switch turns it off with
the rest). It is asked as a **first look** whatever its stability — the gap
with its meaning beside it, or the meaning on its own where it has no sentence
— under a "Boss card" header that says how often it has been missed
(`QuizBossBanner`). Its memory hook and its picture (the hook's, else the
word's own) are one tap away, together, and opening them before answering is
help, as opening the sentence is: either can be the answer, a picture beside
"what does it mean?" being the meaning. After the answer both are shown
anyway, since a card missed this often is one to learn again, not only to
grade. With too few other words for four options it is the flip card, as any
card would be, and no boss. Beating it is a celebration, the small tier
(`celebrate({ kind: "boss" })`, "Boss beaten!"), played by the page once the
rating is on its way (`bossBeaten`): saved, on My Words and My Phrases, so a
save that fails is never celebrated; queued, on the curriculum deck, whose
offline queue saves it when it can. A boss stays the boss for its whole
presentation, even if the learner clears its leech flag from the rescue panel
after answering: the question, the answer given and the celebration are the
ones it was asked with.

The boss is chosen from what is due and only reordered, so nothing is reviewed
early, and only on the recognition side: a first look grades the recognition
schedule, and a production card's rating would land on the other one (on My
Phrases, a phrase settled enough to be said is not a boss either). Its answer
is graded exactly as any first look's — right is Good, right after opening the
hook is Hard (help, like the sentence), wrong is Again — and the frame reports
the card's own step, not the first look's, so beating the boss is never
counted as a climb from step 1 (nor, past step 4, a word for the lightning
round). It opens a session once (`isBossTurn`: the first card, before anything
is answered); a deck rebuilt later in the session may put a leech first again,
and that one is an ordinary card. The rescue panel under a leech
(`LeechHelperPanel`) is placed by the frame in the quiz: under the boss it
waits for the answer, since it prints the hook, and then offers what it always
does (a new hook, its picture, clearing the leech flag); under every other
card, the flip card included, it is there from the start.

**Ladder climbs on the leaderboard** (quiz Phase 7). The weekly board shows,
beside each learner's XP this week, their **climbs** this week: how many times
one of their curriculum words moved up a step of the ladder ("3 climbs"), the
count the session summary's "Climbed" tile keeps for one session. The board
does not rank by it; XP still does. The page's hint says what it counts.

The count is the database's, not posted by the browser. `leaderboard_climbs` (an
RPC, migration `20261010120000_leaderboard_climbs`) reads `review_log`, which
only the schedule tables' triggers write, so a climb is counted from a schedule
write rather than from a counter the client bumps. That is not proof against a
determined learner — their own `word_reviews` rows are theirs to write through
the API, as `award_xp` is theirs to call — so the count bounds what such writes
can buy: this week's reviews only, never one stamped in the future, only a
Hard, Good or Easy, and at most one climb per card, direction and day. A review
climbs when the step its memory lands on is above the step it was asked at, by
the ladder written out in SQL (`quiz_ladder_step`, a plain expression the
planner inlines). Its thresholds are held to `LADDER_THRESHOLDS` by
`src/test/leaderboardClimbs.test.ts`, and `migrationReplay.test.ts` runs it
against `rungForMemory` on a grid of memory states and runs the count on a
seeded week; the same rule in TypeScript (`src/lib/ladderClimbs.ts`) is what
the in-memory backend answers with. The log keeps no repetitions before a
review, so they are read as one fewer than after (the scheduler adds one on
every review but a lapse, and a lapse is never a climb); a first review was
asked as a new card. The week runs from Monday 00:00 UTC, the week
`weekly_goals` counts XP in. The function answers only for learners who chose
to be on the board, a page (100) at a time, and only with a count.

The page reads the climbs in a query of their own (`useLeaderboardClimbs`), so
the board never waits on them. Two things follow from counting them in the
database. It counts **what the log logs**: the curriculum deck's words, in
either review style — the step is a function of a card's memory, not of how it
was asked — and not My Words or My Phrases, which the log does not cover (a
quiz there shows "Climbed" in its summary that the board will not). And until
the migration is applied to the live project (an owner action, quiz Phase 7b)
the RPC is missing: `readClimbs` answers null and the board shows XP alone,
exactly as before, rather than a row of zeros.

Proposal and the phases still to come (the rest of the game, tuning from real
reviews): `docs/quiz-modes-plan-2026-10.md`; the execution roadmap is
`docs/quiz-phases-2026-10.md`.

### The asset store

Every picture, recording, jingle or exchange made for a word is made once and
kept, for every learner and for the quiz's later steps. Before the store a My Words
picture or jingle was generated per learner onto their own row, so two
learners who saved the same word paid twice and nothing could reuse what was
made. The table is `word_assets` (migration `20261009130000_word_assets`):
public read, service-role writes, so a learner reaches a shared row only
through a generation the server made.

**The key is the word, never the learner** (`_shared/wordAssets.ts`,
`assetKey`). The Arabic is folded exactly as `src/lib/arabicWord.ts` folds a
saved word, so the vocalised بَيْت an enrichment returned and the bare بيت a
transcript holds share one picture. The English sense rides along
(`كتاب|book`): the harakat that tell a homograph apart are exactly what the
folding removes, and حَب "seeds" and حُب "love" must not share a picture. Two
glosses for one sense ("house", "home") only cost a second generation, which
is the safe way for the key to be wrong. Every kind that shows, sings or uses
the meaning needs a sense that survives the folding (`kindNeedsSense`), and a
word carrying the `|` separator is refused, so no word can pose as another's
sense. A recording is the exception: it is keyed on exactly the text the voice
read, harakat and all, since the harakat are what the voice says — a word
re-vowelled to fix its pronunciation is a new recording. The dialect is folded
onto Gulf, Egyptian or Yemeni, and Fusha is refused: the store holds nothing a
dialect learner should not be shown. A language-neutral kind (an animation of
jumping, quiz Phase 5) is keyed on the English action alone, with no Arabic and
no dialect (`animationConcept`, below). `style_version` is part
of the unique key (`ink-1` for pictures), so a brand refresh regenerates
rather than mixes two looks in one deck.

**`word-asset`** is the door: `get` returns what is filed (free), `ensure`
returns it or, on a miss, makes it, files it and returns it. Only a miss calls
a model and only a miss is charged — to the learner who missed, on the daily
counter of the kind it made: a picture on the flashcard illustrator's, so the
picture dialog's two paths share one allowance, and an exchange on one of its
own (below). The prompt is built from nothing but the key's folded sense and
dialect — never the gloss as typed, since whatever the folding drops (an
emoji, a symbol) is in no key and must not be in a picture every learner of
the key is shown. The first learner to miss decides what every later learner
sees, so they must not be able to decide anything beyond the word. `ensure`
makes pictures, exchanges (quiz Phase 4), animations (Phase 5, on the
trusted path only) and story passages (Phase 6, taken from the reading library
where it can, written where it cannot).

**The trusted path: an authored scene.** One thing beyond the word may reach
a shared prompt, and not from a learner: for a picture, `scene`, a track
word's authored `image_scene` (the curriculum seed writes it to
`vocabulary_words.image_scene_description`), which becomes the `scene`
argument of `inkPicturePrompt`; for an exchange, `example` (below). Both go
through the one gate described here. `word-asset` honours it from two callers
only — a call made with the service-role key (`isServiceRoleCall`; that is
`scripts/curriculum-pictures.ts`) and the content team (`requireRole` with
`CONTENT_MANAGER_ROLES`: an admin or a content reviewer, read from
`user_roles`, never from the request). A `scene` from anyone else is ignored
rather than refused, and that caller goes on as the learner they are; so is
one too short to be a description (`MIN_SCENE_LENGTH`), since a scene is what
lifts a staff call off the cap. A staff member's authored draw is uncapped and
leaves a line in the function log naming them — the table is public-read, so
who asked is never in it. On the trusted path:

- *nothing is charged.* There is no learner behind the service role, and an
  authored picture is the catalogue's, not a staff member's own allowance. A
  staff member who sends no scene is asking for their own word's picture and
  is charged like anyone;
- *what is filed is `source: "authored"`*, with the scene in `meta`, and the
  answer carries `authored: true`. The script checks that before it writes a
  row. The Phase 2 function already refuses the service-role key outright, so
  this is a second line: no deployment that draws without the scene can fill
  the curriculum from glosses, at full price, one word after another;
- *it takes the place of a gloss-only picture filed earlier.* Curriculum
  words and learners' words share keys — a curriculum word's sense is its
  `word_english` — so a learner who saved قهوة / "coffee" before the script
  ran has already filed whatever "coffee" alone drew. **Decision: the authored
  scene replaces it.** The scene was written by the lesson's author and
  checked against the rest of the lesson; the other is what the first miss
  happened to produce. `isReplaceable` is the whole rule: only an unapproved
  `generated` asset gives way. An `authored`, `reviewed` or approved one is a
  hit like any other, so a second run of the script costs nothing, an edited
  scene does not redraw by itself, and nothing a person passed is overwritten
  by a script. `replaceAsset` updates the row in place, conditionally on its
  still being replaceable (a reviewer who approved it a moment ago wins), and
  records the old url in `meta.replaces`; it accepts only an `authored` or
  `reviewed` asset, and only the trusted branch calls it. The new picture is
  a new object (`fileNewAsset` with `replace`), and the old file is neither
  written over nor deleted — a learner whose own row already carries it keeps
  the picture they were given, and every later lookup gets the authored one.

**Exchanges (`kind: "dialogue"`, quiz Phase 4).** The quiz's reply steps
need a line that uses the word, and most words are in no lesson's dialogue,
so the store keeps one two-line exchange per word, sense and dialect
(`_shared/wordDialogue.ts`): `payload` is `{ lines: [said, reply] }`, each
line `{ speaker, arabic, english, transliteration }`, the reply using the word
as a whole word and the line said not saying it in any form, a prefix or an
ending attached included (`wordUseCount`: "رحنا للسوق؟" before a reply with
السوق would hand over the answer), by `asStoredDialogue`, the one rule the
store, the pool and the frame all read an exchange by. It is text, so it
has no bucket (`ASSET_BUCKETS.dialogue` is null) and is filed with
`putAsset`, never `fileNewAsset`; the style is `text-1`.

- *What reaches the prompt.* `ensure` writes it through `askBrain` — the
  CONTENT lineup, `draft_critic`, the native-speaker validator on
  (`enforceDialect`), and a quality gate that sends the critic back when the
  reply does not use the word or the line said says it — from the key's
  folded word, folded sense and dialect alone (`dialoguePrompt`, `keyWord`).
  **Decided:** a learner's miss carries nothing else, as for pictures. The
  roadmap first said to give the model the word's example sentence, but a
  saved word's sentence is the learner's own text (a transcript line, a
  note), and the exchange is filed for every later learner of the key; the
  quiz never sends it and the function would not hear it. The trusted path —
  the service role or the
  content team, through the same `isServiceRoleCall` / `requireRole` gate as
  a scene — may add `example`, a curriculum word's authored example sentence
  (`authoredExample`: one line, at most 240 characters, using the word and
  at least one other word, or it is not one and the caller is a learner).
  What that files is `source: "authored"` with the example in `meta`,
  uncharged, and it takes the place of an exchange a learner's miss wrote
  (`isReplaceable`, `replaceAsset`), exactly as an authored scene does.
- *What is filed.* Only an exchange every line of which passes the leak
  detector as the Brain runs it, with the approved rulebook's forbidden
  tokens, as a shared jingle's lyrics must — scanned with quotation marks
  taken out (`dialogueLinesForScan`), since the detector skips quoted text
  and a line a learner says is never a quotation — and that the native
  reviewer passed. The reviewer judges the text that is actually shipped:
  the draft (`enforceDialect`), and the critic's rewrite or a draft that ran
  out of budget for the first look (`validateDialect`), so a rewrite is never
  filed unread. **Decided:** when an exchange fails either, nothing is served
  either. The learner is about to choose that reply or say it as a model of
  the dialect, so the answer is the graceful
  `{ error: "msa_leak" | "dialect_rejected", fallback: true }` and the card
  asks its fallback. The miss was charged — the cap is taken before anything
  is made, as for a picture — and the quiz counts it as a failure for that
  word. One the reviewer could not judge at all (every validator leg down)
  passed the leak detector and was paid for, so the learner who asked gets
  it, unfiled (`stored: false`), and nobody else is served it unjudged. A
  word that is itself on its dialect's leak lists could never be filed (the
  reply must use it as it is), so it is turned away before the charge
  (`400 word_not_in_dialect`).
- *Who pays.* **Decided:** an exchange is charged on its own counter,
  `word-asset-dialogue` (30 a day free, 100 standard, 300 All-In), never on
  the picture allowance: a few short text calls are a different cost from an
  image, and a learner whose pictures are spent for the day still gets their
  dialogues, and the reverse (`useEnsureWordAsset` keeps its cap latch and
  failure pause per kind for the same reason). **Decided:** both word decks
  may ask for one, the curriculum's included. A picture is kept on the
  learner's row, which a learner cannot write for a curriculum word; an
  exchange lives in the store alone, so that reason does not apply, and the
  curriculum's exchanges are bounded in total (one per word and dialect,
  ever, per style) whoever asks first. The phrase deck does not ask: a phrase
  is not keyed by this phase.
- *Until the table is there,* nothing is made and nothing is charged: an
  exchange has no learner row to land on, so one that cannot be filed would
  be written, and paid for, again at every encounter. `lookupAsset` tells a
  missing table from a miss, and `ensure` answers `503 store_not_ready`
  before the cap; the quiz pauses asking for exchanges and asks the
  fallback.
- *Many at once.* Step 6's wrong replies are other words' stored replies, so
  the quiz's pool reads them in one query (`getAssets`, keyed with
  `assetKey`) rather than one lookup per word. The keys travel in the URL, so
  a read takes them in order up to `MAX_KEYS_PER_READ` (100) or
  `MAX_KEY_BYTES_PER_READ` (6,000 bytes encoded), whichever comes first, and
  the pool gives up on it after `STORED_REPLIES_WAIT_MS` (2.5 s) rather than
  hold the session. Each reply is tagged with its dialect, and a word is only
  dealt its own dialect's.
- *A phrase is a word.* A fifth of the curriculum's items are several words
  (كل يوم). "Uses the word" is one rule on both sides, `lineUsesWord`: a
  whole word, or a run of whole words in order, after the folding. When an
  authored exchange replaces a learner-written one, the row is updated in
  place, so `meta.replaces` keeps the text it held.

**Animations (`kind: "animation"`, quiz Phase 5).** A four-second looping
clip of an action word's action, shown by the quiz where the word's picture
would be ("Reviewing as a quiz" above). One per action, shared by every
dialect: Gulf's آكل, Egyptian's باكل and Yemeni's آكل are all "I eat", and
one clip of eating serves the three.

- *The key is the action* (`animationConcept` in `_shared/wordAssets.ts`,
  which `assetKey` uses for the kind). The subject and a leading "to" go ("I
  eat", "eat" and "to eat" are one); a qualifier stays — `normaliseGloss`
  turns "run (a business)" into "run a business", so it never borrows a clip
  of someone running; a list of alternatives is kept whole, each folded on its
  own ("I come back / I return" is "come back / return"), so a gloss shares a
  clip only with the same list. A gloss that is a note rather than a meaning
  keys nothing at all: one that opens with a bracket, asks a question ("do you
  want? (to a man)"), trails off ("then … would have"), uses a note's words
  ("used to…", "lit."), runs past eight words, or is led by a verb with
  nothing to watch ("I want", "was / were", "I'm full"). Which *words* get a
  clip is a second rule on top (`qualifiesForAnimation`, the quiz section).
- *How a clip is made.* A poster first, drawn by the image model in the Ink
  picture style at 16:9 with nothing that places it in one country
  (`inkAnimationPosterPrompt`, `NEUTRAL_FIGURE_LINE`; a picture's dialect
  setting belongs to a picture of one dialect's word). Then the clip, animated
  from that poster as its first **and** last frame (`inkAnimationPrompt`,
  `INK_ANIMATION_STYLE`: one action, once, back to the pose it began in, a
  camera that never moves, flat inks that stay flat, no text), so it loops
  without a jump and keeps the look — a video model left to a text prompt
  drifts toward depth and light. Both prompts are built from the key's action
  alone. The model is **Veo 3.1 Lite** (`VIDEO_MODEL_IDS.VEO_LITE`, chosen by
  the owner on 2026-10-09 over Veo 3.1 Fast, Kling v3.0 std, and Sora 2,
  whose API was being retired), through `aiGateway.generateVideo`: Google's
  `predictLongRunning` on the existing `GEMINI_API_KEY`, then the same model
  on OpenRouter's `/videos` without audio. Once a start has been sent, only
  a plain refusal or a job that ended unbilled (an error, a safety block)
  hands on to the other route; a timeout, a broken download, an answer that
  cannot be read or anything thrown stops, since that render may be billed and
  a second one would be. Google's key goes to Google's host only, and a
  download redirect is followed without it; a download is a clip only if its
  bytes are an MP4. One deadline covers the poster and the clip together
  (340 s, inside the worker's 400 s), and no route is started with less than
  two minutes of it left, so nothing is rendered that cannot be filed. 720p,
  16:9, four seconds, MP4.
- *What it costs, and who pays.* About **$0.27** a clip on Google's API (a
  $0.067 poster and 4 s × $0.05), or $0.19 on OpenRouter's — several
  pictures' worth — and a render takes from eleven seconds to minutes.
  **Decided: only the trusted path makes a clip; a learner only reads them.**
  That is the service role (`scripts/curriculum-animations.ts`) and the
  content team, through the same `isServiceRoleCall` / `requireRole` gate as
  an authored scene. The service role is charged to nobody. **Decided
  (2026-10-10): the content team's clips are capped**, on a counter of their
  own, `word-asset-animation`, ten a day per person (about $2.70 at most; an
  ID-login reviewer included, an admin, as for every cap, not limited),
  counted only on a miss and before the poster is drawn. A learner's `ensure`
  for a clip is refused (`403
  animation_not_for_learners`) before anything is spent; a learner's `get`,
  or an `ensure` that hits, is served free. A learner's miss deciding, at that
  price, a clip every dialect's learners are shown, for a question the card
  could not have waited for anyway, was the wrong trade.
- *A file, and its poster.* Both go in a bucket of their own,
  `word-animations` (migration `20261009140000_word_animations_bucket`):
  public, written only by the service role, and limited to MP4s and stills of
  at most 8 MB, a few times what a four-second clip comes to. Each is uploaded
  under a fresh name in the key's folder — the poster through `uploadNewFile`,
  the clip through `fileNewAsset` — and the row is filed with the clip's url
  and `payload: { poster, seconds, aspect }`. A clip with no poster is not
  served (`asStoredAnimation`): a learner who asked for reduced motion would
  have nothing to look at. The style version stays `ink-1`, reserved for the
  kind in Phase 2; nothing was ever filed under it before.
- *A render that outlasts its caller* is finished under
  `EdgeRuntime.waitUntil`: the function answers within 100 s
  (`WORD_ASSET_ANIMATION_ANSWER_MS`) with the clip, or with `202 { pending:
  true }`, and files the clip when it lands. The script then looks it up with
  free `get`s rather than asking again, which would pay for a second render.
- *Not without the table or the bucket.* A clip has no learner row to land
  on, so while the table is missing `ensure` answers `503 store_not_ready`,
  and while the bucket is missing `503 bucket_not_ready`, both before the
  poster is drawn.

**Story passages (`kind: "story_line"`, quiz Phase 6).** The quiz's top step
asks a word in two sentences of a story (`_shared/wordStoryLine.ts`):
`payload` is `{ sentences: [first, second], story? }`, each sentence
`{ arabic, english }`, exactly one of them using the word and the word said
nowhere else in the two, not even with a prefix or an ending attached
(`wordUseCount`, beside `lineUsesWord` in `wordDialogue.ts`: و, ف, ب, ل, ك,
ال and ال contracted as in للسوق and عالسوق, and for a word of three letters or
more a pronoun or plural ending, قهوتي, بيتين; a word conjugated into another
form, يروح for روح, is another word); `asStoredStoryLine` is the one
rule the store, the frame and the script read a passage by). Text, so no
bucket; style `text-1`; filed with `putAsset`. A passage comes from one of two
places, in this order.

- *A published story that already uses the word in the key's sense*
  (`findStoryPassage`), with no model call, filed as `source: "reviewed"` (a
  person published the story) with the story, its lines and its licence in
  `meta`.
  The reading library was the plan's source; the roadmap called it
  `reading_library`, which is no table. The two candidates in the schema, and
  what was decided about each:
  - **`authentic_stories` and `authentic_story_lines`: the source, under six
    rules** (`storySourceProblem`, `englishNamesSense`, `inCurrentRendering`).
    *The dialect text
    only:* a line carries its sentence twice, `arabic` (and
    `arabic_vocalized`, and the story's `body_fusha`) being the Modern
    Standard Arabic it was imported from and `dialect` the spoken rendering;
    only `dialect` is read, and a rendering that is its own fusha word for word
    was never converted — nor is a sentence of a rendering that is one of its
    fusha's sentences word for word (a conversion can leave one sentence of a
    line untouched; it keeps its place, so the sentences either side of it are
    never paired across it). `body_dialect` is not read for text either: it fills
    every line the conversion skipped with that line's fusha. *Published
    only:* `status = 'published'`, the one status the reader's RLS serves to
    anyone (`draft` and `content_approved` are an editor's work in progress).
    *A licence that asks nothing of a passage shown on its own:* public domain
    and CC0. **Decided: CC-BY and CC-BY-SA are left out.** CC-BY must be
    credited wherever its text is shown, and a two-sentence quiz card, filed
    in a public table with no licence column, carries no credit; CC-BY-SA also
    puts every adaptation under the same licence, and a dialect rendering cut
    to two sentences is one. An empty licence is left out too; the label is
    otherwise trusted as written, and the column defaults to `public_domain`,
    which is what the suggest-and-import flow writes for the public-domain
    texts it imports — so a story an editor imported by hand without
    choosing its licence lends as public domain. *The story's own dialect,
    exactly:* the story form also offers Levantine and
    MSA, which the app-wide `normalizeDialect` reads as Gulf; here a label
    that is not Gulf, Egyptian or Yemeni is no dialect (`storyDialect`). *The
    word's sense:* the search matches the Arabic, and the folding that keys a
    word removes the harakat that tell a homograph apart, so a story's عين
    "spring" would otherwise be filed under عين "eye" — and, filed as
    `reviewed`, never replaced. The gap sentence's English must name every word
    of the key's folded sense that says which sense it is, as itself or
    inflected (`englishNamesSense`); strict on purpose, so an irregular past
    or a bracketed note takes no story passage and one is written instead.
    *The story's current rendering:* `translate-story-dialect` leaves a line its
    model skipped with the dialect it already had, so a story moved from Gulf
    to Egyptian can keep a Gulf line under an Egyptian label; `body_dialect`
    is rebuilt from the latest conversion alone, so a line whose rendering is
    not one of its lines is from an earlier one and is not taken. Every
    sentence also passes the leak detector with the rulebook's tokens, which
    costs nothing and catches a rulebook that grew after the story was
    checked.
  - **`reading_passages`: left out.** Its `dialect` column is never written by
    the one path that fills the table (the curriculum builder's approval
    inserts no dialect, so every row takes the default, Gulf), so an Egyptian
    passage would be filed and served as Gulf. Its text is one blob with one
    English blob beside it, so no sentence has its own translation either.
  *Cutting two sentences.* A line is cut into sentences at . ! ? ؟ or … (and a
  newline), but only where its English splits into as many, so each sentence
  keeps its own translation; otherwise the line is one sentence of the
  passage, if it is short enough to follow by ear
  (`MAX_STORY_SENTENCE_LENGTH`, 200). The passage is the word's sentence and
  the one before it (the story leading into the gap), or the one after when
  the word opens the story or the one before does not make a passage; two
  sentences pair only if they follow on in the story, and the word's sentence
  is never cut. The word is said once in the two (`wordUseCount`), counting
  every form the muted reading would give it away in: an attached prefix
  (و, ب, ال, للسوق, عالسوق), a pronoun or plural ending (قهوتي, بيتين),
  quotation marks, and, for a word stored with its article, the word without
  it (سوق, سوقنا for السوق). Of every passage the shelf holds, the shortest is taken, since
  the learner hears all of it. The search reads public data only: the
  published stories, their rendered lines a page at a time, and the bodies of
  the stories a passage was found in, bounded by `MAX_STORIES_PER_SEARCH` and
  `MAX_STORY_LINES_PER_SEARCH`; a failed read is no passage, never an error
  (so a read that fails on a learner's miss means a passage is written, and
  the script can later put a story's in its place).
- *Written for the word,* under the dialogue kind's rules exactly — the same
  writer in `word-asset` (`writeText`), so they cannot drift: from the key's
  folded word, folded sense and dialect alone (`storyLinePrompt`; nothing a
  learner typed, not the sentence a saved word came from), the CONTENT lineup
  drafted and critiqued with the native validator on the draft and on what
  ships, a quality gate that sends the critic back when the word is missing or
  said twice or a sentence runs past fourteen words, and filed only when every
  sentence is at most fourteen words (`asWrittenStoryLine`,
  `MAX_WRITTEN_SENTENCE_WORDS`, the writer's rule alone: a story's own
  sentence is held to `MAX_STORY_SENTENCE_LENGTH` only), passes the leak
  detector with the rulebook's tokens, and the validator passed the shipped
  text; anything that fails any of them is neither filed nor served, and one
  the validator could not judge is the paying learner's, unfiled. The trusted path may add
  `example`, a curriculum word's authored sentence, exactly as for an exchange;
  a published story's passage is still taken before that.
- *Who pays.* **Decided: a learner's miss is charged on the exchange's
  counter**, `word-asset-dialogue` (30 / 100 / 300 a day), **before the shelf
  is searched, whether the passage is then found or written.** Pictures and
  exchanges have separate counters because they cost differently; a written
  passage and an exchange cost the same (the same lineup, strategy and
  validator, a few hundred tokens), and a counter of its own would have given
  every learner another thirty text calls a day for a step a word reaches
  after two months. A found one costs no model call, and was first meant to be
  free; an independent review showed why it cannot be: a miss is a search of
  the whole shelf and a row in a public table every later learner of the key
  is served, the gloss is part of the key and the caller's to vary, and no cap
  can be read without being taken. Charged before the search, a learner can
  cause as many searches and file as many rows as their allowance, and an
  over-cap ask searches nothing. `useEnsureWordAsset` latches the allowance per
  counter, so a spent one pauses both kinds; failures still pause each on its
  own. The trusted path is charged nothing, as for every kind.
- *Order and refusals.* A filed passage is a hit, free. On a miss: while the
  table is missing, `503 store_not_ready`; with no provider configured, `503
  ai_unconfigured`; a word on its dialect's leak lists, `400
  word_not_in_dialect` — each before anything is read or charged; then the
  charge (a learner's), the story search, and, only if that found nothing, the
  writing. A published story's passage takes the place of a written one only
  on the trusted path (`replaceAsset`), which is what
  `scripts/curriculum-stories.ts` is for.
- *Taking back.* A passage filed from a story stays filed when the story
  later stops lending it (unpublished, re-licensed, moved to another dialect,
  re-converted, deleted), since the quiz reads the store directly; the script
  takes such passages back (`storyPassageStillLent`), and until it runs they
  are still served.

**Filling the curriculum's passages from stories:
`scripts/curriculum-stories.ts`.** For every `vocabulary_words` row it runs the
same search and files what it finds, under the service-role key; a word no
story uses is left for its first learner at the top step, whose miss writes
one. A passage a learner's miss wrote gives way to a story's
(`isReplaceable`); one someone authored, reviewed or approved does not. And it
takes back what a story stopped lending: a filed story passage whose story was
unpublished, re-licensed, moved to another dialect, re-converted or deleted
has its row deleted, and the word is searched again. It calls no function and
no model and costs nothing, so it needs only the
`word_assets` migration, not a deployed function. `--dialect`, `--stage`,
`--limit` (passages filed), and `--dry-run`, which writes nothing and prints
what each word would take or have taken back, what the shelf holds, and why
each story left out was. The deciding is in `scripts/curriculum-stories-core.ts`, covered by
`src/test/curriculumStories.test.ts`.

```sh
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-stories.ts --dry-run
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-stories.ts --stage 1 --limit 10
```

**Filling the curriculum's clips: `scripts/curriculum-animations.ts`.** For
every `vocabulary_words` row that qualifies, it makes sure the store holds its
action's clip, once per action, on the trusted path; nothing is written onto
the rows. `--dialect`, `--stage`, `--limit` (clips, not words; an action
already in the store is free and not counted), and `--dry-run`, which reads
only and prints the bill. Today's tracks come to **62 clips, about $16.55**:
Stage 1 has one, "give me / pass me" (its other verbs are "I want"), Stage 2
has 33 and Stage 3 has 28. The deciding is in
`scripts/curriculum-animations-core.ts`, covered by
`src/test/curriculumAnimations.test.ts`.

```sh
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-animations.ts --dry-run
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-animations.ts --stage 2 --limit 3
```

Order matters: apply the `word_assets` migration and the bucket's, and deploy
this `word-asset`, first. Without the table or the bucket a real run stops
before it asks for anything and says which is missing (the dry run still
counts and prices every action).

**Pictures that can be told apart.** The quiz deals a word's picture beside
three other words', so the prompt template says so
(`PICTURE_DISTINCT_LINE`): draw what is particular to this meaning, one
subject with a silhouette of its own, not a general scene that could stand
for another word. It is part of the template and not of the look, so it did
not bump `STYLE_VERSIONS.image`; the frame, for its part, never deals one url
twice or the word's own picture as a wrong one.

**Filling the curriculum: `scripts/curriculum-pictures.ts`.** For every
`vocabulary_words` row with no `image_url` (null or empty), it asks
`word-asset` for the picture on the trusted path, with the row's
`image_scene_description` as the scene, and writes the url onto the row —
only if the row still has none, so a picture an admin added while it ran is
left alone. `--dialect`, `--stage`, `--limit`, `--dry-run`. A local tool with
no CI gate, like `curriculum-brain.ts`: it needs the service-role key and
spends one image generation per word drawn on the project's provider keys.
The deciding is in `scripts/curriculum-pictures-core.ts` with `fetch` passed
in, covered against the in-memory project by
`src/test/curriculumPictures.test.ts`.

```sh
# What would be drawn, redrawn or copied, and how many generations it comes
# to. Reads only: no function is called and no row is written.
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-pictures.ts --dry-run

# Then a few, to look at before the rest.
SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-env --allow-read --allow-net \
  scripts/curriculum-pictures.ts --dialect Gulf --stage 1 --limit 10
```

`SUPABASE_URL` is read from the environment, else from the `project_id` in
`supabase/config.toml`. Order matters: apply the `word_assets` migration and
deploy this `word-asset` first. It is safe to run again — a filled row is not
listed and a word already in the store is copied, not redrawn — and it stops
at the first answer that says every later word would fail the same way (the
key refused, the function not deployed or not this version, no image
provider, a row it is not allowed to write), or after five failures in a row.
Words it could not draw are left empty for the next run.

**On brand and in dialect.** Pictures are drawn in the Ink style
(`INK_PICTURE_STYLE`): a flat screenprint poster in oxblood, mustard and
near-black on cream, never a photograph, and no text of any kind — which is
also what keeps a picture out of Fusha, since an image model's lettering is
Fusha when it is Arabic at all. `generate-flashcard-image`, which draws a
learner's own picture and the admin's curriculum pictures, uses the same
style; it asked for a stock photograph before, and the picture dialog's
style-lock default no longer asks for one either. A jingle is filed only when
its lyrics pass the leak detector exactly as the Brain runs it (with the
approved rulebook's forbidden tokens) and are what was actually sung (a clip
from the safety-filter fallback sings only the word, so it is not filed under
lyrics it did not sing); a shared jingle is sung in the dialect and from the
sense its key was folded to. A clip is the picture style set moving
(`INK_ANIMATION_STYLE`, beside `INK_PICTURE_STYLE`): animated from an Ink
poster, its inks stay flat, its camera stays still, and no text appears.

**What looks the store up first:**

| generator | on a hit | on a miss |
|---|---|---|
| The quiz's picture step, for a learner's own word (`QuizCardFrame` → `useEnsureWordAsset`) | the store's picture goes on the learner's row, uncharged; found by the free `useWordAsset` read first, so most hits never reach the function | `ensure` draws and files it, on the learner's daily picture allowance; once per word per session, and silent on any failure |
| The quiz's reply steps (6 and 9), on the curriculum deck and My Words, for a word its lesson has no line for (`QuizCardFrame` `storedDialogues`) | the stored exchange is asked, uncharged; found by the free `useWordAsset` read first | `ensure` writes and files it, on the learner's daily dialogue allowance, if it passes the leak detector and the native reviewer; otherwise nothing is served and the card asks its fallback |
| The quiz's "say it" and picture question, on the curriculum deck, for an action word (`QuizCardFrame` `animations`) | the action's clip is shown, uncharged; found by the free `useWordAsset` read, and by `useQuizPool`'s one batched read for the wrong options | nothing is made: the card is asked with its picture, or its meaning |
| The quiz's top step ("in a story"), on the curriculum deck and My Words (`QuizCardFrame` `storyLines`) | the stored passage is asked, uncharged; found by the free `useWordAsset` read first | `ensure` charges the learner's daily dialogue allowance, then takes one from a published story or writes one, if it passes the leak detector and the native reviewer; otherwise the card asks the reply |
| `scripts/curriculum-stories.ts` (the service role, no function) | nothing to do, unless what is filed is a passage a learner's miss wrote, which a story's takes the place of, or a story's passage its story no longer lends, which is taken back | files the passage a published story holds for the word; a word no story uses is left for its first learner |
| `scripts/curriculum-animations.ts` (the trusted path) | nothing to do, and not counted against `--limit` | `ensure` draws the poster, animates it and files both; charged to nobody (a content team member's own ask is counted on `word-asset-animation`, ten a day) |
| `scripts/curriculum-pictures.ts` (the trusted path) | the url is copied onto the curriculum row, unless what is filed is a gloss-only picture and the row has an authored scene, which is then drawn in its place | `ensure` draws from the authored scene and files it as `authored`; charged to nobody |
| The picture dialog (`GenerateImageDialog`) | a word's first picture comes from `word-asset ensure`; the url goes on the learner's row as a generated one did | `ensure` draws and files it. A regeneration, a described picture or a locked style is the learner's own and goes to `generate-flashcard-image`, as does a first picture the store turned away before charging (404 not deployed, 400 a word it cannot file); a failure after the charge is reported, never retried on the illustrator |
| `persist-word-audio` | a curriculum row gets the recording another row with the same exact text and dialect already has | synthesises, puts it on the row and files it for the next row, as one fresh object |
| `generate-word-jingle` with `share: true` (both review pages, for a first jingle, in the card's own dialect) | no lyric call, no Lyria call, nothing charged; the answer carries `audioUrl` and the page stores it instead of uploading | sings, uploads, files it if the lyrics pass; the answer carries `audioUrl` and no bytes |

`share` is opt-in so a client still running an older bundle never receives a
hit it cannot play (a hit carries a url and no bytes); a regeneration leaves it
off. New objects are always written under a name of their own
(`fileNewAsset`, the one way the generators add a file), so no url ever handed
to a learner is overwritten — two learners who miss at once each keep what they
were given, and only the one the table files is served to anyone else. Nothing
else may write there either: `generate-flashcard-image` uploads with the
service role to a caller-named `storage_path`, so it now keeps a learner's
path to their own `tutor/<id>/` folder, honours another path only for the
content team, and refuses `word-assets/` to everyone.

A curriculum recording is never re-synthesised from the store's point of view:
identical text in the same voice gives the same recording, so a hit is not a
stale answer. To change how a word is said, upload a recording or change its
text (re-vowelling it is a new key); bump `STYLE_VERSIONS.word_audio` when the
voice chain itself changes.

**Until the migration is applied to the live project** every lookup misses and
every filing fails quietly (`getAsset` reads a missing table as a miss,
`putAsset` and `replaceAsset` never throw), which leaves each generator doing
what it did before the store existed; the table's columns are pinned in
`typesDrift.ts` until a types regeneration carries them. Phase 3 degrades the
same way. `ensure` answers `stored: false` with a url, so a learner's word
still gets its picture on its own row and the script still writes each url
onto its curriculum row — it warns at the top that nothing drawn is being
kept in the store, which means a learner who later saves the same word will
not share that picture. The curriculum deck's lookup reads as none and the
card is asked its fallback. No exchange is made at all (`store_not_ready`,
uncharged), so step 6 picks the word and step 9 says the line, exactly as
before Phase 4. No clip is made either (`store_not_ready`) and none is read,
so "say it" and the picture question show pictures as before Phase 5. No story
passage is taken or written (`store_not_ready`, before the search), so the
top step asks the reply, as before Phase 6, and `scripts/curriculum-stories.ts`
stops before it searches.

**Until this `word-asset` is deployed** it depends on what is there. With no
`word-asset` at all the quiz's ask is turned away uncharged (404) and it
stops asking; with the Phase 2 one, a learner's ask is served and charged as
it always was, drawn without the line about telling pictures apart. Either
way the script stops on its first word: neither accepts the service-role key.
Neither makes an exchange either: the Phase 2 and Phase 3 functions answer
`kind_not_generated` (400), uncharged, and the quiz stops asking for
exchanges for a while and asks the fallback. A `word-asset` from before Phase
5 answers an animation `kind_not_generated` too, and
`scripts/curriculum-animations.ts` stops on its first action; the quiz never
asks for a clip to be made, so it notices nothing. A `word-asset` from before
Phase 6 answers a story passage `kind_not_generated`, uncharged, and the quiz
stops asking for passages for a while and asks the reply;
`scripts/curriculum-stories.ts` calls no function and is not affected.

`useWordAsset` is the browser's read of the store and stays read-only: making
an asset is a generation with a cost, so that is a separate hook,
`useEnsureWordAsset`, which invalidates the word's `["word-asset", …]` read
once it has made one. Everything it remembers across a session — the daily
cap latch, the failures in a row, the pause — is kept per kind.

### The authored tracks (Stages 1–3, three dialects)

The Pre-A1 → B1 curriculum for Gulf, Egyptian and Yemeni is authored in git,
not in the admin UI: `curriculum/tracks/`. One dialect-neutral
`syllabus.json` fixes 38 lesson slots (12 Foundations, 14 Building Blocks, 12
Bridge) — slug, CEFR target, can-do goals, grammar targets in the six shared
`grammarTaxonomy` categories, the cultural thread, and the `target_concepts`
every dialect must realise. Each dialect fills the slots in its own words as
one JSON file per lesson (`<dialect>/stage-<n>/<nn>-<slug>.json`): vocabulary
with an example sentence, teaching note, image scene, caption `variants` and a
`video_hint` per word; grammar notes with dialect examples; culture notes with
their phrases; a dialogue; sound spotlight; lesson sequence; real-world prompts;
and `video_needs`. `curriculum/tracks/SCHEMA.md` is the authoring guide.

Lessons line up across dialects by slug and concept key, never by an Arabic
string — the same idea as `vocab_concepts` → `concept_realizations` in the clip
pipeline — so a learner switching dialect lands on the same lesson.

Three things are generated from the tracks and committed:

- **The seed migration** `supabase/migrations/20260905110000_seed_curriculum_tracks.sql`
  (`npm run curriculum:seed`, pure generator in `src/lib/curriculumSeed.ts`).
  Lessons upsert on `lessons.source_key`, words insert-if-missing then update
  (never delete — `word_reviews` point at them), grammar concepts land in
  `curriculum_concepts` + `content_concept_links`, and every word with a
  `concept_key` becomes a draft `concept_realizations` row so
  `mine-clip-candidates` can hunt for it. The new lesson columns
  (`grammar_notes`, `culture_notes`, `dialogue`, `can_do`) render on the first
  card of `Learn.tsx`; `vocabulary_words.example_*` carry the sentence.
- **The video shopping list** `curriculum/video-needs/<dialect>.md`
  (`npm run curriculum:video-needs`): per lesson the scene to look for, the
  registered channels to mine first, Arabic searches, and every word's caption
  surfaces. `scripts/curriculum-video-coverage.ts` (needs the service role)
  matches those surfaces against `discover_videos` transcripts, `caption_lines`
  and `published_clips` and writes `coverage-<dialect>.md`: which words are
  already on film, where, and which still need a video.
- **The Brain's review** `scripts/curriculum-brain.ts` (Deno, needs provider
  keys) sends each lesson through `askBrain` (CONTENT lineup, draft_critic,
  native-speaker validator) for a line-by-line native review with proposed
  replacements, written to `_brain/*.review.json` next to the lesson; `--apply`
  merges the accepted ones. Nothing it writes bypasses the guards below.

Authoring is incremental: `curriculum/tracks/STATUS.md` is the slot-by-slot
table of what is written. Every lesson that exists is complete and validated;
an unwritten slot is simply absent, and the seed compiles whatever is on disk.

Guards: `src/test/curriculumTracks.test.ts` holds every dialect file to the
syllabus (slots, concepts, word minimums, no word introduced twice, valid
grammar categories, script per field), pins the per-stage lesson counts as a
ratchet so a lesson cannot vanish, and runs every Arabic string through
`detectMsaLeaks` for its dialect — a leak inside a lesson is taught, not
caught. `src/test/curriculumSeed.test.ts` fails when the seed migration is
stale. `npm run curriculum:check` is the same check for authors, with
`--dialect`, `--stage` and `--partial` while a stage is half-written.

## Celebration screens

Six moments open a full-screen celebration:

- the first finish of a lesson
- mastering an alphabet letter
- clearing every review deck
- completing the day's list
- earning a badge
- reaching a streak milestone

It plays a few seconds of a traditional dance from the region of the
learner's dialect, as a cut-paper collage in the Ink brand: grayscale photo
cutouts of the dancers snap from pose to pose on the beat, over mustard paper,
under the dance's name in a frame from the dialect's architecture. A cheer in
the dialect sits on the stage. The screen closes itself after 3 seconds, or 6
for the daily goal and a streak; Continue, Escape or a tap outside it ends it
sooner.

Every pose is drawn from a keyframe of real footage, and every timing number
is measured from it (`docs/reference/<dance>/`). The performers are generated
from written descriptions of those frames, never from the frames themselves.

Pages fire a moment with `celebrate()` from `src/lib/celebrations.ts`, and
`CelebrationHost` (mounted once in `App.tsx`) renders it. A second moment that
lands while the screen is open becomes a line on it rather than a second
screen. Each dialect's dances rotate in order. The daily goal is celebrated
once a day, and a streak milestone once per run. Badges use this screen
instead of the toast they had before. The cheers are run through
`detectMsaLeaks` in the tests. The dances and their timing are
`src/lib/dances.ts`; `?celebrate=<dance>` plays one on any page.
`docs/celebrations.md` has how a dance is made.

**A badge is on the screen.** Earning one puts its emblem on the stage as a
sticker (`BadgeSticker`): the same woven-sadu artwork the achievements grid
shows for that badge (`badgeArtFor`), in a taped paper disc with its XP, and its
Arabic name as an ink label under the cheer; a badge with no artwork yet gets
its emoji on a mustard disc. `?celebrate=lulu&celebratebadge=🔥` previews it on
any scene without earning one, and sings nothing.

Fourteen **vignettes** sit beside the dances, drawn the same way but with a
meal, a ritual or a landmark instead of dancers (`src/lib/vignettes.ts`). A
streak milestone plays the dialect's **ladder**: one grill story in each
dialect's food (mishkak, the kababgi, the Yemeni madhbi) whose picture grows
with the days, from the coals catching at 3 to a feast at 365. Every other
moment alternates the dance rotation with the vignettes that suit it, a dance
first: a pearl for a badge, a football goal for the day's goal, a reed pen for
a letter. Flames, smoke, steam and sparkle are drawn in code
(`StageEffects`), not photographed. Unlike the dances, none of it is timed from
footage, and every Arabic line is a draft for a native reviewer. See
`docs/celebrations-vignettes.md`; `?celebrate=mishkak&celebratedays=100` plays
a rung.

Each dance can also play a short loop of its own music, cut on the beat the
scene is timed to. That is a test with uncleared audio: it plays in
`?celebrate=` previews, and in real celebrations only on a browser where
`?dancemusic=on` has switched it on (see "Music (testing)" in
`docs/celebrations.md`).

## Project layout

- `src/` — React app (pages, components, hooks, domain logic in `src/lib`)
- `supabase/functions/` — Deno edge functions (AI, TTS/STT, billing, content)
- `supabase/functions/_shared/` — shared helpers (Brain, dialect rules, CORS,
  usage caps, model registry)
- `supabase/migrations/` — database schema and RLS policies
- `docs/` — planning notes and branding assets

## The Fusha row

A transcript line carries three things about the same sentence: the Arabic as
spoken, the English translation, and — since this feature — `fusha`, the same
sentence rewritten in Modern Standard Arabic. It is a **conversion, not a
translation**: the row stays in Arabic and only the dialect-specific parts move
(شلونك → كيف حالك, يبغى → يريد, ما راح أروح → لن أذهب), so a learner who arrived
from فصحى can see which pieces the dialect changed rather than only what the
line means. That is why it renders beside the Arabic rather than inside the
collapsible English.

The rules live in `supabase/functions/_shared/fushaBridge.ts` — prompt text,
parsing, alignment, and the comparison that decides whether anything actually
changed — so the analysis pipeline, the on-demand converter and the React
component all agree on what a Fusha rendering is. Two of its rules are worth
knowing:

- **Anything without Arabic script is dropped.** The row renders RTL under a
  فصحى heading, so a model that answers "I went to the market" produces a second
  translation wearing Arabic's clothes. A blank is better; the row just doesn't
  render.
- **Short answers pad, they never shift.** A model that returns nine renderings
  for ten lines has merged two of them, and sliding the array into place files
  every later line's Fusha under the wrong sentence — invisible to exactly the
  learner this row is for.

`analyze-gulf-arabic` runs the conversion as its own model call, parallel to the
translation ensemble rather than folded into it: the ensemble picks a winner by
clustering *English* token overlap, and a Fusha rendering has no bearing on
which English translation is right. Provenance lands in
`engines_used.fusha` (status, model, `lines_filled` / `lines_total`) — a pass
that "succeeded" while filling 3 of 40 lines is a failure a learner sees.

Everything analysed before this existed has no `fusha`, which is most of the
Discover library and every saved transcription. `convert-to-fusha` fills those
in on demand: `useFushaLines` sends only the lines missing one, only once the
learner turns the row on, and only once per line per mount. The switch is the
global "Formal Arabic (MSA)" display preference on every screen that shows the
row, so asking for MSA once — in Settings, on a transcript, on a video — turns
it on everywhere.

## The reading library

Authentic short prose — public-domain folktales, fables and short stories —
imported by an admin and read line by line at `/reading-library`. It is the one
part of the app whose *source* is Modern Standard Arabic, and the only reason
that is allowed is that the source is never what a learner sees.

The pipeline is four model calls behind one button. `suggest-stories` proposes
three real stories that are not already on the shelf;
`generate-suggested-story-text` writes the full text of the one chosen, in
fusha and deliberately so (`targetRegister: "msa"`, the app's only such
caller — the alternative is a prompt that says both "never MSA" and "write
MSA", which filed a high-severity violation and a fake native-review task on
every import); `import-authentic-story` segments it into lines, adds tashkeel,
translates each line to English and extracts vocabulary; and then it converts
every line into the target dialect.

**That last step is part of the import, not a step after it.** It did not used
to be: the conversion lived only behind a "Translate to Dialect" button on the
edit page, and nothing in the suggest → generate → import flow pressed it. So
the feature had a dialect conversion all along and every story still reached
the shelf in fusha. The rules now live in `_shared/storyDialect.ts` — the
prompt, the alignment, and the shape of what gets stored — with two entry
points over them: the import, where the conversion is non-fatal (a model outage
costs the story its dialect, which is re-runnable, rather than the
segmentation, translations and vocabulary that already succeeded), and
`translate-story-dialect`, which re-runs it for a story being moved to another
dialect or redone.

Three rules the converter keeps:

- **The fusha source is a trap, and the prompt says so.** Text elicited from an
  MSA source drifts toward MSA — word order, verb forms, lexis — which MADAR's
  corpus builders measured and sidestepped by translating from English instead.
  The instruction asks for what a speaker would actually say, restructuring and
  swapping the lexeme (نافذة → شباك, أريد → أبغى/عايز), and `enforceDialect`
  puts the native-speaker validator behind it, because "fusha with a few
  dialect words" is exactly what the MSA token blacklist cannot see.
- **Short answers pad; they never shift.** Same rule as the Fusha row, for the
  same reason: a model that returns nine renderings for ten lines has merged
  two of them, and sliding the array into place files every later line's
  dialect under the wrong sentence.
- **A re-run may never leave a story worse than not running it.** A conversion
  that comes back empty writes nothing at all — it used to overwrite
  `body_dialect` with an empty string and answer `success: true`.

**The reader shows the dialect and keeps the fusha one switch away**
(`src/lib/storyReading.ts`). That defaulted the other way round for as long as
the feature existed, which is the second half of why everyone was reading MSA.
A line the conversion skipped falls back to its own fusha rather than rendering
blank.

**The audio follows the text.** Every line has a speaker and the story has a
read-through, both through `useLineAudio` → `tts-speak`, which takes a
*dialect* and resolves the voice server-side — the dialect view is read in the
story's dialect, the fusha view in MSA. Stored narration (an editor pressing
"Generate Full Audio") is played instead of synthesised when it was made from
the register on screen, so a published story costs a learner nothing from their
daily TTS cap; a dialect recording under the fusha is refused and that line is
synthesised instead. Keeping those two honest is what `storedClipFor` is for,
and what makes `translate-story-dialect` drop the recording of every line whose
words it changed. The controls used to be gated on a stored recording
existing at all, so a story nobody had narrated could not be heard.

**Its stories lend the quiz its passages.** The quiz's top step asks a mature
word in two sentences of a story, and takes them from here where a published
story already uses the word in its sense: the dialect rendering only, never
the fusha, and only from a public-domain or CC0 story in exactly the word's
dialect, as its latest conversion left it ("The asset store", story
passages). A story moved to another dialect lends nothing from a line the
conversion skipped, and a CC-BY or CC-BY-SA story lends nothing at all. The
licence is read as written: a story imported by hand keeps the column's
`public_domain` default unless its editor chose another, so choose CC-BY or
CC-BY-SA when that is what a text is under. A story unpublished or
re-licensed after it lent a passage keeps it filed until
`scripts/curriculum-stories.ts` next runs and takes it back.

Two narration bugs worth not reintroducing: the generators asked for
`dialect_vocalized || arabic_vocalized || dialect`, which reads as a preference
for diacritics and is really a preference for fusha — a story converted without
tashkeel was narrated in MSA while the page showed the dialect. Both now go
through `spokenStoryLine`, which takes both dialect forms before either fusha
one.

## The learner's mistakes

`learner_errors` collects every pronunciation miss, shadowing gap, sentence-coach
failure and set-phrase mismatch, written by the scoring edge functions under the
service role. It fed the `weak` bucket in the learner profile from the start —
so the *content generators* knew what a learner kept getting wrong, while the
learner themselves could not see a single row.

`/mistakes` (`src/pages/Mistakes.tsx`) is the read side. Rows are grouped by
target rather than listed raw — six misses on one word is one problem, not six —
and ranked by count then recency, in `src/lib/mistakes.ts` (pure, unit-tested).
Each entry shows what you were aiming for, what came out, how often and how
recently, with TTS on demand to hear it correct.

Reads and writes are asymmetric, as with grammar mastery: the client may read
its own rows and set `resolved_at`, and nothing else. `20260726140000` revoked
blanket UPDATE and re-granted it on that one column, because `target_arabic` and
`detail` feed the learner's own content generation.

The page also carries the **fossilization drill** ("Drill these"): errors
persist precisely because they rarely impede communication enough to get
corrected, so `mistake-drill` builds forced-choice items in which the
learner's *own recorded production* sits next to the correct form, then asks
for a typed production. Only the production resolves the underlying rows
(checked by normalised Arabic similarity, server-side); a failed production
records a fresh `mistake_drill` error. A "Fix a stuck mistake" task joins the
Today queue once three distinct unresolved targets have accumulated.

## The plateau features

A cluster of features built from a verified research pass on the
intermediate-plateau literature — what is confirmed, contested, and genuinely
unresearched for dialectal Arabic is written up in
`docs/plateau-research-2026-09.md`, and the implementation plan in
`docs/plateau-plan-2026-09.md`. The short version of the design constraints:
speed and pause measures carry the fluency signal while repairs must never be
scored; no Arabic fluency norms exist, so nothing here shows a fluency
"score" — learners see trends against their own history, and the stored raw
metrics are the future calibration corpus.

**Monologue** (`/monologue`, Speak skill): the learner talks freely to a
dialect prompt for a level-scaled stretch — short paired prompts at A-level
(beginners demonstrably cannot fill long recordings), a couple of minutes at
B, the 3–5 minute free-form ask only at C (`src/lib/monologueTasks.ts`, the
policy is tested). Prompts come from `monologue-prompts` (askBrain over the
learner profile, degrading to a handwritten per-dialect bank);
`score-monologue` transcribes with Soniox for word-level timings (Munsit as a
text-only fallback that says plainly the attempt carries no timing metrics),
computes utterance-fluency measures in the pure
`_shared/fluencyMetricsCore.ts` (speech rate, articulation rate, mean length
of run, a pause inventory that keeps every gap's position so better
Arabic-aware location coding can be re-derived later), and stores the attempt
in `monologue_attempts` (owner-read RLS, service-role writes).

**Chunks**: `set_phrases` is the app's formulaic-sequence deck, and it now
schedules recognition and production separately — the same seven
`production_*` FSRS columns as the word decks, on `user_set_phrases`. Choice
answers grade recognition (a confident one unlocks the speaking track);
spoken answers grade both tracks (`buildPhraseReviewRow` in
`useSetPhrases.ts`, pure and tested). The quiz surfaces phrases due on either
track, and its new picks prefer occasions the learner has saved least from —
the counterweight to the "phrasal teddy bear", where learners cling to a few
safe phrases. The learner profile carries the chunk deck too: matured chunks
are offered to generators for verbatim reuse, and chunks due for speaking get
an explicit "open a natural moment for these" instruction.

The deck is *sourced* from the app's own reviewed content — no published
formulaic-sequence list exists for any Arabic dialect, so the compound marks
native reviewers leave in transcripts (`WordToken.compoundRef`) are the
inventory. `/admin/chunks` mines them (`src/lib/transcriptChunks.ts`, pure
and tested), ranked by how often reviewers marked each phrase, deduplicated
against the deck across spelling variants, and promotes one to a `set_phrases`
draft in a click — sourcing, not publishing; the editorial pass on
`/admin/set-phrases` still decides what ships. The lesson importer flags
multi-word vocabulary entries the same way, since a phrase filed as a word
never gets a spoken production schedule.

**Shadowing reps**: the Shadow tab runs ~5 repetitions of the same clip (the
literature's one dosage finding) with a per-clip score trace, advancing on
auto-advance at the target rep count or when takes stop improving
(`repsComplete` in `src/lib/shadowScoring.ts`). Both shadowing surfaces score
through the clip-anchored Munsit transcript path, and the result presents
itself as *closeness to the clip* — a transcript is evidence about word
choice, not pronunciation, so no per-phoneme claims appear there. Takes are
persisted to `shadow_attempts` (owner-read, service-role writes from
`score-shadow-attempt`), which is also the history that will let gain
durability be measured — the literature never has.

**Speaking gap**: `/analytics` shows the receptive/productive gap — words
mature on recognition vs. mature on production, computed across both word
decks in `computeProductionGap` (`src/lib/srsStats.ts`) from the dual
schedules the decks already keep. The intermediate plateau's first feature,
measured rather than asserted.

## Assistant context

The Ask AI tutor — text chat and live voice — used to see four strings, the
longest capped at 1500 characters. On a video that string held exactly one
subtitle line, so "what did he mean earlier?" had nothing behind it. Context is
now layered, and each layer is separately defeatable: every one of them
degrades to "the tutor knows a little less" rather than to an error.

**The page.** `usePageAiContext` publishes a structured payload rather than a
blob: `content` (the line in focus), `document` (the whole transcript, article
or passage it sits inside), `meta` (level, dialect, vocabulary, grammar points,
cultural and visual context) and `position` (line 12 of 48, 0:47 of 3:10).
`_shared/pageContextCore.ts` renders and budgets it, and is shared verbatim by
the client and both edge functions — the client's caps are a courtesy, the
server's are the boundary.

Every page answers, one way or another. A page that publishes nothing falls
back to its route's `PAGE_HINTS` blurb through `ROUTE_HINTS` in
`src/lib/pageAiContext.ts`, and `src/test/askAiCoverage.test.ts` fails when a
learner route has neither — which is how a run of pages ended up telling the
tutor nothing but the app's name and a URL. Listing pages (the feed, the story
library, the saved decks) use `listingContext`, which publishes the rows
actually on screen with the real total beside them, so "which of these should I
watch?" has something to answer from. The pages built around a single piece of
content are held to a higher bar than the fallback: the same test names them and
requires a real registration.

**The button is part of the contract.** The disc (`AskAiFab`), Cmd/Ctrl+K
(`AssistantMount`) and the panel all read one list, `ASSISTANT_OFF_ROUTES` in
`src/lib/assistantRoutes.ts` — two hand-copied lists is how a page gets a button
that opens nothing. Being mounted is not the same as being reachable: the disc
sits at a fixed `z-[46]`, above the dock (`z-40`) and the feed's inline video
player (`z-[45]`) and below the modal layer (`z-50`), because an opaque
full-screen overlay above it hid it completely on the feed while every
assertion about the button still passed. The route sweep (`e2e/routes.spec.ts`)
now hit-tests the disc on every learner route rather than merely asserting it is
visible.

**The tutor's own Arabic is reviewed after it has been said.** The chat
streams, and that is precisely what left its Arabic unchecked: `askBrain` can
run a repair pass and a native-speaker validator *before* it ships a draft,
while a stream has been read by the time anyone could judge it. The MSA-leak
repair in `streamBrain` looked like the missing gate and was not — its
corrected text only ever reached `onComplete`, which is the memory rewrite, so
the learner watched the leaky text arrive token by token and nothing they saw
was ever corrected. So the judgment now happens after the answer:
`_shared/arabicReview.ts` sends the Arabic runs the tutor *wrote* to the
Arabic-native roster through `judgeWithArabicNative`, and what comes back is
appended to the same SSE response as an app frame (`arabicReviewCore.ts`, which
the browser imports verbatim) and rendered beside the reply as a note.

Three decisions hold it up. It is a **note, not a rewrite** — the learner has
already read the answer, and silently replacing it would make the assistant
appear to have said something it did not; both readings stay on screen,
attributed, so a learner who knows better can see that the reviewer is the one
that is wrong. Arabic **quoted from the page is never reviewed**: a transcript
line, an authored lesson, a story is a native speaker's own words, and
"correcting" it would have the app telling a learner that the clip they are
watching is wrong — `selectReviewTargets` matches quotations through the vowels
a tutor adds when it re-types them. And **every failure is silence**: no
Arabic-native model configured, a refusal, a reply the parser cannot read, a
suggestion identical to the text, the 8-second deadline — all of them end as no
note rather than as a bad one. `CHAT_NATIVE_REVIEW=off` switches it off without
a deploy.

This is also the honest answer to "should an Arabic-native model serve the
chat?" M3 and Jais 2 are better at Arabic than the model writing the English
around it, and neither can serve `DEFAULT_CHAT`: M3's preview tier has
streaming off and adds latency, Jais 2 scales to zero, and `canFallBack` is
false for both, so either as the chat model would put a learner-facing request
on a single unbacked route. Here they are additive by construction — one short
classification call, off the critical path, on text that has already shipped.

**A conversation belongs to the page it was started on.** It used to outlive
every navigation, so a question asked about a video was still sitting in the
panel — seed sentence and all — when the disc was tapped three screens later,
and clearing it by hand was the only way to ask anything else. Leaving the page
with the panel closed now ends it; leaving with the panel *open* does not, since
that conversation is in use. Page context is scoped the same way: registrations
carry the route they were made on, so a page that unmounts late cannot clear its
successor's context and a page that publishes none cannot inherit its
predecessor's.

**History.** Ending a conversation is only safe because none are lost.
`ChatTab` writes each completed turn to `saved_chat_conversations` as it lands
(one row per conversation, updated in place — not a row per turn, and not a
debounce, which would lose the last answer to exactly the navigation that ends
the chat). The panel's History button lists them newest-first and puts one back
in the panel to carry on with; `/saved-chats` is the full archive, with rename
and delete. The table kept its name from when this was an opt-in "Save
conversation" bookmark — there is no Save button any more, because keeping a
good explanation is no longer a decision anyone has to make mid-question.

Long documents are windowed, not truncated. `slice(0, N)` keeps a transcript's
opening and throws away the part being watched; `windowDocument` grows a
contiguous window outward from the focused line, reserves a short head so the
material stays identifiable, and reports what it dropped as
`… 14 lines omitted …`. That marker is load-bearing: a model shown two
non-adjacent lines with no gap between them reads them as consecutive and then
explains a transition that never happened.

**A live call survives a wobble.** WebRTC's `disconnected` is transient — the
browser raises it when ICE consent checks go unanswered for a few seconds and
clears it again on the first packet through — so `useOpenAIRealtime` holds the
call open for `ICE_RECOVERY_GRACE_MS` and only gives up if the window really
elapses or the connection reaches `failed`. Treating `disconnected` as terminal
is what ended calls on a wifi hiccup, and reliably read as "the call timed out
after about a minute". The peer connection is also given STUN servers, which a
bare `new RTCPeerConnection()` has none of; there is deliberately no TURN, so a
network that blocks UDP outright still cannot place a call. The entitlement
gates in `VoiceTab` are skipped for a call already in flight for the same
reason: the subscription refresh polls once a minute, and one wrong answer used
to replace a live conversation with the paywall while the audio kept playing.

**Live voice stays in sync.** A Realtime session's instructions are minted once
and carry the dialect rulebook and learner profile, so they are deliberately
not rebuilt from the browser. Instead the document goes out at mint time and
position changes are added to the conversation as notes over the data channel
that is already open (`serializeFocusUpdate`), throttled and only on a real
change. Without this the tutor is frozen at whatever was on screen when the
call connected.

**Two live-voice engines, one function.** `realtime-session-token` serves either
GPT-Live (`gpt-live-1`, the default) or OpenAI Realtime (`gpt-realtime-2`,
reached by setting the `VOICE_ENGINE` secret to exactly `realtime`). The flag
reads as an opt-out rather than an opt-in so that which engine serves a call
does not depend on a secret being present on every environment; the cost is
that a typo now lands on the engine without the Arabic-tuned ASR, which is what
the rollback value is for. GPT-Live is not a model swap: the model
that speaks and the model that reasons are separate, so the single Realtime
prompt becomes two — speaking rules on the voice layer, procedure and page
context on a delegated backend — and the dialect rulebook goes in *both*,
because the backend's draft is paraphrased aloud and a فصحى draft is a فصحى
answer. Practice mode takes `client` delegation (no tools, so no backend to
bill); the Ask AI assistant takes `responses` delegation, which is the near-exact
shape the Realtime path already had. GPT-Live also marks no turn boundaries at
all — full duplex means no single moment ends a turn — so turns are rebuilt from
timed transcript deltas by `src/lib/liveTranscriptGrouping.ts`, which matters
beyond display: a turn that never closes is a mistake the drill never sees.
Everything before the engine branch is shared, which is why both live in one
function. Which engine actually served a call is recorded twice — a log line
from the mint and a `feature_metrics` row (`live-voice` / `session_minted`,
with a matching `call_ended` carrying the duration) — because nothing else
persists it: `voice_usage` stores minutes and mode, and the engine was
answerable only from the browser's network tab while the call was still open.
The two panels name it in their footer for the same reason. The config shapes and the two prompts are in
`_shared/liveVoiceCore.ts`; `docs/tts-voice-routing.md` covers what GPT-Live
gives up (Arabic-tuned ASR and `semantic_vad`) and why no engine can use a
Munsit voice.

**Retrieval.** `content_embeddings` and `match_content()` shipped in Sprint 3
and nothing read them. `_shared/contentRetrieval.ts` is the reader: it embeds
the question, takes the nearest material in the learner's dialect, keeps one
match per source, and drops anything under a similarity floor — a
nearest-neighbour lookup always returns *something*, and without a floor the
tutor reports the closest row in the library as related.

**Tools.** `_shared/assistantTools.ts` gives the tutor `read_source` (the web
page the app's content was made from, via Firecrawl), `search_library` and
`get_word_history`. Chat reaches them through a pre-flight router
(`assistantToolRouter.ts`) because `streamBrain` has no tool loop; voice
declares them on the Realtime session and relays calls through the
`assistant-tools` function.

`read_source` is the one to be careful with. The model choosing the URL has
scraped third-party text in its context, so the URL is not a free parameter:
the caller passes the URLs the learner's own screen points at, and the
allow-list holds exact addresses — not domains, not prefixes. "The host
matches, so the path is fine" is the reasoning an injected instruction would
reach for. Everything a tool returns is framed as untrusted data, and a refused
or failed lookup is shown to the model rather than dropped — swallowing it is
how an assistant ends up inventing the contents of a page it never read.

**What's on screen.** Half of an Arabic meme is text burned into the frame and
never spoken. `extract-visual-context` OCRs those overlays with their timings —
for every uploaded video file, not only the ones ticked as memes, because POV
captions and title cards turn up on ordinary clips just as often.
`discover_videos.visual_timeline` keeps the timings, and the player resolves the
current moment as playback advances (`_shared/visualTimelineCore.ts`).

That column, not `transcript_lines`, is where the overlays live. The pipeline
used to append them to the transcript, which made a caption indistinguishable
from something a person said: line-by-line playback seeked to audio that was
never recorded, shadowing offered a recording of silence, and the tutor answered
"what did they say" with text nobody spoke. `_shared/onScreenText.ts` holds the
split — what counts as an overlay, how it is taken back out of a transcript
written before the change, and the OCR prompt both read paths share. The player
shows them as their own "Text on screen" section above the transcript.

`reextract-on-screen-text` is the way back for a video whose overlays were
missed. The first read happens in the admin's browser at upload time, off the
file they still hold; by the time anyone notices a caption is missing, nobody
has that file. So it fetches the video from its source (`download-media`'s
`wantVideo` mode) and has Gemini read the whole thing rather than sampled
stills — which is what catches the punchline that landed between two samples.
It also pulls any overlays an older run buried in the transcript back out.

**Audio that isn't Arabic.** Every ASR engine in the pipeline is pinned to
Arabic, so none of them can report "that was an English song" — handed one, they
answer in Arabic script anyway. Left alone that becomes a transcript, a
vocabulary list and a difficulty rating for words nobody said, worst of all on
memes, where the joke is written on screen and the audio is a trending track.
`_shared/arabicSpeechGate.ts` decides: the script reading catches engines that
gave up and wrote Latin text, the model's own verdict in the merge call catches
the ones that hallucinated Arabic over music, and where neither is sure the
transcript is kept. Arabic singing is not a failure case — a learner studying an
Arabic song wants the lyrics. A refused video still completes, with its
on-screen text intact and a note saying why the transcript is empty.

**Between sessions.** `learner_ai_memory` holds short notes per learner per
dialect — what keeps confusing them, which kind of explanation lands — written
by a small model after the answer has streamed, inside `waitUntil`, and only
once enough turns have passed to be worth the call. The notes are rewritten
rather than appended to. They are also the least reliable thing in the prompt,
so the block hedges hard: a hint, never a fact, dropped the moment the learner
contradicts it. Settings shows a learner exactly what is remembered and lets
them erase it; the table has SELECT and DELETE policies for them and no INSERT
or UPDATE, because a client-supplied "here is what you remember about me" is a
prompt-injection surface with a database behind it.

## Talking a video through (the debrief)

Under every Discover video sits a "Check what you understood" card. It opens
`/debrief/:videoId` (`src/pages/VideoDebrief.tsx`): a guided chat with the
tutor about the video just watched, in up to six steps shown as a checklist —
**the gist**, **what happened** (a few comprehension questions), **your words**
(a quiz), **say it** (shadow one or two lines), **your questions**, and a
**recap**. The tutor runs each step in the chat and ends it with a
`[[STEP_DONE]]` marker that the page turns into a Continue button; the learner
can skip ahead at any time. Subscribers only (`requireActiveSubscription` in the
function, `RequireSubscription` on the page, `video_debrief` in
`featureAccess.ts`), and the floating Ask AI button is off there — the page is
already a tutor.

Two layers feed it, and the split is the point:

- **The study guide** is per video and the same for everyone: a summary, a gist
  question and two to five comprehension questions *with their answer key and
  the lines that answer them*, lines worth shadowing, talking points, and the
  expressions worth explaining. A model reads the whole transcript and its
  translations once (`_shared/videoStudyGuide.ts`) and the result is cached in
  `video_study_guides` — service-role only, since it holds the answers. So a
  debrief turn carries the guide plus only the transcript lines it cites (and a
  neighbour either side); only the open-questions step, where any moment is fair
  game, sends the whole transcript. The guide records a hash of the transcript
  it was written from, and a reviewer's later edit makes it stale; it is
  rewritten the next time anyone opens the debrief.
- **The learner's marks** are live and read server-side on every request: the
  words they saved from this video (`user_vocabulary.source_video_id`, new; older
  "discover" rows are matched by the sentence they were saved with), the words
  they tapped for a meaning and did not save (`video_word_lookups`, written
  fire-and-forget from the word popover), and the video's key vocabulary to make
  up the number. Saved first, then looked-up, then key words, five at most.

Guides arrive three ways: the ingest pipeline asks `video-study-guide` for one
after the CEFR rating; an admin's **Prepare debrief guides** button on
`/admin/videos` walks the existing library by cursor, two videos per request;
and the debrief writes a missing or stale one on the spot (the learner waits a
few seconds, once per video).

The word quiz is multiple choice, its wrong options the meanings of *other*
words from the same video (`buildWordQuiz`); with too few to choose from, a card
becomes recall. A quiz answer on a **saved** word is a recognition review of its
flashcard — the same FSRS call, retention target and fitted weights as My Words
(`useDebriefWordReview`; right = Good, wrong = Again), and a first rating spends
one of the day's new cards. The shadowing card is the video page's
`LineShadowPanel` with `recordAttempt={false}`, reporting the learner's best
take. Every finished card is reported back into the conversation in words the
tutor's prompt tells it to expect (`describeQuizResults`,
`describeShadowResult`), so it can explain a missed word through the line it
came from. The tutor pitches its language by CEFR: English with each question
repeated in dialect at A1–A2, mostly dialect with glosses at B1–B2, dialect
throughout from C1. Its own Arabic gets the same post-stream native-speaker
review as the Ask AI chat.

Everything that decides — guide validation, staleness, word and line
selection, the quiz, the prompts — is pure, in `_shared/videoDebriefCore.ts`
(`src/test/videoDebriefCore.test.ts`); the page's half (what follows a tutor
message, what is sent) is `src/lib/videoDebrief.ts`. Edge tests:
`supabase/functions/_test/video_debrief_test.ts`; end to end:
`e2e/video-debrief.spec.ts`.

Migration `20261004120000_video_debrief` was applied to the live project on
2026-10-05 (see CLAUDE.md). Until then everything degraded rather than broke,
and still would without its tables: guides are generated but not cached,
look-ups are not recorded, saved words fall back to the sentence match, and the
backfill button says what is missing.

## Going over the day (the recap)

The debrief's next-morning counterpart. A strip at the bottom of every learner
screen — "Yesterday: 1 video, 4 new words, 2 slips" — opens `/recap`
(`src/pages/Recap.tsx`): a guided chat with the tutor over everything the app
recorded about the learner's day, in up to six steps: **your day** (the tutor
reads their file back to them), **tell it back** (retell each clip; the tutor
checks against the study guide), **your words** (a quiz on the words they saved
or looked up, through the lines they were said in), **fix a slip** (each
recorded learner error, their own form next to the right one, then a sentence
of their own), **say it** (shadow a line carrying one of their words), and a
**recap**. Same session machinery as the debrief — the `[[STEP_DONE]]` marker,
the quiz and shadow cards, `StepChecklist`/`ListenButton`
(`src/components/debrief/SessionChrome.tsx`) and `useVoiceAnswer` are shared —
over a different set of steps. `ListenButton` reads a tutor message's Arabic
run by run through `useLineAudio`, which plays a clip of silence inside the tap
before synthesis starts: its first version made the `Audio` element only once
the speech had arrived, and iOS Safari refuses a `play()` that late, so on a
phone the link spun and said nothing. A failure now shows as a toast rather
than a spinner that stops in silence. Subscribers only for the session
(`requireActiveSubscription`, `daily_recap` in `featureAccess.ts`); the strip's
summary is free, so every learner sees what they did. The Ask AI button is off
on the page, as on the debrief.

When yesterday was empty the window widens to the last seven days and the
session says so ("This week's recap"); when the week is empty too, the strip
stays away. "Yesterday" is the learner's own day: the client sends its local
date and UTC offset with every request (profiles store no timezone), and the
server ends the window at that local midnight.

**The window** (`_shared/recapWindow.ts`) is ten bounded, parallel,
fail-soft reads under the service role: `video_views` in the window (joined to
the videos' spoken lines and cached study guides; a guide is written for at
most one guide-less clip per plan), words saved (`user_vocabulary.created_at`,
with `source_video_id` where the column exists), words looked up
(`video_word_lookups`), unresolved `learner_errors`, saved words rated Again or
Hard in review, `lesson_progress`, stories read, saved Ask AI chats, the
daily-challenge score, and the tutor's open questions from `learner_ai_memory`.
Videos and lessons are filtered to the active dialect. **The plan**
(`_shared/recapCore.ts`, pure) is deterministic for a window and a seed: the
quiz is the learner's own marks only (saved from a clip, looked up, saved
elsewhere, then review slips — never topped up from key vocabulary), the
shadow lines carry their words where possible, errors are grouped by target
(`groupSlips`), and each video travels as its guide summary plus the cited
lines with a neighbour either side, under a character budget — the full
transcript never does. The plan is stored once per learner, dialect and local
day in `learner_recaps` (service-role written, owner-readable), so the strip,
the Today queue and every chat turn read the same session; where it cannot be
stored, the same plan is rebuilt per request.

**`daily-recap`** has four actions: `summary` (model-free; drives the strip
and the Today-queue row via `useRecapSummary`), `plan`, `chat` (one streamed
turn through `streamBrain`, with the plan's Arabic excluded from the native
review), and `complete` (records the card results and the steps reached;
`sanitizeOutcome` keeps nothing else). Finishing awards XP, ticks the `recap`
task in the Today queue and marks the cached summary done, which is what
takes the strip away; waving the strip off hides it for the day on that
device (`hakiya:recap-nudge:v1`).

The strip (`src/components/recap/RecapNudge.tsx`) is mounted at the app root
beside the Ask AI disc, so it anchors to the viewport on every layout; it sits
above the dock and the two floating buttons below `lg`, and between them at
the bottom edge from `lg`. It shows on routes where chrome belongs — not the
auth, admin or print routes, not the immersive ones the dock also leaves
(`shouldShowDock`), and not the recap itself.

Tests: `src/test/recapCore.test.ts` (the pure half), `src/lib/recap.test.ts`,
`src/hooks/useRecap.test.ts`, `src/components/recap/RecapNudge.test.tsx`,
`supabase/functions/_test/daily_recap_test.ts` (the window and the function),
`e2e/recap.spec.ts`. Migration `20261005120000_learner_recaps` was applied to
the live project on 2026-10-05 (see CLAUDE.md); without its table, plans are
rebuilt per request and completion is not remembered server-side.

Shapes the same window could feed next, not built: a story written from the
day's words and the clips' summaries (the daily story core with a different
word selection), a six-item mixed pack reusing the daily challenge, mistake
drill and shadow renderers, and a seventh-day digest that would be the first
writer of `weekly_recommendations`.

## Celebration songs

Finishing something is answered with a short, over-the-top song sung to the
learner by the name they set in Settings. It plays when they **finish a lesson**
(`/learn/:lessonId`), **get through a video** (the 85% mark `DiscoverVideo`
already counts as watched), **talk a video through with the tutor** (the end of
the debrief), **clear the day's tasks** (`/today`), or **earn a badge** (below).

- **`generate-celebration-song`** is the server half, a sibling of the word
  jingle: a Gemini lyric writer produces dialect lyrics that sing the name, then
  Lyria renders them (it needs `GEMINI_API_KEY`). Pure logic is in
  `_shared/celebrationSongCore.ts`. The name is the one free-text input and goes
  into two prompts, so it is cut to letters, marks, spaces, hyphens and
  apostrophes (24 characters) and the prompt tells the model it is data. What
  the learner achieved is a closed vocabulary (`ACHIEVEMENT_KINDS`) — the client
  sends a kind and an optional number, never a sentence.
- **Cost is the constraint.** Each song is a full Lyria generation, so the daily
  allowance is tight (3 free, 10 standard, 30 all-in) and the client sings **once
  per thing finished**: `lib/celebrationSong.ts` remembers each lesson, video and
  day in localStorage (with an in-memory copy for private windows), so replays,
  reloads and re-renders never pay twice. A spent allowance, a missing name, a
  filtered generation or an outage all end silently — the song is a bonus and
  never an error on the lesson the learner just finished.
- **Where it is wired.** `hooks/useCelebrationSong` is the one entry point; each
  page calls `celebrate({ kind, entityId })`. "Cleared the day's tasks" is
  derived rather than an event, so `/today` only sings if a task was completed in
  this browser that day (`markTaskCompletedToday` leaves the mark) — opening the
  page on a day another device finished does not sing at someone who did nothing.
- **A badge song is about that badge.** When a badge is earned the celebration
  screen shows its emblem (see "Celebration screens") and the song praises the
  learner by name and sings the badge's name, in Arabic too, and what it took.
  The one rule that differs from the rest: the client sends the badge's **id and
  nothing else** (`achievement: { kind: "badge_earned", badgeId }`). The function
  checks the caller's own `user_achievements` row for it (a badge they do not
  hold is a 403 before anything is spent), reads the name, Arabic name and
  requirement from `achievements` itself, and says what it took the way
  `grant_achievement` checks it ("completing 100 Arabic word reviews"); the
  badge's text is cut down like the learner's name before it reaches a prompt. If
  that lookup fails it still sings, generally. One song per screen: the first
  badge of a screen is sung and the others are lines, and a badge never cuts off
  a song that is already playing (`onlyIfQuiet`), nor is it used up by that.
- **Switching it off.** Settings has a "Celebration songs" switch
  (`lib/celebrationPrefs.ts`, default on), and the app-wide Sound setting
  silences it too. Browsers that refuse sound not started by a tap get a Play
  button in the toast instead of a lost song.

## Grammar mastery

Vocabulary has a full SRS; grammar used to have nothing. A Grammar Drills score
was rendered on the results screen and dropped, so no part of the app knew which
*structures* a learner kept missing — only which words.

`user_concept_mastery` (created back in `20260503134531`, never written to until
now) is the ladder. `record-grammar-outcome` folds a finished drill's answers
into it, one exposure per question, keyed on the drill **category** rather than
the model's free-text `grammar_point` — the six category ids are also
`curriculum_concepts.key` values, so they're a contract: renaming one starts a
fresh concept and orphans the old history. The edge function keeps its own copy
of the id list as an allowlist so a drift returns 400 instead of quietly
splitting a learner's record.

**One key space.** `curriculum_concepts` grew two writers that both produced
`kind: 'grammar'` rows and disagreed about the key: `extract-concepts` used the
model's free-text `grammar_point` ("Negation with ما", "negation of the past
tense", "Past-tense negation" — three rows, one concept), while the mastery
ladder used the six category ids. Content was therefore tagged with concepts no
learner's mastery could join to. Both writers now go through
`_shared/grammarTaxonomy.ts`, which maps prose onto a canonical category or
slugs it when the taxonomy has no home for it. Migration `20260801150000` merges
the rows that already exist; its keyword table is a copy of the module's, pinned
by a test that parses the `.sql` and fails on drift.

The ladder itself lives in `supabase/functions/_shared/conceptMasteryCore.ts`
(pure, unit-tested) with the IO in `conceptMastery.ts`. Its one non-obvious rule:
**a wrong answer never promotes.** Strength is derived from cumulative accuracy,
so a learner sitting just under a gate would otherwise cross it *by getting the
question wrong* — one more exposure can lift the average past the threshold. A
miss demotes one rung and makes the concept due immediately.

Reads and writes are deliberately asymmetric. The client reads its own mastery
straight from the table under RLS (`useGrammarMastery`); it cannot write — that
goes through the edge function under the service role, so nobody posts
themselves a score. Both ends consume the shared core, so the UI and the server
agree on what "familiar" means.

It feeds back in two directions: `GrammarDrills` shows per-category strength and
nudges toward one category instead of six equal tiles, and `buildLearnerProfile`
carries `weakGrammar` into every generator's prompt as its own line — a shaky
word wants another exposure in context, a shaky structure wants the correct form
modelled, and blurring them helps neither.

## RBAC roles

Roles are assigned in `public.user_roles` (INSERT/UPDATE/DELETE restricted to
admins via RLS; users may only read their own role):

- `admin`: full access everywhere, including admin and Bible management.
- `content_reviewer`: can manage content workflows (transcripts / translations /
  cultural notes / dialect rules) but is blocked from Bible access.
- `transcriber`: a native speaker hired to check the AI's Arabic and English.
  The narrowest role in the app — the `/admin/videos` list and each video's
  `/admin/videos/:id/edit` page (where the review tools live, with the
  management controls hidden), and nothing else — not even
  `/admin/videos/new`. See **Transcript review** below.
- `beta_tester`: can access beta-only features.
- `bible_reader`: grants Bible reading access (except when the user is also
  `content_reviewer`).

The two path allow-lists live in `src/lib/rbac.ts`
(`canAccessContentReviewerAdminPath`, `canAccessTranscriberAdminPath`) and are
enforced by `AdminLayout`. `src/test/routeManifest.test.ts` asks those functions
directly, so a route cannot be marked reachable by a role that rbac.ts does not
actually admit — nor can a new admin route quietly become reachable by a
transcriber.

### Granting roles

`/admin/bible-access` is the role console, and every role in `MANAGED_ROLES`
(`src/lib/rbac.ts`) is grantable from it — `admin` included, so bringing on
another staff member no longer needs a psql session. `recorder` is the one
deliberate omission: it pairs with a recording setup arranged outside the app,
so a grant here would be a role with nothing behind it. The list is mirrored in
SQL by `public.is_grantable_role`, which both the grant function and the
listing function filter on; a role present in only one of the two is either
ungrantable or invisible once granted.

Grants are made **by email, and the address does not have to belong to anyone
yet.** `admin_grant_role_by_email` resolves the identifier against `auth.users`
and reports one of four ordinary outcomes — `granted`, `already`, `pending`,
`invited` — plus `not_found`, which now only a UUID can produce, since an email
with no account behind it becomes an invitation rather than an error. An
invitation is a row in `public.pending_role_grants`; the
`on_auth_user_created_apply_roles` trigger claims every matching unclaimed row
the moment that address signs up. Addresses are stored lowercased and matched
lowercased, because a mixed-case row would sit unclaimed forever while the
person signs in perfectly happily. The page lists invitations separately from
real grants and lets an admin cancel one — a mistyped address is a live grant to
whoever registers it next. `src/lib/roleGrants.ts` holds the pure half (which
outcome means what, and how it is worded) and is unit-tested; the page carries
no branching of its own.

### ID logins (no email address needed)

An email invitation assumes the recipient has an inbox they read and will
complete a signup in. For the native speakers this app depends on, that
assumption fails often enough to have cost real reviewers: the role is granted,
the invitation sits unclaimed in `pending_role_grants`, and nobody arrives.
`/admin/id-logins` is the second door. An admin mints an **ID number and a
password**, sends both over whatever channel already works (WhatsApp, in person,
a phone call), and the reviewer signs in at `/login/id`.

Underneath it is an ordinary Supabase account. The ID maps deterministically
onto an address in `ids.hakiya.app` — a domain that publishes no MX record — and
`signInWithPassword` does the rest, so sessions, JWT claims, RLS, `user_roles`
and the transcript audit trail all keep working with nothing downstream needing
to know this exists. `supabase/functions/_shared/accessCodeCore.ts` holds that
mapping plus the ID/password generation and is imported **verbatim by both the
browser and the edge function**: a second copy of the rule would be a lockout
waiting to happen.

Four things are deliberate:

- **Only `transcriber` and `content_reviewer`** may be an ID login
  (`ACCESS_ID_ROLES`, mirrored by `public.is_access_id_role`, which is what
  actually refuses the write). This is a narrower list than `MANAGED_ROLES` and
  for a different reason: the credential is minted by someone else and sent over
  a chat app, so `admin` must never be one — an admin with no inbox cannot be
  verified as themselves.
- **The password is shown once and stored nowhere readable.** The account has an
  ordinary Supabase password hash and `access_credentials` records only when it
  was last set. Recovery is an admin pressing *New password*, because there is
  no inbox a reset link could go to. That is also how a credential that leaked
  into the wrong chat is cut off.
- **Every write goes through the `access-credentials` edge function** under the
  service role; the table is admin-readable and client-unwritable, the same
  asymmetry used for scores, memories and transcript reviews. Creating an
  account, setting its password and granting it a role are exactly the
  privileges a browser session must not hold.
- **Switching one off does both halves** — bans the account *and* deletes the
  `user_roles` row. A ban alone leaves the person reading as a reviewer
  everywhere the app counts roles; a role removal alone leaves an account that
  can still hold a session. The registry row survives either way, because the
  revisions that ID signed outlive its access.

Failure ordering in `create` matters for the same reason: the auth account is
rolled back if the registry row or the role grant fails after it, since an
account whose password has already been sent and which holds no role signs in,
sees nothing, and reads to its holder as the app being broken.

Making `admin` grantable puts the removal side under the same scrutiny, so
`guard_admin_role_removal` — a `BEFORE DELETE` trigger on `user_roles`, not a
check in the page — refuses to let an interactive caller revoke **their own**
admin row or the **last remaining** one. It is in the database because RLS lets
any admin delete any role row and the console is not the only way in. Two
escapes are deliberate: a service-role caller (no `auth.uid()`) is not held to
it, and neither is the cascade from deleting the account itself, which would
otherwise turn "delete this user" into a hard error.

## Transcript review

Native speakers check the pipeline's output on the **Manage Videos** pages —
there is no separate review app. `/admin/videos` doubles as the queue (review
filters, and under a filter it sorts by how much is left rather than by date),
and each video's `/admin/videos/:id/edit` page carries the whole workspace:
checkmarks, per-line comments and history, per-line playback, re-translation,
the notes editor and the activity log. What keeps a reviewer away from the
dangerous parts is role, not address: for a `transcriber` the page hides the
management surface (publish, delete, metadata, the pipeline controls), and RLS
plus the `transcript-review` function refuse those writes anyway. The old
`/admin/transcribe` and `/admin/transcribe/:videoId` addresses redirect to the
merged pages so bookmarks survive.

The list's per-video "checked" figure is the edit page's own number
(`reviewProgress` in `src/lib/reviewStatus.ts`), not a count of review rows: a
tick left on a merged-away line, or on text that has changed since, does not
count in either place. It reads every tick in the project, so it pages past
PostgREST's silent 1000-row cap (`fetchAllRows`). Before it did, a transcriber
who had checked a few long videos saw the one they had just finished listed as
barely started. The in-memory emulator enforces the same cap, so a whole-table
read that forgets to page fails a test.

Transcript saves go through the same pipeline for every role — an explicit
**Save transcript** (or the admin's Update Video, which flushes the transcript
first): local edits are drafted on-device (`useTranscriptDraft`) with a visible
"not saved yet" state, and persisting them via `transcript-review`'s
`save_lines` is what writes the revision log. Ticking a line whose local text
differs from what is stored flushes the transcript first, because the tick
snapshots the *stored* text.

Three tables key off a line id inside the `discover_videos.transcript_lines`
jsonb array (there is no foreign key to hang them on, and turning the transcript
into rows would be a far larger change):

- `transcript_line_reviews` — the human checkmark. It stores the Arabic and
  English that were signed off, which is what lets the workspace show a tick as
  **stale** once the line changes. Without that snapshot a tick outlives the
  words it approved — and merging keeps the left-hand line's id, so a checked
  line can silently acquire words nobody read.
- `transcript_line_revisions` — the old/new audit trail. Unlike
  `transcriptDiffCore` (which builds training pairs and is right to skip what it
  cannot pair confidently), this records structural edits too: a split shows as
  a line appearing, a merge as one disappearing.
- `transcript_line_comments` — notes, better-translation suggestions and
  concerns, per line or per video. A suggestion carries the proposed English in
  its own column so it can be applied in one click.

RLS grants reviewers `SELECT` and nothing else. **Every write goes through the
`transcript-review` edge function** under the service role, which is what makes
the audit trail worth having: the diff is computed there against what is
actually stored, so a client cannot record a "previous value" that was never in
the database, and `changed_by` comes from the caller's JWT rather than from the
request body. That function's column allow-list is also the whole of what a
transcriber can change about a video — `published` is not on it.

The editor itself (`src/components/TranscriptEditor/`) is shared with the admin
video form and renders identically there; all the reviewer chrome hangs off one
optional `lineReview` prop. In review mode it adds per-line playback (play the
line, loop it, slow it down — the speed is the reviewer's own and never touches
the published video), a re-translate button per line, and a keyboard map:
J/K to move, Space to play, ⇧Space to play slowly, M to merge, ⇧X to delete the
line, R to tick, T to re-translate, C to comment, brackets to nudge timings, `?`
for the list. The map lives in `src/lib/transcriptShortcuts.ts` and both the
resolver and the help panel read it, so a shortcut cannot exist undocumented.

**Deleting a line** is offered in both modes, because it is the one thing
splitting and merging cannot do: a caption the recogniser hallucinated out of
background music, a duplicated line, or an ad read that is not part of the clip
has nothing to be merged into, and blanking it leaves an empty box holding its
slice of the timeline and an empty subtitle on screen for its whole span. The
button on the card asks twice — it is the only control there that destroys words
rather than moving them, and it sits in a row of one-character buttons — while
⇧X, a chord nobody hits by accident, goes straight through; both are one ⌘Z
away from being undone, and undo restores the line whole and in its own place.
The neighbours' timings are deliberately left alone, so the deleted span becomes
a gap the list already draws and labels rather than a boundary that moved
itself. Downstream nothing special happens: the save replaces the whole
`transcript_lines` blob, so the line is simply not in it, and
`diffTranscriptRevisions` already reports an id that has stopped existing as a
`structure` revision. Note that a `transcript_line_reviews` row or a comment
thread on a deleted line stays in its table, unreachable — that is the audit
trail keeping what it was told, not a leak.

An Arabic edit rewrites the line's **word list**, not just its text
(`retokenizeSegment` in `src/lib/transcriptOps.ts`). The card draws its Arabic
from `words` — that is where per-word confidence colouring and the split tool
live — and the video form persists each line's tokens from `words` too, so an
edit that set only `text` was invisible the moment the box closed and was
overwritten by the old words on the next save. The English underneath, a plain
string with no word layer, had always updated at once; that mismatch is what
made the bug read as "the Arabic doesn't save". The rebuild is a
longest-common-subsequence alignment, so words the edit did not touch keep the
timings the recogniser gave them; a word somebody typed is interpolated into the
gap its neighbours leave and trusted at confidence 1. Undo and redo go through
the same rebuild, and now run the debounced save, so what is on screen and what
has been reported to the page cannot disagree.

### Timing

Line timings come from **text alignment against the ASR word stream**, not from
walking indices and not from guesswork. The engines with word timestamps
(Soniox, Munsit, Scribe) return real per-word times, but the LLM merge rewrites
the Arabic, so the merged lines no longer match the token stream word for word.
`_shared/transcriptTimingAlign.ts` bridges that: both streams are normalised
with the `arabicMatch` folding, anchored on words unique to both (kept monotone
by longest-increasing-subsequence), and the gaps filled by exact, fuzzy and
split/merge matching before anything unmatched is interpolated between its
neighbours. Each line's `startMs`/`endMs` comes from the words that actually
matched — which is what keeps a pause a pause instead of smearing it across
every following line as cumulative drift — and the per-word times persist on
the line as `words` (parallel to the whitespace split of `arabic`, each entry
flagged `matched` or interpolated). When too few words match, the pipeline
falls back to the old proportional-by-character allocation: wrong in detail but
bounded, and it leaves no `words` array behind to be mistaken for real times.

A transcript can also arrive as **one line the length of the clip**. The
analysis's merge is supposed to hand back lines of a dozen words, and does;
but when the merge fails it falls back to splitting the raw ASR text on
punctuation, which Arabic ASR mostly lacks, so the whole clip lands as a
single line with no translation — and every feature that works line by line
(the caption highlight, phrase pause, shadowing, the review workspace) has
nothing to work with. Once the alignment above has put real times on every
word, the right boundaries are measurable: `_shared/transcriptLineSplit.ts`
breaks any line over `DEFAULT_MAX_WORDS` (14) at the speaker's longest pauses
first, then at the dialect's clause openers (يعني، بس، لكن، عشان…) and
punctuation, and only then evenly. The pipeline runs it after alignment, and
the analyser's own fallback runs the text-only form so it never emits a chunk
even to callers that skip the pipeline. A line of sensible length is never
touched, however long a pause it spans — its segmentation and its translation
are somebody's deliberate work. Pieces cut from a line keep its other fields
and their share of its `words` and `tokens` (glosses included), but a
translation described the whole line and cannot be divided, so a piece arrives
with an empty one flagged `needs_review` / `review_reason: "empty"`. That is
why the pipeline splits a *translated* long line only once English has been
drafted for every piece (`_shared/transcriptPieceTranslation.ts`, one call to
the `TRANSLATION` lineup, shared with the Re-sync button) and otherwise keeps
the line whole with the English it had — the first run of the splitter cut
every line the merge left over fourteen words and the transcript came through
line by line and untranslated. A line with no translation is split freely. The
analyser's rule-split fallback now also translates its lines with one cheap
call, so even a failed merge no longer arrives without English.

Three more things stand between a clip and a transcript with no English at
all, because that is what kept happening once the line splitter was fixed.
The analyser's merge, its retry and its vocabulary pass run on
`MODEL_IDS.QWEN_FAST` (`qwen/qwen3-235b-a22b`), the model they ran on until
2026-08-31; centralising the pins had moved them onto the 2.4-trillion-parameter
`QWEN` tier, whose reasoning is mandatory, and a merge that took minutes there
starved the translation ensemble that shares its 300-second budget until every
leg timed out. When the ensemble still leaves a line blank, the numbered
plain-text translator (`fallbackLineTranslate`) gets one cheap try at the
blanks, and a line it fills is marked `review_reason: "call2_fallback"` —
filled by a fallback, unverified, not disputed. And the pipeline's finalize
stage, which has a budget of its own, hands any line that still arrives without
English to the same drafter the Re-sync button uses
(`_shared/transcriptPieceTranslation.ts`) before writing the row. What each
model did is recorded in `engines_used.translation` — status, latency, the
error text of a failed leg, the fill counts, the merge model and the build of
the analyser that ran — saved with the *first* write of the transcript so a
worker torn down during enrichment cannot lose it, and shown on the video's
edit page by `TranslationProvenancePanel`. The panel also flags an analyser
running an older build than the app: the build banner probes only the
pipeline function, so an analyser left behind by a partial deploy was
otherwise invisible.

Why the merge failed in the first place is worth recording, because two
rounds of timeout tuning treated it as a timing problem — and because the fix
for it is what later made the translations read literally (see below). The lineup refresh of
2026-08-31 moved the pipeline onto models that **reason before answering by
their providers' defaults** — OpenRouter's own metadata has Sonnet 5 at
`default_effort: "high"` and Qwen 3.8 Max (the merge model) at `"xhigh"` with
reasoning *mandatory*, and Google runs Gemini 3.7 Flash at "medium" — where
every model before that date answered directly unless a request enabled
reasoning. Nothing in the app asked for it. The merge, which writes a whole
clip fully voweled inside JSON, went from a forty-second call to one that
thought for minutes and then spent its 8k-token output budget on the thinking,
so its JSON came back truncated or empty and the rule-split fallback ran. A
40-second ceiling made that failure fast (one chunk); a longer one made it
slow (a stall, see below). `aiGateway.chatFetch` now asks every model for the
least reasoning it allows — `reasoning: { effort: "none" }` on OpenRouter,
`reasoning_effort: "low"` on Google's endpoint, a model's own floor where it
cannot be switched off — unless the caller passes `reasoning: "model-default"`
or a specific effort. The floors live in `modelRegistry.ts` next to the ids
(`reasoningFloor`), and a provider that rejects the default with a 400 is
retried once without it. The analyser's own deadlines stay two-phase: 40 s
(30 s for Fanar) to headers, then a generation budget from
`generationBudgetMs` — scaled to `max_tokens`, capped at two minutes, and never
past the run's own `ANALYZE_BUDGET_MS` deadline.

**That floor had a blast radius, and the translations were in it.** It lives in
`chatFetch`, so it applied to every call `analyze-gulf-arabic` makes, and the
translation drafters had no way to ask for anything else: on the same commit
they went from Sonnet 5 at "high" and Gemini 3.7 Flash at "medium" down to
"none" and "low". For the merge and the vocabulary pass that is right — they
are extraction, the answer is already in the input, and thinking buys latency
rather than accuracy. Translation is the one job here where it runs the other
way. A model has to work out what a line *does* — a set phrase, a hedge,
sarcasm, a greeting shaped like a question — before it can pick a register, and
one answering directly takes the safest reading, which is the literal one. The
reports were of English that had become stiffer, more word-for-word and flatter
in tone, which is the shape of that loss. `callAI` now takes a `reasoning`
option and `TRANSLATION_REASONING` (default `{ effort: "medium" }`, restoring
Gemini exactly and giving Claude a real budget below the old "high") opts the
ensemble back in; `TRANSLATION_REASONING=off` returns it to the floor without a
deploy. Nothing else in the function asks for it, and a test pins both halves.

Two other things were pushing the same way, and both are fixed alongside it.
`mergeOneLine` published the **longest** member of an agreeing cluster, on the
reasoning that longer is "most detailed" — but for translation the correlation
is inverted: an idiom rendered as an idiom is shorter than the same line
rendered word by word ("شد حيلك" is "hang in there"; unpacking it is
"tighten your strength"). So on every line where the peers agreed on the
meaning and differed on the register, the ensemble picked the most literal
register available to it. It now publishes the cluster's **centroid** — the
member with the highest mean token overlap with its peers — breaking ties
toward the heavier model and then toward the *shorter* text, which is the
old rule exactly inverted. And the drafters are asked for the natural
translation and the word-for-word gloss in one JSON object, which is a standing
pull toward writing one like the other; the prompt now separates them and
spells out register, emotional colour and "don't explain or expand", under an
accuracy clause that still outranks all of it — natural is how you say it, not
what you say. Note the separation is about how each is *derived*, not about
how they come out: the rule asks for the translation to be written first and
independently, and says outright that the two may coincide where a line's
natural English really is its word-for-word reading ("نعم" is "yes"). An
earlier draft demanded they "must NOT resemble each other", which is
unsatisfiable on those lines and invites a drafter to pad the gloss or
paraphrase the translation to manufacture a difference — the same expansion
the accuracy clause forbids.

Note what is deliberately *not* changed: `callAI` still sends
`temperature: 0.2`. Temperature is the knob that trades fidelity for flair, and
the complaint was never that the English was dull — it was that it was literal.

The clustering measure is worth a warning, because the obvious improvement is
wrong. `mergeOneLine` clusters on plain `jaccard` and not on the arbiter
module's stricter, stopword-stripped `contentSimilarity`, even though the two
sit in the same file. They answer different questions: the arbiter asks whether
a third-party MT rendering *backs* a candidate, where both sides legitimately
pick different words and function words are noise; clustering asks whether two
renderings are the same reading, and there the function words are the reading.
`contentSimilarity` scores "Where have you been" and "Where were you" as
identical — and "he told her" and "she told him" as identical too. It was tried
and reverted on 2026-09-16.

The pipeline reads the *row*, never the analysis's HTTP reply — the gateway
drops that at 150 seconds while the analysis runs on — so every outcome the
analysis can end in has to be written to the row or it did not happen. A merge
that failed after the reply was dropped, or an error thrown late, used to leave
the row on `processing`; the pipeline then waited out the platform's whole
wall clock, started the analysis again, waited again, and failed a quarter of
an hour later with "started 2 times and never saved a result". Now a failed
merge persists its rule-split lines as `analysis_complete` with a note saying
so (which the finalize stage keeps rather than overwriting with its own empty
one), and a thrown error marks the row `failed` at once.

After a reviewer has corrected the text, the text is ground truth and the
timing is not — so the workspace's **Re-sync timing** button runs *forced
alignment*: `resync-transcript-timing` sends the editor's current lines
(unsaved draft included) and the staged audio to ElevenLabs' forced-alignment
endpoint, maps the timed words back through the same anchoring module, and the
proposal lands in the editor's diff preview. It runs the same line splitter
afterwards, so pressing it on a one-line transcript is what turns it into
timed lines; the new pieces name their parent in `splitFrom` (response only,
never stored) and get their English drafted in one call to the `TRANSLATION`
lineup — best effort, so a model that is down costs the pieces their
translation, never the re-sync, and the toast says which happened along with
how many words the aligner placed. Accepting persists through `save_lines`
with revision source `resync`, so a machine re-time is distinguishable from a
native speaker's judgement in the history. The function refuses audio that
doesn't fit the transcript (a trust gate on the match ratio) rather than
writing a confident mistake, and `save_lines` itself now refuses timings the
player can't use: a NaN from a half-typed field, a line ending before it
starts, a timeline running backwards. Gaps between lines are legal — with
honest timings they are silences, not errors. A 404 from the button is named
for what it is: a backend that has never had the function deployed.

The editor reads the persisted `words` for its per-word highlight, split
boundaries and AI re-segmentation anchors, falling back to an even spread only
when an edit left them stale, and writes its word times back on save. The
Discover player keeps a deliberate `LINE_END_GRACE_MS` (500 ms) past each
line's end so captions don't flicker off during short pauses; the reverse scan
means a line that has started always beats its predecessor's grace.

### Playing a TikTok clip in step with its audio

TikTok's `player/v1` iframe is a muted picture; the sound is our own copy of
the clip's audio from the private `video-audio` bucket, which a signed-in
learner fetches through `discover-video-audio`, and that hidden `<audio>` is
the clock everything else reads: the active line, phrase-end pauses, slow
listen, view tracking. The frame is driven to the audio over TikTok's embed
protocol (`postMessage` with `x-tiktok-player: true`; the "Embed player" page
on developers.tiktok.com documents it), and how often it is driven has a
history worth knowing before touching `src/pages/DiscoverVideo.tsx`:

- `autoplay=1&muted=1` lets the frame start on its own, which is what makes it
  accept commands at all — a cross-origin frame ignores `play` until it has
  played once. That first "playing" is parked at zero before the learner has
  pressed anything.
- The frame is seeked to the audio once per play run (#212). Seeking it on
  every tick made the picture choppy and fed itself, since a fresh seek
  briefly reports a transitional position that reads as more drift (#211).
- What that left open: a frame that stalled to buffer came back behind the
  audio and stayed there for the rest of the clip, with nothing to say so. The
  player's own `onCurrentTime` reports are now held against the audio by
  `src/lib/tiktokFrameSync.ts`, and the frame is re-seeked only when they
  disagree by more than 0.4 s on two consecutive reports, never within 1.5 s
  of a seek. Normal playback never trips it.
- `onPlayerError` 3002 (muted autoplay refused) puts the "tap the video" hint
  up at once rather than after the four-second retry budget: without the
  autoplay, no command will start the frame.
- The signed audio URL lasts four hours, not the ten minutes it first shipped
  with — a learner in phrase mode reached the expiry mid-clip, the audio
  stopped dead and the muted frame rolled on. The page also asks for a fresh
  URL on a playback error and resumes from the same second, and slow listen
  retries once the same way. The URL is resolved per video id rather than per
  row object, so a refetched row cannot swap the element's source under a
  playing clip.

The handshake runs against a stand-in player in the hermetic suite
(`e2e/support/fakeTikTokPlayer.ts`, driven from `e2e/discover.spec.ts`) that
speaks the same protocol, keeps a clock, and can stall, refuse autoplay and
take a tap. Until it existed, every regression in this path was found in
production.

`discover_videos.dialect` stops at the country — "Saudi", "Kuwaiti",
"Egyptian" — which is roughly the resolution of a passport rather than of a
dialect. A Jeddah clip and a Riyadh clip land on the same label, a Ṣaʿīdi clip
and a Cairene one land on the same label, and every generator that conditions on
that label then teaches two systems at once and calls it one. Guessing Ḥijāzi
from Najdi off a thirty-second clip is one of the things the pipeline is worst
at; a native reviewer does it in a second. So the **Notes & grammar** tab of the
workspace now opens with the classification, writing two columns:

- `dialect_subvariety` — one id from `_shared/dialectSubvarieties.ts`, chosen
  from a **second dropdown that depends on the first**. Picking "Saudi" offers
  Najdi, Qassimi, Ḥijāzi, Eastern Province, Southern and Northern; "Yemeni"
  offers Ṣanʿāni, Taʿizzi–ʿAdeni, Tihāmi, Ḥaḍrami, Yāfiʿi and northern tribal;
  "Egyptian" offers Cairene, Alexandrian, Delta/Fallāḥi, the Canal cities,
  Ṣaʿīdi and the two Bedouin groups; and so on for each Gulf state, with plain
  "Gulf" offering the ḥaḍar/badu split that cuts across all of them. Two levels
  rather than one flat list is the whole design: reached from the country, no
  dropdown is more than seven long, and a dropdown a reviewer has to scroll is
  one they leave on its default.
- `dialect_features` — an array of `{ category, subvariety, title, arabic,
  lineId, explanation, contrast }`, deliberately **not** folded into
  `grammar_points`. A grammar point is what a learner should take away about
  Arabic and ladders into `user_concept_mastery`; a dialect feature answers a
  different question — *what makes this sound like Jeddah and not Riyadh* — and
  most of the answers are not grammar at all. They are a ق, a Persian borrowing,
  an intonation contour, a word that means something else one border away.
  `category` comes from its own list (sound, pronouns, demonstratives,
  article/genitive exponent, negation, verb shapes, tense-aspect markers,
  question words, relatives, prepositions, word order, lexicon, discourse
  particles, loanwords, numbers, prosody, register), kept separate from
  `grammarTaxonomy.ts` for exactly that reason — a shared key space would force
  every phonological note into "sentence-structure". `contrast` is the field
  that earns the section: "uses شنو" is a fact, "uses شنو where Riyadh says وش
  and Cairo says إيه" is what builds an ear.

The reviewer can also correct `dialect` itself, which was previously admin-only.
It is a classification rather than a publishing decision, which is the line the
allow-list has always drawn. Two consequences are handled server-side: an
unrecognised label is **refused** (there is nothing sensible to fall back to,
and silently keeping the old country while reporting success is the failure mode
most likely to go unnoticed), while a sub-variety that no longer belongs under
the new country is **cleared** rather than refused — the case that produces one
is somebody correcting a mis-tagged video, and refusing the save would leave
them with the wrong country *and* the wrong variety under it. `Emirati` is
accepted alongside `UAE` because both are already on rows; it is accepted, not
rewritten, since re-labelling a row as a side effect of saving a note would put
a change nobody made into the audit trail under their name.

All three columns are logged like any other note — `transcript_line_revisions`
gained `dialect`, `dialect_subvariety` and `dialect_features` — and the
sub-variety reaches the per-line re-translation prompt, so a Ṣaʿīdi line is not
glossed by an instruction that says "Egyptian Arabic" and leaves the model to
assume Cairo.

The **title** joined the allow-list for the same reason and was the same
oversight. The pipeline names a clip from its own transcript, so the title is
wrong in precisely the way a native speaker is hired to catch — and it was the
one field on the row a learner reads before watching anything. But it lived on
the admin-only Details card, and `discover_videos` UPDATE is
admin/content_reviewer under RLS, so a transcriber who spotted a bad title had
nowhere to put the correction but a comment somebody else had to action. It is a
label, not a publishing decision. `title` and `title_arabic` are editable at the
top of the **Notes & grammar** tab and logged like everything else there; the
English one is `NOT NULL` and read by every card in Discover, so a blank one is
refused server-side (a cleared field is a reviewer mid-edit, not an assertion
that the clip has no name), while a blank Arabic title stores null.

Unlike the dialect, the title appears there **only for somebody who has no
Details card** — `VideoNotesEditor` renders it when the prop is supplied and the
video form supplies it only once the roles have resolved to neither admin nor
content_reviewer. Two boxes over one column would be two independent drafts of
it on one page, each behind its own save button: the notes save would submit the
title that editor loaded rather than the one just typed upstairs, and **Update
Video** pressed before the refetch lands would write the Details card's stale
copy back over a rename made below. When the editor does not own the title it
leaves the keys out of the payload altogether rather than sending them
unchanged, since `save_notes` keys off the field being present.

### Unpublished drafts in the video form

The admin video form holds an entire correction pass in React state until
**Update Video** is pressed, which is long enough that a closed tab, a reload or
a background refetch of the video row used to take an hour of work with it.
`src/lib/transcriptDraft.ts` and `useTranscriptDraft` keep every settled edit in
`localStorage`, keyed per video, and `TranscriptDraftBanner` says — in those
words — that the changes are **auto-saved to this device** and **not
published**. That distinction is the whole design: a reviewer who reads "saved"
as "live" walks away believing learners have their corrections, which is a
quieter and worse failure than losing the work. So a draft is never written over
one still being offered back, never deleted except on publish or an explicit
discard, and a browser that refuses storage (private mode, full quota) is
reported rather than silently swallowed. Publishing clears the draft; a failed
save deliberately does not.

Two consequences elsewhere in the form: `beforeunload` asks for confirmation
while anything is unpublished, and the hydrate-from-server effect no longer
re-seeds the transcript once it has been edited in this session — a refetch
landing under a reviewer used to drop their work back to the stored version with
no warning.

### Video stills that stop expiring

A video's thumbnail used to vanish a couple of days after an admin added it,
and fetching it again looked like a fix — for a couple more days. The cause is
that TikTok's oEmbed does not answer with an address for a still, it answers
with a *signed* one:
`…tiktokcdn-us.com/…image?x-expires=1788613200&x-signature=…`. That timestamp
is about forty-eight hours out, so any row storing the platform's answer
verbatim showed a picture until the weekend and a broken image afterwards, and
re-fetching only minted another two-day URL.

YouTube rows never had the problem, because nothing about them is stored:
`getThumbnailCandidates` re-derives `i.ytimg.com/vi/<id>/…` from the video id
at render time. TikTok and Instagram stills cannot be derived from anything, so
the only durable answer is to keep our own copy —
`persist-video-thumbnail` fetches the image while the signature is still good
and puts it in `flashcard-images/video-stills/`, and *that* URL goes on the
row. It has to be a function rather than page code: the CDNs serve those bytes
with no `Access-Control-Allow-Origin`, so the browser can display them and
cannot read them.

Every write path goes through it — the video form's **Fetch thumbnail** button
and its saves, `ingest-shared-video` at share time, and the **Find N missing
thumbnails** backfill on `/admin/videos`. `_shared/thumbnailUrlCore.ts` is what
decides which URLs are on loan (`x-expires`, and Meta's hex `oe=` on Meta's own
hosts); it is imported by both the browser and Deno so the two halves cannot
disagree. The backfill counts a row holding a signed still as missing one,
which is what lets the library heal itself rather than being fixed a video at a
time. Two things it will not do: store a still it was given if a permanent one
already sits on the row, and store the CDN's 403 error page as though it were a
JPEG — an expired signature answers 200-shaped enough to be dangerous, so the
content type is checked before anything is uploaded. When the copy genuinely
cannot be made, the borrowed URL is kept: a picture for two days beats none.

### A transcription run that survives its worker

"I uploaded a TikTok, the transcription started, and then nothing happened
until it timed out with an error" is what a dead edge-function worker looks
like from the admin form. Supabase's wall-clock limit (400s on paid plans) is
the life of the *worker*, not the request: a worker keeps serving requests and
background tasks until it reaches the limit and is then torn down with whatever
is still running inside it, and nothing catchable is raised. So a run that
starts on a worker warmed by an earlier upload — the second video in a row, or
a re-transcribe a minute after a failure — has an unknown fraction of that
budget left. `process-approved-video` used to be one background task doing the
download, six ASR engines, a three-to-four-minute wait on `analyze-gulf-arabic`
and finalisation, on a six-minute budget of its own that assumed a fresh
worker; when it wasn't, the run died between two writes and the row sat on
`processing` with no error until the reaper failed it twelve minutes later.

Now the run is a chain of short requests to the same function, each writing a
checkpoint (`video-audio/<id>.pipeline.json`) before handing over:
`asr` (acquire audio, run every engine, pick a primary) → `analyze` (fire
`analyze-gulf-arabic`, watch the row for its `analysis_complete`) →
`finalize` (align lines to the audio, strip on-screen text, mark completed,
ask `rate-video-cefr`). A death loses at most the stage in flight, never the
engine results already paid for, and three things can pick the run back up:

- **the function itself** — each stage hops to the next with
  `{ videoId, stage }`, and an analysis that has produced nothing after the
  platform's whole wall clock is treated as dead and started again (up to
  three starts, then the row is failed with a message that says so);
- **the analysis** — once `analyze-gulf-arabic` has saved its result it calls
  `{ videoId, stage: "finalize" }`, so finishing the transcript no longer
  depends on the pipeline's worker still being alive minutes later;
- **the admin pages** — `/admin/videos` and the edit page already poll a
  mid-run row; `usePipelineResume` (decision in `src/lib/pipelineResume.ts`)
  sends `{ videoId, resume: true }` when a row has stopped moving for longer
  than a live run ever goes quiet. Live runs touch the row every 30s (a
  heartbeat during the engine fan-out and the analysis wait), so "two minutes
  without an `updated_at` change" is a dead worker, not a slow engine.
  `pending` is left alone for ten minutes, because the form holds a row there
  for as long as a large upload takes.

A resume never repeats paid work: it reads the checkpoint and continues from
the stage it names, and a row that is already completed or failed is left
alone (**Download & Re-transcribe** is the deliberate fresh start). The
finalising write is conditional on the row still being where the stage
expects it, so the pipeline's own poll and the analysis's callback racing to
finish produce one transcript and one rating. The reaper in
`reap_stuck_video_transcriptions` still runs underneath all of this, as the
last resort when no page is open and no callback arrived.

#### Telling one stall from another

A transcription that never finishes produces the same report — a spinner —
whether the worker died, the stage hop was refused, the analysis is genuinely
slow, or an older copy of the function is still deployed. Those need different
fixes, so the pipeline says which one it is on the row itself.

`process-approved-video` writes `engines_used.pipeline` on every stage
boundary and every heartbeat: the `stage`, a `note` in the admin's words
("waiting for the analysis (90s)"), the analysis `attempt` count, whether the
stage had to run `inline` because a hop was refused, an `at` timestamp, and
`build` — a marker naming the deployed copy of the function. The video edit
page renders that as one line under the in-flight banner, and
`src/lib/pipelineProgress.ts` is the pure half that reads it. No migration was
needed: `engines_used` already existed and the page already read it.

Three readings and what each rules out:

- **The build is one you don't recognise, or the line is missing entirely.**
  The deploy did not land, and nothing else in the report means anything yet.
  Redeploy `process-approved-video` and `analyze-gulf-arabic`.
- **"running without stage checkpoints".** Every hop is being refused, so the
  run has degraded to the single long task this design replaced and a worker
  teardown will kill it silently again. The hop is a service-role call to
  `process-approved-video`, which is the one function in this pipeline with
  `verify_jwt = true`; a non-JWT service-role key is rejected at the gateway
  before the function runs.
- **The step is named and "last moved" keeps advancing.** The run is alive and
  merely slow; the step says which part to look at.

The build marker also rides on every HTTP reply the function sends, so the
same question can be answered from a single call without opening a video.

#### The analysis has its own wall clock

`analyze-gulf-arabic` is the long pole, and it used to persist exactly once,
after every optional stage had run: the merge, a translation ensemble, a Fusha
waterfall that walks several models in turn, an Arabic-native arbitration of
the disputed lines (HUMAIN M3, Jais 2 or Fanar — whichever is configured and
answers — asked outright which candidate is right, before Shaheen sees what is
left; see `docs/humain-m3-integration.md` §1d. Jais is paused as of 2026-09-18
and so is never the one that answers — see `JAIS_ENABLED` in
`docs/deployment.md`), up to four sequential 30-second
Shaheen arbitration calls, an analysis retry, then vocabulary and gloss
enrichment. That chain can outlast the 400-second wall clock, and a worker torn
down inside it wrote nothing at all — every model call paid for, and the
pipeline left waiting on a row that would never change. This was the actual
cause of "stuck on waiting for the analysis at 400 seconds".

Two changes, and the second is the one that matters:

- **A budget.** `ANALYZE_BUDGET_MS` (300s by default, against the platform's
  400s) is set when the request starts working, and every optional stage asks
  `haveTimeFor` before it begins. The Fusha waterfall, the arbitration loop and
  the enrichment all yield rather than start work they cannot finish, and each
  skip is logged with the time remaining — a transcript that comes back without
  its Fusha row has to say why, or the next person reads a deliberate skip as a
  broken feature.
- **A save before the embellishments.** Once the merge, translations, grammar
  and context are settled, the row is written with `analysis_complete` before
  the enrichment runs. Everything after that point improves a result that
  already exists, so a teardown costs the enrichment rather than the run. The
  pipeline is polling that row, so a run that dies immediately afterwards still
  completes, with plainer vocabulary.

The two interact, which the late write has to know about: the early save can be
picked up and finalised by the pipeline while the enrichment is still running,
and those lines then carry audio timings this function does not have. So the
final write checks the row first and, on one already `completed`, updates only
what the enrichment improved rather than pushing a finished row back into a
working state.

For the same reason the pipeline now allows two analysis starts rather than
three: each start that ends in a teardown costs a full wall clock of waiting,
so a third only turns a fourteen-minute spinner into a twenty-minute one.

The ASR stage has the same shape of problem in miniature. Six engines run in
parallel and the stage takes the slowest, so one engine having a bad day set
the pace for the whole run — up to its own 150-second ceiling, whatever the
other five managed in twenty. `PIPELINE_ASR_FANOUT_MS` (120s) drops the
stragglers, since the merge arbitrates between whatever transcripts it is
given and has never needed all six. The one case where it does not apply is
when no engine has produced text yet: with nothing in hand there is nothing to
move on with, and waiting beats failing the run for want of patience.

## Trending (free social harvest)

`/trending` shows what the Arab world is posting right now: per-country X trend
chips plus real Telegram/Reddit posts, every one screened for dialect before a
learner sees it. The design constraint was **zero API spend** — X's API moved
to pay-per-use in 2026 ($0.005/post read; the Trends endpoint needs the $5k/mo
Pro tier) — so each platform gets the free route that actually exists:

- **X** — account timelines *and* post bodies, through X's own embed backend
  (`syndication.twitter.com`), free and keyless. The first cut of this feature
  said bodies were unreachable and shipped X as topic chips only, which is why
  every word of Arabic in the pipeline came from Telegram news channels. They
  are reachable; search is not. **See [`docs/x-content-pipeline.md`](docs/x-content-pipeline.md)**
  for the fetch contract, the rate limits, and the research loop that fills the
  account registry — that doc is the current source of truth for anything X.
- **X trends** (platform key `x_trends`) — trending *topics* per country,
  scraped from getdaytrends.com via Jina Reader. Chips link out to
  `x.com/search` instead of embedding, which keeps us inside X's terms. Yemen
  has no X trend location at all.
- **Telegram** — public channel previews at `t.me/s/<handle>`, no key needed.
  The richest free source for Yemeni content, and where view counts come from.
- **Reddit** — top-of-day posts from country subreddits through a free
  registered app (`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, client_credentials
  grant). Reddit blocks anonymous datacenter fetches, so without the secrets
  the platform is skipped with a metric, not an error.

The pipeline is `harvest-social-trends` (edge function) over three tables:
`social_content_sources` (the curated registry of subreddits/channels/trend
slugs, per dialect, `candidate → approved → rejected` like `content_channels`),
`trending_topics` (one row per country/topic/day) and `social_posts`.

**The free filter runs before the paid one.** `_shared/socialPrescreen.ts`
bins text with no Arabic, text too short to teach anything, and text in which
nobody is speaking — no dialect evidence, nothing in first or second person,
and either a newsroom marker or the length of a headline — before any of it
costs a model call. It composes `dialectMarkers.ts` rather than repeating its
lists; what it adds is *register*, which is what actually separates a tweet
from a headline. Measured on live timelines, 81% of a singer's Arabic tweets
clear it against 27% of a newspaper's, and that ordering falls out of who is
writing without the filter knowing anything about the accounts.

**A human publishes; the AI only triages.** Post lifecycle:
`pending` (harvested) → `screened` (passed the askBrain triage, UTILITY
lineup, forced tool call — which also produces the English translation) →
`approved`/`rejected` by a content manager on **`/admin/social-trends`**, the
review queue with status tabs, dialect/platform filters, the screen's own
verdict shown per post, and the Run-harvest button. Triage is deliberately
generous — "mixed" register and low-confidence dialect calls go to the queue,
only clear MSA and non-Arabic are binned — because with a person deciding, a
full queue beats the strict auto-publisher that starved Gulf (its sources
lean news-register). A screen outage leaves rows pending for the next run.
The whole feature is admin-side: reads require `can_manage_content()`, and
there is currently no learner surface at all.

**Screening runs per dialect with a target** (`targetPerDialect`, default 5):
each run works the neediest dialect first and keeps screening that dialect's
pending queue — fetching older Telegram pages via `t.me/s/…?before=` as
needed — until it has enough posts awaiting review, its queue runs dry, or
the run's call/time budget (`maxScreenCalls`, 100s) is spent. The response
reports `review.<dialect> = {target, have, queueEmpty}`, which is the
add-more-sources signal when a dialect can't fill its quota.

**Sources can be proposed by an agent, never approved by one.** There is no
free X search, so *which* accounts write Yemeni or Egyptian is a research
question rather than an API call. `scripts/discover-x-sources.ts` takes a
bundle of proposed handles and posts (from Claude Code doing the research),
probes every handle live, and posts the survivors to the `import-x-bundle`
edge function. Sources land as `candidate` and posts as `pending`; a proposed
post's text is re-fetched from X rather than believed, and a re-import never
changes the status of a source a human already judged.

Scheduling follows the clip pipeline's convention: nothing in-repo fires it.
Call it daily with the `x-harvest-secret` header (`SOCIAL_HARVEST_SECRET`
secret), e.g. `POST /functions/v1/harvest-social-trends {"platform":"all"}` —
or use the button on `/admin/social-trends`.

## PWA and push notifications

The frontend is installable: `public/manifest.webmanifest` plus a hand-rolled
service worker in `public/sw.js`. The worker caches the app shell, the
content-hashed build assets, and card audio, and **never** caches Supabase — so
auth, decks and AI calls always hit the network. It is registered in production
builds only (`src/lib/serviceWorker.ts`), which keeps the hermetic Playwright
suite deterministic.

Web push is optional and off unless configured. Generate a keypair once:

```sh
npx web-push generate-vapid-keys
```

Then set `VITE_VAPID_PUBLIC_KEY` for the frontend, and `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` as edge-function secrets. Schedule
`notify-due-reviews` hourly (Supabase dashboard → Cron); it only notifies inside
each learner's local evening, at most once a day, and only when enough cards are
actually due. With no key set, the Settings toggle hides itself rather than
offering something that can't work.

## Deployment

The frontend is a static Vite build; the backend runs as Supabase Edge
Functions. Set `ALLOWED_ORIGINS` (comma-separated) as an edge-function secret to
restrict CORS to your production domain(s).
