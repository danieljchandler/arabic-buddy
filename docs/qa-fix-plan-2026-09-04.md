# Fix plan for the 2026-09-04 QA audit

Companion to `docs/qa-audit-2026-09-04.md`. Nothing here is implemented yet.
Each work package is sized to be one PR, lists the files it touches, the
drift guards it will trip (this repo fails CI when a new function, module or
route lands without its counterpart), and how it is verified — in most cases
by re-running the `qa/` harness, which is the point of having it.

## The TikTok audio item (M1), what it is and is not

The muted TikTok embed is by design and stays muted; nothing in package 11
touches the embed, its URL parameters, or TikTok's video. The audit item is
about *our own* audio copy in the private `video-audio` bucket, which
`DiscoverVideo` uses as the master clock for the muted frame, for slow-listen
and for shadowing. Today only reviewers and admins can mint a signed URL for
it, so a signed-in learner's page falls back to the silent timer-synced mode,
and every visitor's page makes 12 failing storage calls trying. Package 11
gives signed-in learners that audio through a short-lived URL minted
server-side; the bucket stays private and the TikTok source is never exposed.

## Where things stand (2026-09-04, end of day)

Done on this branch, each as its own commit: 1 (reduced), 2, 4 (code
half), 5, 6, 7, 8 (cache half), 11. Nothing to commit for 9. Still yours:
3 (deploy `persist-video-thumbnail` and run the backfill), the deploy of the
new `discover-video-audio` function, the lesson import (4), the paid
word-timing backfill (8), the two decisions in 8 and 9, the
`ALLOWED_ORIGINS` secret (9), and a learner login for 10. Every package's
section below opens with its status.

## Order of work

| # | Package | Fixes | Owner | Size |
| --- | --- | --- | --- | --- |
| 1 | Guard the unauthenticated paid functions | B2, part of M4 | dev | S |
| 2 | Make the duplicate migration idempotent; bring the out-of-band tables into migrations | B3, M6 | dev + one dashboard export | M |
| 3 | Deploy `persist-video-thumbnail` and run the backfill | M2 | ops | S |
| 4 | Import the lessons (or gate the curriculum until they exist) | B1, part of m2 | content + dev | M |
| 5 | Visible error and retry state when the backend fails | M3 | dev | M |
| 6 | Stop calling sign-in-only functions for signed-out visitors | rest of M4 | dev | S |
| 7 | Small frontend fixes from the click sweep | m1, m2, m3, m8, m9 | dev | S |
| 8 | Transcript word timings and Listen audio encoding | M5, m4 | dev + paid backfill | M |
| 9 | Database and storage hygiene | m5, m6, m7 | dev + ops | S |
| 10 | Authenticated QA run and close-out | audit "Blocked" section | you + dev | S |
| 11 | Serve the TikTok audio copy to signed-in learners, stop the failing probes | M1 | dev | M |

Packages 1–3 are the launch blockers and are independent of each other.
Package 5 should land before 6 so the 401 handling has somewhere to render.
Package 11 is Major and independent; schedule it alongside 5–6 since it
shares the "sign in to…" affordance with 6.

---

## 1. The "unauthenticated paid functions" (B2) — reduced after re-reading the code

**Status: done on this branch (commit below), smaller than first planned.**

While implementing, the premise turned out to be wrong: `practice-chunk-coach`,
`score-set-phrase-voice` and `scrape-x-post` already run
`enforceAnonymousDailyCap` (15 / 60 / 20 calls per client IP per day; commit
`d575aaf`), deliberately, because the set-phrase practice page and
Learn-from-X are public. The audit's static guard scan matched
`enforceDailyCap` and missed the anonymous variant. Requiring sign-in would
change product behaviour on two public pages, so it is **not** done here;
if the per-IP ceilings are too generous, lower the three numbers in place.

What was done:
- `supabase/functions/check-subscription/index.ts`: a caller the auth server
  rejects (no header, or a token with no `sub`, which is what the
  publishable key is) now gets `401` instead of `500`, via a tagged
  `AuthError` in the existing try/catch.
- `supabase/functions/_test/payments_test.ts`: one test for the 401, both
  with a rejected token and with no header, asserting Stripe is never called.
- `docs/qa-audit-2026-09-04.md` B2 corrected accordingly.

**Verify**: `npm run test:edge` (25/25 in `payments_test.ts`);
`deno check` on the function. After deploy,
`curl -X POST …/functions/v1/check-subscription -H "apikey: <anon>" -d '{}'` → 401.

## 2. Migrations: duplicate policy file and out-of-band tables (B3, M6)

**Status: done on this branch.** The duplicate file drops the four renamed
policies before creating them and guards its ledger insert, so it replays;
`20260904120000_out_of_band_tables.sql` creates the five dashboard-only
tables and the `story-videos` bucket with `IF NOT EXISTS`; the replay test's
missing-table list is empty and a new static guard
(`src/test/tablesInMigrations.test.ts`) keeps it that way. One planned step
was dropped after trying it: `-1` (one transaction per file) in
`contract/build.mjs` broke 30+ historical files that add an enum value and
use it in the same file, which production's runner allowed, so the replay
stays non-transactional and the header now says so. Local replay: 228 files,
119 tables, exactly the seven known failures. Still yours: confirm the
production ledger lists both `20260903100000` and `20260903130627`.

**Files**
- `supabase/migrations/20260903130627_1ec9b393-b96d-4911-b7a7-86e2ee975cac.sql`
- new `supabase/migrations/20260905000000_out_of_band_tables.sql` (name to taste)
- `src/test/migrationReplay.test.ts` (`KNOWN_FAILURES`, `KNOWN_MISSING_TABLES`)
- `contract/build.mjs`
- `src/integrations/supabase/types.ts` only if the export differs from it

**Steps**
1. Edit the duplicate file so every `CREATE POLICY` is preceded by
   `DROP POLICY IF EXISTS` (its first block already does this for
   `review_streaks`, so the style is in the file). Do **not** delete the file:
   production's `supabase_migrations.schema_migrations` may list it, and the
   file also inserts its own ledger rows. Then check the dashboard ledger
   lists *both* `20260903100000` and `20260903130627`; if only one, mark the
   other applied by hand.
2. Export the production definitions of `learning_paths`,
   `processed_videos`, `review_streaks`, `user_difficulty`,
   `weekly_recommendations` (Dashboard → Database → table → "Definition", or
   `supabase db pull` against the project) and paste them into one new
   migration as `CREATE TABLE IF NOT EXISTS …`, followed by their indexes,
   `ENABLE ROW LEVEL SECURITY`, policies (each `DROP POLICY IF EXISTS` first)
   and explicit `GRANT`s. Add
   `INSERT INTO storage.buckets (id, name, public) VALUES ('story-videos','story-videos', true) ON CONFLICT DO NOTHING`.
3. `20260529150401` and `20260529155315` fail today only because
   `processed_videos`/`review_streaks` do not exist yet at that point in the
   replay. Migrations run in timestamp order, so a new file cannot fix them;
   make the new file self-sufficient (it re-creates their policies with
   `DROP POLICY IF EXISTS`) and leave those two in `KNOWN_FAILURES` with a
   comment saying why.
4. Remove `processed_videos`/`review_streaks` from `KNOWN_MISSING_TABLES` and
   let the test's "these now replay cleanly, remove them" branch tell you what
   else to drop.
5. `contract/build.mjs`: pass `-1` (`--single-transaction`) to `psql` so a
   failing file leaves nothing half-applied, as the previous audit noted.
6. Optional but worth it: a tiny guard test that every table in
   `types.ts` is created by *some* migration, so the next dashboard-only
   table fails CI instead of the next audit.

**Verify**
- `DATABASE_URL=… npx vitest run src/test/migrationReplay.test.ts` green
  locally; CI job "Migration replay" green on the PR.
- `node qa/build-map.mjs` no longer prints "no policy found in replay" for
  those five tables.

## 3. Deploy `persist-video-thumbnail` and backfill (M2)

**Steps (ops, no code)**
1. `supabase functions deploy persist-video-thumbnail --project-ref ovscskaijvclaxelkdyf`.
2. `curl -X OPTIONS …/functions/v1/persist-video-thumbnail -H "Origin: https://hakiya.app"` → 200.
3. Trigger the backfill the PR #332 client already performs
   (`useDiscoverVideos.ts:205` — opening `/discover` as an admin persists any
   card whose thumbnail is still on a third-party CDN), or call the function
   once per published TikTok video from a script.
4. `GET /rest/v1/discover_videos?select=thumbnail_url&published=eq.true` →
   every URL on `ovscskaijvclaxelkdyf.supabase.co/…/flashcard-images/tiktok-thumbs/`
   or `img.youtube.com`; none on `tiktokcdn.com`.

**Follow-up (dev, S)**: a `supabase/functions/_test` or CI step that lists
deployed functions against the directory list would have caught this; the
management API needs a token, so it is a manual checklist item until then.

## 4. Lessons (B1) and word audio

**Status: the code half is done on this branch, smaller than planned.**
`e2e/choose.spec.ts` records a deliberate product decision — the Curriculum
door stays open rather than greyed out "coming soon" — so the tile is not
hidden. Instead its subtitle stops promising "lessons in order" while the
active dialect has none and points at the Alphabet Journey, which is what
`/curriculum` itself does. The speaker button on `/learn` turned out to be
already disabled when a word has no audio and no TTS result; the sweep
caught it mid-generation. **Still yours**: the lesson import
(`/admin/lessons/import`) and, if wanted, `persist-word-audio` for the
words with no `audio_url`.

**Decision needed**: import now, or hide the curriculum until content is
ready. The plan assumes import.

**Steps**
1. Content: run the spreadsheets in `curriculum/` through
   `/admin/lessons/import` for Gulf first (the importer flags multi-word
   entries and persists the authored sections; see README "Curriculum").
   Confirm `GET /rest/v1/lessons?select=id,dialect_module` returns rows per
   dialect that has a stage.
2. Dev, if the import is not imminent: hide the `/curriculum` tile on
   `/choose` and the "Lessons" entry on `/skills/read` behind a
   `lessons.length > 0` check (both already query `useAllLessons`), and make
   the Curriculum empty state link to Alphabet Journey (it does) — this is
   already the graceful path, so the change is only the entry points.
3. Word audio: `vocabulary_words.audio_url` is empty on the sampled rows, so
   the speaker button on `/learn` does nothing (m2). Run `persist-word-audio`
   for words without audio (paid TTS, ~82 words) or disable the button when
   `audio_url` is null.

**Verify**: `/curriculum` shows lessons; `qa` crawl of `/learn/:lessonId`
substitutes a real id automatically once one exists.

## 5. Visible error state when the backend fails (M3)

**Status: done on this branch.** `lib/queryErrors.ts` classifies a failed
query (network / auth / server / client) and gives React Query a retry
policy that re-asks a network or 5xx failure once and a 4xx never;
`QueryErrorState` renders the failure with a retry (or sign-in) button using
the ErrorBoundary's wording; `lib/queryFailureToast.ts` posts one
rate-limited toast per outage from the QueryCache for pages not yet
converted. Discover (browse and feed), Curriculum, Leaderboard, Stories,
Reading Library, Set Phrases and Listen branch on `isError` before their
empty states. `e2e/backend-failure.spec.ts` injects a 500 on each page's
table and asserts the alert appears and the empty-state copy does not, plus
one retry round-trip. Feed already had an error branch; `/` and `/today`
show the signed-out landing page for anonymous visitors, so their
"silent-empty" resilience result was correct behaviour, not a gap.

**Files**
- new `src/components/shared/QueryErrorState.tsx` (+ test)
- `src/App.tsx` (QueryClient defaults)
- list pages: `src/pages/Discover.tsx`, `Curriculum.tsx`, `Leaderboard.tsx`,
  `Stories.tsx`, `SetPhrases.tsx`, `Feed.tsx`, `Index.tsx`, `Pricing.tsx`,
  `ReadingLibrary.tsx`, `Listen.tsx`, `Review.tsx`, `MeHub.tsx`
- `e2e/` one spec using the emulator's failure injection (or `page.route`) for
  three of them

**Steps**
1. `QueryErrorState`: takes `error` and `onRetry`, distinguishes network
   (`TypeError: Failed to fetch`) from 5xx from 401, copy from
   `ErrorBoundary.ERROR_MESSAGES` so the wording matches.
2. QueryClient: replace `retry: 1` with a function that returns `false` for
   any 4xx (`FunctionsHttpError` status, PostgREST `code` 401/403/PGRST3xx)
   and `true` once for network/5xx. This also removes the 401 retry storms in
   M4.
3. On each list page, branch on `isError` *before* the empty-state branch.
   The empty state must only render when the query succeeded with zero rows.
4. Global fallback: a small `onError` in the QueryCache that shows one
   `toast` per 30s for network errors, so pages not yet converted still say
   something.

**Verify**: `npx playwright test -c qa/playwright.qa.config.ts resilience.spec.ts`
→ `backend-500` and `network-drop` columns read `error-shown` for every route
in the table; `slow-4s` still `looks-normal`/`silent-empty`.

## 6. Gate sign-in-only calls on public pages (M4, client side)

**Status: done on this branch, with two calls resolved the other way.** The
repo's own tests settled each case: where a test says a visitor is meant to
have the feature, the *function* now serves visitors under a per-IP cap
(the posture `enforceAnonymousDailyCap` already gives the placement quiz);
where the function is per-learner by design, the *client* stops asking.
- `phrase-of-the-day`: the home rendered the card before the session
  resolved, so every visit began with a failed call retried three times. The
  card now waits for auth and shows a sign-in line to visitors; its
  anonymous test was rewritten (it had assumed the emulator's always-200).
- `generate-set-phrase-quiz`: `/set-phrases/practice` and `/review` no
  longer ask for a visitor; they show "Sign in to practise set phrases".
- `convert-to-fusha`: `useFushaLines` does not run for a visitor; stored
  Fusha rows still show.
- `word-enrichment`: `TappableArabicText.test.tsx` pins that looking words
  up is open to anyone, so the function now serves a visitor under a
  10/day per-IP allowance (its edge test updated) and the client is unchanged.
- TTS (`tts-speak` / `azure-tts`): a 401 on a speaker tap now shows one
  "Sign in to hear pronunciation" notice per minute instead of nothing.
- The 401 retry storm itself was fixed in package 5's retry policy.

**Files**
- `src/hooks/useSetPhrases.ts` (`generate-set-phrase-quiz`)
- `src/pages/SetPhrasesPractice.tsx` (renders `/set-phrases/practice` and `/review`)
- `src/hooks/usePhraseOfTheDay.ts` or wherever `/today` calls `phrase-of-the-day`
- `src/pages/DiscoverVideo.tsx` (`convert-to-fusha` on load for TikTok)
- `src/components/shared/TappableArabicText.tsx` (`word-enrichment`)
- TTS entry points: `src/hooks/useTts*.ts` / `src/lib/tts*.ts` (whatever wraps `tts-speak` / `azure-tts`)

**Steps**
1. `enabled: !!user` on every `useQuery` that invokes one of these, and an
   early return in the imperative callers, with an inline "Sign in to
   practise this" affordance (there is already one on `/curriculum`, reuse
   its look).
2. For TTS taps by a signed-out visitor, show the same affordance instead of
   silently swallowing the 401.
3. `word-enrichment` on `/reading-library/:id`: 28 calls during one sweep —
   besides gating, debounce per word and cache by word text in React Query.

**Verify**: anon `qa` crawl → the "Supabase failures" table has no 401 rows in
the `load` phase; `/set-phrases*` shows the sign-in affordance instead of
"No phrases ready yet".

## 7. Small frontend fixes (m1, m2, m3, m8, m9)

**Status: done on this branch, with two items closed as not-bugs.**
`/placement` "Go Back" falls back to `/` when it is the first entry in the
tab; the MSA-background chips on `/bridge` carry `aria-pressed` (the
"no-op" was the already-selected default); the like button on a video and
the back/previous/play/next buttons on a library story have `aria-label`s.
The "could not be clicked" list (m3) was investigated with
`qa/probe-overlap.mjs`, which checks what `elementFromPoint` finds over each
control on the live page: nothing covers any of them, so those were the
crawl's 3-second click budget expiring during page transitions and
TTS-triggered re-renders; the budget is now 8 seconds. The landing-page
bands (m8) are `Reveal` waiting for an IntersectionObserver that a
full-page headless capture never scrolls into; `Reveal.test.tsx` already
pins that it fails open for users, so nothing to change.

- `src/pages/PlacementQuiz.tsx:373`: `navigate(-1)` → `navigate(window.history.length > 1 ? -1 : "/")`, or a plain link to `/`.
- `src/pages/Learn.tsx` speaker button: disable with a tooltip when the word has no `audio_url`.
- `/bridge` "I don't know MSA": either wire it or remove it — check what it was meant to toggle.
- `aria-label` on the icon-only buttons the sweep named `lucide-volume2`, `lucide-heart`, "(unlabeled)" on `/reading-library/:id`.
- Click-blocked controls (m3): open `/alphabet/:letterCode`, `/alphabet/sounds`, `/conversation`, `/dialect-compare`, `/vocab-games`, `/stories/:storyId`, `/reset-password` at 390×844 and 1280×720 and click the listed controls by hand; the usual cause is the assistant FAB or a sticky bar overlapping, which is one `z-index`/`padding-bottom` fix.
- Landing page (m8): check the dialect cards render without an
  `whileInView` trigger; if they use one, add `viewport={{ once: true, amount: 0 }}` or render statically.

**Verify**: re-run the crawl; the "did nothing" and "could not be clicked"
sections shrink to the acceptable cases (already-active tab, native form
validation).

## 8. Word timings and Listen audio (M5, m4)

**Status: the cheap half is done on this branch; the rest is yours.**
`generate-listen-audio` and `generate-story-full-audio` now upload with
`cacheControl: 86400`, so a replay or a scrub no longer re-downloads the
whole episode (a day, not a year, because the same path is overwritten when
an episode is regenerated). Re-encoding WAV to Opus needs an encoder the
Deno runtime does not have; leave it unless mobile data cost turns out to
matter. For word timings, `resync-transcript-timing` already realigns a
whole video from `/admin/videos/:id/edit`, so a "missing-words-only" mode
buys little — the decision below is the only open item.

**Decision needed**: is per-word highlighting a launch feature? If not, skip
8.1 and make the UI degrade explicitly.

8.1 Word timings (dev + paid): `resync-transcript-timing` already exists and
is reviewer-gated. Add a `--missing-words-only` mode (skip lines that already
carry `words[]`), run it over the 49 published videos from `/admin/videos`
(≈ 600 lines; one ASR pass per video), then verify with the one-liner in the
audit (`qa/media.spec.ts` prints `withWordTiming` per sample). Log the cost
from `llm_usage_logs`/provider dashboard before doing all of them.

8.2 Listen audio (dev): in `generate-listen-audio` / `generate-story-full-audio`,
encode the stitched output to Opus (or MP3 if Safari matters more than size)
before upload and set `cacheControl: "public, max-age=31536000"` on the
`storage.upload` call; keep `full.wav` for existing episodes but write the
compressed sibling and prefer it in `useListen.ts`. Verify with the
`listen episode audio` media test once a learner login exists (HEAD shows
`audio/ogg`, size < 1 MB, cache header).

## 9. Database and storage hygiene (m5, m6, m7)

**Status: nothing to commit; two of three are yours.** `caption_lines`
already carries `idx_caption_lines_video` and a full-text index, and
`search_caption_lines` uses them; the statement timeout the audit saw was
its own `count=exact` probe over the whole table, which no client page
does — so no migration. The tutor-clip read scope (m6) waits on your
decision, and removing `http://localhost:8080` from `ALLOWED_ORIGINS` (m7)
is a `supabase secrets set` on the project, not a code change.

- `caption_lines`: add the index the search RPC needs (`search_caption_lines`
  already exists — check its `WHERE`), and never `count: "exact"` on it; a
  short migration.
- `tutor-audio-clips`: **decision** — if clips are private to the uploader,
  replace the bucket in `lahja_public_read` with an owner-scoped SELECT like
  `learner-audio`; if they are shared content, leave it and note it in README.
- `ALLOWED_ORIGINS`: remove `http://localhost:8080` from the production
  secret (`supabase secrets set ALLOWED_ORIGINS=…`); the hermetic e2e suite
  does not need it and the `qa/` harness passes its own Origin.

**Verify**: `qa/output/schema/fn-preflight.txt` regenerated shows a 200 for
`https://hakiya.app` and no `access-control-allow-origin` for
`http://localhost:8080`.

## 10. Authenticated run and close-out

1. You: a confirmed learner login (or autoconfirm on briefly plus one invite
   code) and, if available, a 7-day edge-function log export.
2. `QA_EMAIL=… QA_PASSWORD=… npx playwright test -c qa/playwright.qa.config.ts`
   then `node qa/report.mjs` — covers the 28 auth-gated routes, onboarding's
   `weekly_goals` writes, `/listen` playback, `review_streaks` on `/friends`.
3. One manual pass over the 19 paid controls with `QA_ALLOW_PAID=1` on
   `media.spec.ts` and by hand elsewhere; record function + status in the
   report.
4. From a network with YouTube/TikTok access: `media.spec.ts` for the player
   itself.
5. Re-run the whole harness after packages 1–7 merge and diff
   `qa/output/crawl-report.md` against this run's copy.

## 11. TikTok audio copy for signed-in learners (M1)

**Status: done on this branch.** `supabase/functions/discover-video-audio`
answers a signed-in caller (under a 300/day per-learner cap, which is also
the authorization marker `serviceRoleAuthorization.test.ts` requires) with a
ten-minute service-role signed URL for a *published* video's staged audio,
found by the pipeline's extension order with the legacy YouTube-id key as
fallback, or `{ url: null, reason: "no_audio" }`. Seven edge tests cover
it. `resolveDiscoverVideoAudioUrl` calls it once when there is a session
and makes no request without one (five unit tests); the twelve client-side
signing probes are gone, and `videoAudioStaging.ts` is now used only by the
admin edit page. The TikTok player shows "Sign in to hear the audio and use
slow listen" to visitors. The emulator gained a handler so the hermetic
`discover.spec.ts` slow-listen tests keep passing. **Still yours**: deploy
the new function (`supabase functions deploy discover-video-audio`) — the
client falls back to silent timer mode until it exists.

**What stays the same**: the TikTok `player/v1` iframe stays muted
(`DiscoverVideo.tsx:1337-1358`), the `video-audio` bucket stays private, and
its storage policies are not widened. Reviewers and admins keep their direct
`createSignedUrl` path for the edit page.

**What changes**: a learner gets a 10-minute signed URL for *our* audio copy
from an edge function that runs under the service role and only answers for
a published video and a signed-in caller. The client asks that function once
instead of probing six extensions × two keys against a bucket it cannot read.

**Files**
- new `supabase/functions/discover-video-audio/index.ts`
- new `supabase/functions/_test/discover-video-audio_test.ts` (the
  `edgeFunctionCoverage` guard fails without it)
- `supabase/config.toml` (`verify_jwt = true`, with the usual reason comment)
- `src/lib/vocabularyAudioContext.ts` (`resolveDiscoverVideoAudioUrl`) and
  `src/lib/videoAudioStaging.ts`
- `src/pages/DiscoverVideo.tsx` (one affordance when signed out)
- `src/test/support/server/functions.ts` (emulator handler, or every
  hermetic spec that opens a TikTok video fails on the request guard)
- `src/lib/vocabularyAudioContext.test.ts` (branching), `e2e/discover*.spec.ts`
  (one case: learner gets an `<audio>` with a signed `video-audio` URL)

**Steps**
1. Edge function: `POST { videoId }` → `resolveUserId` (401 when null) →
   service-role read of `discover_videos` (`id, published, platform,
   source_url, embed_url`); 404 unless `published`. Find the staged object
   the way `record-transcript-corrections/index.ts:39` already does (list
   the bucket by the video id prefix, then the legacy YouTube-id prefix, take
   the first extension in `STAGED_AUDIO_EXTENSIONS` order, which is the same
   rule the admin uploader and the pipeline use). `createSignedUrl(path, 600)`
   under the service role and return `{ url, expiresAt, path }`; return
   `{ url: null, reason: "no_audio" }` when nothing is staged so the client
   can drop into the existing timer mode without an error. No provider is
   called, so no daily cap; a per-user `increment_usage_counter` is cheap if
   you want a ceiling.
2. `resolveDiscoverVideoAudioUrl`: if the caller is a reviewer/admin
   (`useAdminAuth` role, or just try the direct path and fall through), keep
   today's behaviour; otherwise, with no session return `null` without any
   request; with a session call the function once. Memoise per video for
   nine minutes (React Query, `staleTime: 9 * 60_000`) and re-mint on an
   `<audio>` `error` whose response was 400/403 (URL expired mid-session).
3. `DiscoverVideo`: when `!user && platform === "tiktok"`, show one line
   under the player ("Sign in to hear the audio and use slow listen") in
   place of the silent timer controls. Slow-listen and shadowing read
   `tiktokAudioUrl` already, so they work for learners with no further
   change.
4. Emulator: a handler in `src/test/support/server/functions.ts` that
   returns a fake signed URL for a video the in-memory `discover_videos`
   marks published, and `no_audio` otherwise.

**Security note for the decision record**: a signed URL lets the signed-in
learner download the audio copy for ten minutes; it never references the
TikTok video or the player. If even that is too much, the alternative is
for the function to stream the bytes itself (`Response` with the object body
and `Content-Range` support) so no URL exists at all; it costs function
egress on every play and is the only reason to prefer it.

**Verify**
- Anon: `qa` crawl of `/discover/:videoId (tiktok)` shows zero `storage`
  rows in the failure table and no `discover-video-audio` call.
- Learner (`QA_EMAIL`): `media.spec.ts` → `media.audios[0].src` starts with
  `…/storage/v1/object/sign/video-audio/`, `storageFailures: 0`, and the
  slow-listen control is enabled. `npm run test:edge`, `npm test`, and the
  hermetic `e2e/discover*` specs green.
