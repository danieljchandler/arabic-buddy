# Fix plan for the 2026-09-29 QA sweep

Companion to [REPORT.md](REPORT.md) and [NEXT-STEPS.md](NEXT-STEPS.md). Every Broken
and Suspicious item is placed below, either in a work package (one PR each) or in
section 0 (needs Daniel, not code). Nothing here is implemented yet. Numbers like #2
are REPORT.md's Broken numbers. File:line references were read on main at 163fa9a.

## What the code says the sweep actually found

Three findings change the order of work from NEXT-STEPS.md:

1. **The AI failures are one route, not "credits".** Every feature that failed
   (`translate-text`, `writing-coach`, `reading-passage`, `generate-daily-story`,
   `daily-challenge`, `dialect-compare`, `souq-news` rewrite, `phrase-of-the-day`)
   calls Gemini Flash *solo* and can only fall back to other Google models
   (`_shared/aiBrain.ts:615` `STABLE_FALLBACKS`). The one feature that worked,
   `how-do-i-say`, is a `council` with a Claude drafter on OpenRouter, and a council
   answers as long as one drafter does. The "AI credits exhausted" text is
   `phrase-of-the-day/index.ts:203` reacting to a **402**, and 402 is not in
   `aiGateway.ts:488` `FALLBACK_STATUSES`, so a 402 never retries on OpenRouter and
   never falls back to another vendor. So: the Gemini route is returning 402 (or the
   deployed functions are an old build still pointing at the Lovable gateway; nothing
   in the repo can tell which). Fix the account first (section 0), then make solo
   calls survive one vendor being down (package 3).
2. **The crash toast is real, but it is not a crash.** `App.tsx:206-219` turns
   *every* unhandled rejection into "An unexpected error occurred" and a
   `__app_last_crash` flag. `TransitionRoutes.tsx:37` discards the promise from
   `document.startViewTransition`, which rejects whenever a transition is skipped or
   aborted (hidden tab, a redirect landing mid-transition, reduced motion toggling).
   `/admin/errors` has 33 "Transition was aborted" and 9 "Transition was skipped"
   rows, so real users hit it too, not only hidden tabs. #4, #5, #13 and #16 are all
   this one handler; `/skills/bogus` itself does the right thing (`Skill.tsx:51`).
   The "sticky banner" is not sticky: `App.tsx:188` removes the flag on the next full
   load and shows one toast. Package 1 fixes it in two files.
3. **Two admin surfaces are worse than "no not-found state".** `AdminStoryForm.tsx:236`
   deletes and reinserts `story_scenes` on save, so an Update on a fake id creates
   orphan scenes; and `AdminLogin.tsx:151` offers a sign-up that calls
   `supabase.auth.signUp` with **no invite code** (`useAdminAuth.ts:129`), bypassing
   the closed-beta gate that `/auth` enforces client-side. Both are in package 5.

## Order of work

| # | Package | Fixes | Size |
| --- | --- | --- | --- |
| 0 | Daniel: account, logs, foreground check, e2e, 390px | prerequisites for 3, closes #4/#5/#13/#16 as "real or artifact" | — |
| 1 | Quiet the crash handler | #4, #5, #13, #16 | S |
| 2 | Quiz first-render crash | #2 | S |
| 3 | Solo AI calls survive a dead vendor; errors reach the learner | #3, #6, #7, #8, #9, #10, #18 | M |
| 4 | Domain: point everything at the live host | #1 | S + ops |
| 5 | Not-found gates on every id route, admin login hardening | #12, #14, #17, Suspicious stories/bible | M |
| 6 | Settings dialect picker | #11 | S |
| 7 | Small fixes: bulk-import mic, labels, titles, a11y, RTL, share url | #15, Suspicious how-do-i-say / reading-library / a11y / onboarding / share-target | S |
| 8 | Counts: fix the two that are wrong, relabel the rest | Suspicious count mismatches | S |
| 9 | Edge failures get logged; Pricing for staff accounts | #18's "edge tab empty", Suspicious pricing | S |
| 10 | Yemeni content: data and admin actions, not code | Suspicious Yemeni gaps | ops |

Packages 1, 2, 4 and 6 are independent one-sitting fixes. 3 is the one that matters
for learners and needs section 0 first. 5 and 7 are mechanical. Ship 1 and 2 before
anything else: 2 is the only real crash a learner can hit, and 1 stops every
in-app navigation looking like one.

---

## 0. Daniel first (nothing here is a code change)

- [ ] **Which provider returned the 402.** In Supabase → Edge Functions → logs,
  search `phrase-of-the-day error:` and `translate-text` for the last day. The
  `BrainHttpError` message starts with the served provider name (`aiBrain.ts:561`).
  Google direct means `GEMINI_API_KEY`'s project has no quota or billing; OpenRouter
  means the OpenRouter balance is empty. Top up the one named. If the log names
  `ai.gateway.lovable.dev`, the deployed functions predate the gateway rewrite:
  redeploy all functions and bump `_shared/edgeBuild.ts`.
- [ ] **Then retest before any of package 3 lands:** `/translate`, `/write`,
  `/today/story`, `/daily-challenge`, `/dialect-compare`, `/placement/c-test`,
  `/souq-news`, `/culture-guide`. If they all pass, package 3 is still worth doing
  (it is the same single point of failure) but drops to normal priority.
- [ ] **`feature_metrics` for souq-news** (`/admin/metrics` or SQL): the `ai_rewrite`
  error rows carry `meta.http_status` (`souq-news/index.ts:194-209`). That number
  confirms or refutes the 402 theory without reading logs.
- [ ] **Foreground check** of `/stories` → a story and `/discover` → a video in a
  visible tab. Package 1 is worth doing either way (the error log shows real users
  hit it), but this tells you how loud it is.
- [ ] **`npx playwright install chromium` then `npm run test:e2e`** on A. The suite
  never ran during the sweep. If it is red on main, that comes before anything below.
- [ ] **390px pass** on /today, /curriculum, /review, /my-words, /analytics,
  /discover/:id, /stories/:id, /translate, /settings, /profile. Add anything found
  to package 7.
- [ ] **Decide the domain** (package 4 needs the answer): register `hakiya.app`, or
  accept `laha-arabic.lovable.app` as the public address for now.

## 1. Quiet the crash handler (#4, #5, #13, #16)

Files: `src/components/shell/TransitionRoutes.tsx`, `src/App.tsx`.

- `TransitionRoutes.tsx:37`: keep the returned transition and swallow its
  rejections: `const t = document.startViewTransition(...); t.finished.catch(() => {}); t.ready.catch(() => {});`
  (`updateCallbackDone` too). A skipped or aborted transition is the browser
  telling us it did the swap without animating; the route still changed.
- `App.tsx:206`: before persisting, drop rejections that are not failures:
  `DOMException` with name `AbortError` or `InvalidStateError`, and messages matching
  `/Transition was (aborted|skipped)|signal is aborted without reason/`. Log them at
  `console.debug` and return. Same filter in the `error` listener at `:221`.
- `App.tsx:173` `persistCrash` stringifies an Error to `{}`; store
  `{ name, message }` so the recovery toast at `:191` (which can never see an
  `instanceof Error` after `JSON.parse`) has something to show.
- Keep `logClientError` for everything else; the point is to stop calling a view
  transition a crash, not to log less.

Tests: a unit test on the filter predicate (extract it to `src/lib/crashFilter.ts`
so `libCoverage` sees it named), and an e2e assertion in `e2e/skills.spec.ts`'s
existing "unknown skill" test that no toast with "unexpected error" appears after the
redirect. Verify: `/skills/bogus`, `/admin/transcribe` and a list → detail click show
no toast; `/admin/errors` stops accruing "Transition was" rows.

## 2. Quiz first-render crash (#2)

File: `src/pages/Quiz.tsx`.

`shuffledWords` is state filled by a `useEffect` after `topic` arrives (`:41-45`), so
the first render with a 4+ word topic has `shuffledWords = []`, `currentWord` is
undefined and `:173` reads `.id` off it. Every real lesson has 4+ words, hence "every
lesson"; short lessons hit the `< 4` guard at `:112` first and look fine.

- Derive instead of syncing: `const shuffledWords = useMemo(() => topic?.words ? shuffleArray(topic.words) : [], [topic])`,
  with a `seed` state that `resetQuiz` bumps so restart reshuffles. Drop the effect.
- Belt and braces: `if (!currentWord) return <loading />` before the JSX.

Tests: a component test that renders `Quiz` with a lesson of 4 words through the
in-memory backend and asserts the first card renders; the 4-word fixture belongs in
`src/test/support/factories/`. Add a Playwright spec that opens `/quiz/<LESSON_ID>`
directly (the manifest already names it at `manifest.ts:106`; nothing exercises it,
`routeReachability` allows it as "opened from inside a lesson").

## 3. Solo AI calls survive a dead vendor; errors reach the learner (#3, #6, #7, #8, #9, #10, #18)

Two halves. The server half removes the single point of failure; the client half
makes the next outage say what happened instead of "Please try again".

**Server** — `supabase/functions/_shared/aiBrain.ts`, `aiGateway.ts`,
`culture-guide/index.ts`, `writing-coach/index.ts`, `souq-news/index.ts`.

- `aiBrain.ts:615` `STABLE_FALLBACKS`: append a non-Google rung. The registry's
  only OpenRouter-served model today is `MODEL_IDS.CLAUDE` (Sonnet 5,
  `modelRegistry.ts:31`), which is dear for a fallback on cheap solo calls; add a
  Haiku id to the registry (with its `reasoningFloor`, per CLAUDE.md) and use that.
  `UTILITY` is Gemini-only (`:160`), so it cannot be the source. `:633`'s retry
  regex only matches 5xx and parse failures; add `402|429|401|403` so a vendor
  refusing the key falls through to the next rung rather than surfacing.
- `aiGateway.ts:488`: do **not** add 402 to `FALLBACK_STATUSES`. That set means
  "retry the same model through OpenRouter", and an OpenRouter 402 retried on
  OpenRouter is a loop. The vendor swap belongs in `aiBrain`'s rung list, above.
- `writing-coach/index.ts:273`: stop rewriting every throw as 502 `coach_failed`.
  Let `BrainHttpError` 402/429 through with their status and a `message` string.
  Don't charge the daily cap (`:213`) for `action: "prompt"`: today every page load
  spends one of the free tier's 10.
- `culture-guide/index.ts:120`: it bypasses the gateway and calls Google's SSE
  endpoint directly with `GEMINI_API_KEY` and no fallback. Minimum fix: emit an
  SSE `error` frame when the upstream stream carried `json.error` / `promptFeedback`
  or produced zero text (`:176-197`), instead of `[DONE]` on an empty answer. Better:
  move it onto `streamBrain()` like the assistant, keeping the `googleSearch` tool
  only where the gateway supports it. Which of the two is a judgement call on how
  much the search tool is worth; the minimum fix is a day, the move is a PR of its own.
- `souq-news/index.ts:260`: validate the rewrite's JSON shape before making a card.

**Client** — `src/lib/invokeError.ts` and the six pages that don't use it.

- `invokeError.ts:75-82` hides a 4xx body unless it contains whitespace and hides
  every 5xx body. Show a `message` field whenever the body is JSON with one; keep
  the whitespace heuristic only for bare strings.
- Route the six pages through `toInvokeFailureError`: `WritingPractice.tsx:77,121`,
  `DailyChallenge.tsx:226` (currently discards the body), `DialectCompare.tsx:72`
  (also hardcodes `source_dialect: "Gulf"` at `:73`; use `activeDialect`),
  `CTest.tsx:62` (shows supabase-js's raw "Edge Function returned a non-2xx status
  code"), `SouqNews.tsx:57` (its `data?.error` credits branch at `:64` can never
  run: a 402 arrives as `error` with `data = null`), `PhraseOfTheDay.tsx:90`.
- `CultureGuide.tsx:188`: when the stream ends with `assistantSoFar` empty, toast
  "No answer came back" and remove the user bubble or mark it failed. Add a fetch
  timeout.
- `/souq-news` blank page: the code cannot render nothing (`SouqNews.tsx:188-210`
  covers loading, error, empty, cards). Treat it as unexplained until the foreground
  retest in section 0 captures the POST status; if it recurs, it is a `useQuery`
  state the page does not handle (`articles === undefined` with neither flag).

Tests: `_test/` cases for `translate-text` and `writing-coach` with `NO_AI_PROVIDER`
and with a 402 stub on the Google route asserting the OpenRouter rung is tried and
the response carries a `message`; a `culture-guide` test asserting an empty upstream
stream yields an error frame. Client: extend `src/lib/invokeError.test.ts` for the
JSON `message` case. Drift guards: `edgeFunctionCoverage` already names all of these;
no new function or module, unless `crashFilter` (package 1) or a new client helper.

## 4. Domain (#1)

Two consistent states exist; pick one in section 0.

**If `hakiya.app` is registered:** DNS to the host, then `docs/deployment.md` §3
(`ALLOWED_ORIGINS` first entry, Supabase Site URL and Redirect URLs, Google OAuth
origins), then `public/robots.txt:6` and `public/sitemap.xml` to `hakiya.app`. No
other code change: `index.html`, `cors.ts:13`, `ReferralCard.tsx:93` already say it.

**If the live host stays `laha-arabic.lovable.app`:** `index.html:25,30,31,39,58`,
`src/components/social/ReferralCard.tsx:93-94` (referral links currently point at a
dead host), `src/pages/admin/AdminIdLogins.tsx:82`, `_shared/cors.ts:13` (put the live
origin first: `getProductionOrigin()` at `:31` is what Stripe return URLs and email
links use), `notify-due-reviews/index.ts:34`, `native-feedback/index.ts:164`. Leave
`hello@hakiya.app` and `ids.hakiya.app` (no MX is by design, `accessCodeCore.ts:35`).
Update the reason text in `src/test/brandSpelling.test.ts:53-59`, which currently
claims `hakiya.app` is the live domain. Tests naming the domain
(`accessCodeCore.test.ts`, `referralHandoff.test.ts`, `e2e/referral.spec.ts`) follow.

Either way: the marketing script note in the vault (2026-09-26) is blocked on this
same decision.

## 5. Not-found gates on id routes; admin login (#12, #14, #17, Suspicious)

The working pattern is `LessonWords.tsx:197-206` and `admin/Words.tsx:80-94`: bail on
loading, then on `!data`. The broken pages skip the second check. Add one shared
`RecordNotFound` (title, back link) in `src/components/shared/` beside `EmptyState`
rather than a seventh ad-hoc `<p>… not found</p>`.

| Route | File | What to add |
| --- | --- | --- |
| /admin/videos/:id/edit | `AdminVideoForm.tsx:1509` | after the spinner, `if (isEditing && !existingVideo) → not-found` |
| /admin/topics/:id/edit | `TopicForm.tsx:126` | `isError \|\| !existingTopic` → not-found |
| /admin/topics/:id/words/:wordId/edit | `WordForm.tsx` | it has no loading branch at all; add loading then not-found on either query |
| /admin/stories/:id/edit | `AdminStoryForm.tsx:69` | it is a bare effect; track `notFound` when `.single()` errors. **Also gate the save at `:236`**: never delete `story_scenes` unless the story row was loaded |
| /admin/reading-library/:id/edit | `AdminReadingLibraryForm.tsx:336` | `isEditing && !story` → not-found |
| /admin/curriculum-builder/:sessionId | `CurriculumBuilder.tsx:86` | when `routeSessionId` is set and `sessions` loaded but `find` is undefined → not-found |
| /stories/:storyId | `StoryPlayer.tsx:80-91` | the title effect ignores a missing row; fetch the story with `maybeSingle`, render not-found on null before the "no scenes" empty state |
| /bible/lessons/:lessonId | `BibleLessons.tsx:83-102` | `maybeSingle` null → a not-found state instead of falling back to the list |

`/admin/memes/:id` and `/admin/transcribe/:id` redirect to the video form and inherit
its fix.

**Admin login** (`AdminLogin.tsx`): add the same `useEffect` as `Auth.tsx:51-67`,
redirecting to `/admin` when `user && !loading`. Remove the sign-up toggle
(`:149-157`) and `useAdminAuth.signUp` (`useAdminAuth.ts:129-140`): it calls
`supabase.auth.signUp` with no invite code, so it is an open registration form on
the admin panel. Staff accounts are created by an admin granting a role to an
existing invited user, or by `/admin/id-logins`.

Tests: one Playwright case per row above with a fake uuid (the in-memory backend
returns no row, so these are cheap), and `e2e/access.spec.ts` gets "signed-in admin
at /admin/login lands on /admin". `routeManifest` needs no change; no routes are added.

## 6. Settings dialect picker (#11)

File: `src/pages/Settings.tsx:93-102`, `:270`, `:368`, `:576-592`.

The page has its own eight-entry list with no Yemeni and six sub-country ids that
`DialectContext` (`:6`, `:65`, `:85`) does not recognise: picking "Saudi" saves
`preferred_dialect = 'Saudi'`, the context ignores it and the active dialect stays
whatever it was. Onboarding's comment (`Onboarding.tsx:55-63`) records the same
mistake being fixed there.

- Replace the list with `DIALECTS` / `DIALECT_LABELS` / `DIALECT_FLAGS` from
  `src/config.ts` (Gulf, Egyptian, Yemeni).
- Save through `useDialect().setDialect` as onboarding does, so the app switches
  immediately; keep the `profiles` write.
- Add `aria-pressed` to the cards; the selected state is class-only today.
- One-off data check (SQL, Daniel): `select preferred_dialect, count(*) from profiles group by 1`
  to see how many rows hold a sub-country value; map them to `Gulf` in a migration
  applied through Lovable (not a file that only replays in CI; see CLAUDE.md).

Tests: `e2e/settings.spec.ts` asserts a Yemeni profile shows Yemeni selected and
that choosing Egyptian changes `activeDialect` on the next page.

## 7. Small fixes (#15 and the Suspicious UI items)

One PR, one commit per line.

- **Bulk import mic** (#15): `BulkWordImport.tsx:491-494` mounts
  `InlineAudioRecorder` for every row unconditionally, and the recorder calls
  `getUserMedia` on mount (`InlineAudioRecorder.tsx:27-29`, pinned by its test at
  `:99` "starts recording on mount"). Add a Mic button per row that sets the unused
  `entry.isRecording` and mount the recorder only then; `onCancel`/`onSave` clear
  it. Leave the recorder's own mount-start behaviour alone: it is the right
  behaviour once a user has asked for it.
- **How Do I Say labels**: `HowDoISay.tsx:282` and `:366` are two-way ternaries
  (`Egyptian` else `Gulf`). Use `DIALECT_LABELS[activeDialect]`. The function itself
  handles Yemeni correctly.
- **Doubled title suffix**: `ReadingLibrary.tsx:51` and `Listen.tsx:45` pass
  `"… — Hikaya"` to `useDocumentTitle`, which appends the suffix itself. Drop it.
- **Accessible names**: `LearnFromX.tsx:247` submit ("Analyze post"), `:338` save
  word; `Transcribe.tsx:1249` clear file ("Remove file"), `:1556` add word.
  `TutorUpload.tsx:90-99` drop zone is a clickable `div`; make it a `<label>` for
  the file input. (The header icons the report named are already labelled in
  source; that finding was a stale deploy or those buttons.)
- **Onboarding RTL**: `Onboarding.tsx:237` has `!أهلاً وسهلاً` with the `!` first in
  logical order; write `أهلاً وسهلاً!`.
- **Share target drops the URL** (#13's second half): `shareRouting.ts:122-124`
  discards a non-X, non-video URL and screens only the caption. Include the URL in
  the `screen-text` payload so the translate page gets it.
- **`/admin/login` "Sign up"**: removed in package 5.

Tests: `useDocumentTitle` already has a spec; add a case that a title passed with
the suffix is not doubled (or make the hook strip it). `shareRouting.test.ts` gets
the caption-plus-url case. Everything else is covered by the existing e2e specs for
those pages once the assertions are tightened.

## 8. Counts (Suspicious)

The seven numbers are mostly different definitions, and two are wrong.

| Screen | Counts | Verdict |
| --- | --- | --- |
| /choose "N cards ready" | due `word_reviews` + due `user_vocabulary` both directions, all dialects (`useSRSStats.ts:122-201`) | fine; misses curriculum production-due cards |
| /my-words "Review N due words" | `user_vocabulary` due, both directions, active dialect (`useUserVocabulary.ts:72-117`) | **label wrong**: counts directions, says words |
| /my-words "My Words (N)" | `user_vocabulary` rows, active dialect | fine |
| /review/my-words "x / N due" | same due set after `buildReviewOrder`'s new-card cap (`MyWordsReview.tsx:244-371`) | fine; say "in this session" |
| /profile "Words N" | `user_vocabulary`, all dialects, **unpaged, caps at 1000** (`Profile.tsx:61-63`) | **bug**: 1000 is the PostgREST default page |
| /analytics "Total Words N" | `word_reviews` + `user_vocabulary` rows, all dialects (`useAnalytics.ts:76-123`) | fine; label "Total cards" |
| /admin "Total Words N" | `vocabulary_words` catalogue, active dialect (`Dashboard.tsx:19-29`) | fine; different table |

Do: page the Profile query (or use `count: "exact", head: true`), rename the two
labels ("due cards", "Total cards"), add "this dialect" where the number is scoped.
Do not try to make them agree; they measure different things.

## 9. Edge failures get logged; Pricing for staff (#18, Suspicious)

- **Edge tab is empty by construction.** `AdminErrors.tsx:23-32` reads
  `client_errors where source = 'edge'`; the only writer is `logEdgeError`
  (`_shared/logError.ts:24-45`) and only `pronunciation-feedback` imports it. Call
  it from `askBrain`'s outer catch (one place covers most functions) and from
  `aiBrain.ts:348-369`, which today emits the `ai-brain` metric only on success, so
  `/admin/metrics` never shows a Brain failure. Prefer that over touching each
  function's catch.
- **Pricing**: `Pricing.tsx:93-98` shows "You're on the All-In plan" plus a Manage
  (Stripe portal) button for admin and complimentary roles, which
  `check-subscription/index.ts:78-94` returns as `tier: "allin", complimentary:
  true`. Use the `complimentary` flag: "Full access (staff)" and no Manage button,
  which would fail for an account with no Stripe customer.

## 10. Yemeni content (Suspicious) — data and admin actions

None of these are code:

- **Set phrases empty for Yemeni**: the starter migration
  (`20260723020000_starter_set_phrases.sql`) inserts 9 Yemeni rows as `draft`;
  learners only see `published` (`useSetPhrases.ts:58`). Approve them on
  `/admin/set-phrases`, or run "Seed 10 phrases per occasion" for Yemeni once the
  AI route is back.
- **`/admin/curriculum` shows Gulf-looking lessons under Yemeni**: the page filters
  `lessons.dialect_module = activeDialect` (`Stages.tsx:38`), so those rows *are*
  labelled Yemeni in the database. Either the authored Yemeni track
  (`curriculum/tracks/yemeni/`, seed migration `20260905110000`) was never applied to
  the live project (CLAUDE.md: a merged migration is not an applied one) and the
  rows are the older imports, or the imports were labelled wrong. Check
  `select title, source_key from lessons where dialect_module='Yemeni'`: rows with a
  `source_key` came from the tracks; rows without came from xlsx. Apply the seed
  through Lovable if it is missing.
- **Discover / clips / stories / trending empty or Gulf for Yemeni**: content. The
  admin pages already carry the dialect module; nothing to change until Yemeni
  videos are approved. `/admin/trending` copy ("trending Gulf Arabic YouTube videos")
  and `/admin/videos` lacking a Yemeni filter are small copy items for package 7 if
  wanted.
- **MSA-ish items** (pronunciation "فلسفة", vocab-games verb pairs, one how-do-i-say
  option): content review, not code. `detectMsaLeaks` runs on the authored tracks
  but not on `vocabulary_words` rows imported from xlsx; a one-off script over that
  table would list candidates.
- `/my-transcriptions` first item labelled Yemeni but Egyptian text: a row label.

## Verification, every package

`npm run typecheck`, `npm run lint:ratchet`, `npm run test:coverage`, and the e2e
spec for the pages touched. Edge changes: `npm run check:edge` and
`npm run test:edge`. Then redeploy the functions and bump `_shared/edgeBuild.ts`;
package 3 is invisible until deployed, and the sweep suggests what is deployed may
not be what is merged.
