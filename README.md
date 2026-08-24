# Hakiya — Learn Spoken Arabic

Hakiya is a web app for learning **spoken (dialectal) Arabic** — Gulf (Khaliji),
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
  feature code.
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

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request,
in three jobs so a failure names its own kind:

- **Typecheck, lint & unit tests** — `tsc` over `src/`, the lint ratchet, Vitest,
  and the production build.
- **Typecheck edge functions (Deno)** — `deno check` over
  `supabase/functions/**`. See below.
- **End-to-end** — Playwright. A failed run uploads its HTML report as an
  artifact.

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

Lesson plans imported from `.xlsx` (`src/lib/parseLessonXlsx.ts` →
`useLessonImport`) persist their authored sections. `sound_spotlight`,
`lesson_sequence` and `real_world_prompts` are rendered to the learner in
`src/pages/Learn.tsx`; `image_scenes`, `flashcard_spec` and `design_rationale`
are stored as authoring metadata and have no learner-facing surface. Every
section renders nothing when empty, so lessons imported before this was wired up
are unaffected.

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

Long documents are windowed, not truncated. `slice(0, N)` keeps a transcript's
opening and throws away the part being watched; `windowDocument` grows a
contiguous window outward from the focused line, reserves a short head so the
material stays identifiable, and reports what it dropped as
`… 14 lines omitted …`. That marker is load-bearing: a model shown two
non-adjacent lines with no gap between them reads them as consecutive and then
explains a transition that never happened.

**Live voice stays in sync.** A Realtime session's instructions are minted once
and carry the dialect rulebook and learner profile, so they are deliberately
not rebuilt from the browser. Instead the document goes out at mint time and
position changes are added to the conversation as notes over the data channel
that is already open (`serializeFocusUpdate`), throttled and only on a real
change. Without this the tutor is frozen at whatever was on screen when the
call connected.

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
  The narrowest role in the app — `/admin/transcribe` and nothing else. See
  **Transcript review** below.
- `beta_tester`: can access beta-only features.
- `bible_reader`: grants Bible reading access (except when the user is also
  `content_reviewer`).

The two path allow-lists live in `src/lib/rbac.ts`
(`canAccessContentReviewerAdminPath`, `canAccessTranscriberAdminPath`) and are
enforced by `AdminLayout`. `src/test/routeManifest.test.ts` asks those functions
directly, so a route cannot be marked reachable by a role that rbac.ts does not
actually admit — nor can a new admin route quietly become reachable by a
transcriber.

## Transcript review

Native speakers check the pipeline's output at `/admin/transcribe`: a queue
sorted by how much is left rather than by date, and a per-video workspace at
`/admin/transcribe/:videoId`. It is deliberately **not** the admin video form,
which can publish, delete and re-run the pipeline.

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
J/K to move, Space to play, ⇧Space to play slowly, M to merge, R to tick, T to
re-translate, C to comment, brackets to nudge timings, `?` for the list. The map
lives in `src/lib/transcriptShortcuts.ts` and both the resolver and the help
panel read it, so a shortcut cannot exist undocumented.

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
