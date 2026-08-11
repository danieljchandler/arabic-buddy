# Handoff: behaviour findings found by the test suite

The test suite added in PR #242 covers every route, hook, lib module and edge
function, plus the components that carry real branching logic. While writing it,
**47 behaviour findings** were found across 27 components.

**None of them have been fixed.** Each one is pinned as a passing test that
describes what the code does today, so the suite stays green and the record
stays accurate. That means:

> **Every fix below will make its pinned test fail. That is the signal the fix
> landed.** Update the test to describe the new behaviour in the same commit as
> the fix — do not delete it.

The authoritative list is in the code: search the test files for `FINDING —`.
Each block explains the mechanism, why it matters, and the suggested fix.

```sh
grep -rn "FINDING —" src --include=*.test.tsx --include=*.test.ts
```

---

## How to work on this

1. Work one finding at a time, in its own commit.
2. Run the file's test first — it passes, describing the bug.
3. Fix the component.
4. The test now fails. Rewrite that one test to describe the corrected
   behaviour, and delete the `FINDING` comment block.
5. `npm run typecheck && npm run lint:ratchet && npx vitest run <file>`.

**Do not lower the lint ratchet.** `npm run lint:ratchet` fails only if the
error count rises above the 549 baseline in `scripts/lint-ratchet.mjs`.

**Do not touch the test environment variables.** `vitest.config.ts` and
`playwright.config.ts` deliberately override `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PROJECT_ID` with fake
values. `vite.config.ts` falls back to **real production credentials** if they
are missing, so removing the overrides would point the whole test suite at
production. `src/test/envGuard.test.ts` fails the build if they drift.

---

## Highest value first

These four have real, ongoing user cost.

### 1. The error boundary sends people to the login page for a JSON parse error

`src/components/ErrorBoundary.tsx` — `classifyError`

`"Unexpected token < in JSON at position 0"` is what every browser throws when a
fetch expecting JSON receives an HTML error page. It is one of the commonest
render-time errors there is. `classifyError` matches on the substring `token`,
decides the session expired, and shows a panel whose only button sends the user
to `/auth` — where signing in again fixes nothing.

**Fix:** narrow the auth match (e.g. `jwt`, `unauthorized`, `401`,
`auth session`, `invalid token`) or branch on `error.name === "SyntaxError"`
first. While you are there: the "show details" disclosure is gated on the
`unknown` branch, so a misclassified error leaves a screen containing no fact
about what actually failed. Show it on every branch.

Test: `src/components/ErrorBoundary.test.tsx`

### 2. The AI re-segmentation diff turns entirely green

`src/components/TranscriptEditor/DiffPreview.tsx` and
`src/components/TranscriptEditor/SegmentList.tsx`

Both compare segment boundaries exactly against numbers produced by
arithmetic — DiffPreview keys on the string `` `${start}-${end}` ``, SegmentList
tests `gap < 0`. The re-segmentation path rebuilds every boundary by summing
word durations, so an unchanged boundary comes back ~1e-16 away from the
original and compares as different.

The result: the approval diff marks every suggested line as new and every
original as removed, and the segment list announces `⚠ overlap 0.00s` in red
between lines that are meant to touch. Both are the one job those components
have.

**Fix:** round both sides to the millisecond before comparing
(`Math.round(t * 1000)`), or compare numerically with an epsilon of ~1e-6.

Tests: `DiffPreview.test.tsx`, `SegmentList.test.tsx`

### 3. Editing a transcript line silently destroys the glosses after it

`src/components/admin/AdminTranscriptEditor.tsx`

Token glosses survive a round trip through the editor via a map keyed
`segmentId:index:surface`. Deleting or inserting a word renumbers everything
after it, so each of those words looks up a key that no longer exists: the
gloss is dropped and a fresh id minted. An admin who fixes a typo in the first
word of a ten-word line silently discards nine hand-written glosses. A split
loses every gloss in whichever half gets a new segment id.

**Fix:** carry the token id through `Segment.words` so the map can key on
identity rather than position.

Test: `src/components/admin/AdminTranscriptEditor.test.tsx`

### 4. The alphabet milestone banner counts downwards

`src/components/alphabet/MilestoneBanner.tsx` — `markSeen`

`markSeen` records only the threshold currently on screen. A learner who
reaches 28 letters — or simply opens the app on a second device, where progress
loads in one go — is congratulated on 28, dismisses it, then on the next visit
is congratulated on 21. Then 14. Then 7.

**Fix:** mark every threshold at or below the active one as seen. That is what
"show the highest unseen milestone" already implies.

Test: `src/components/alphabet/MilestoneBanner.test.tsx`

---

## Divide-by-zero, three places

Each shows `NaN` or a false success to the user.

| Component | What happens |
|---|---|
| `quiz/QuizResults.tsx` | An empty answer list gives `0/0` → the screen reads "NaN% correct" under "Try again!", because every band comparison against NaN is false and it falls through to the worst one. |
| `gamification/WeeklyGoalCard.tsx` | A zero target makes the percentage NaN while `0 >= 0` marks the goal complete — the card ticks it, turns it green and fires "Weekly goals complete!" over an empty bar for a week in which nothing was done. |
| `admin/ImagePositionEditor.tsx` | A bare `split(' ')` on `"50  50"` reads the vertical coordinate from an empty string; `Number("")` is 0, the top edge, so the crop moves silently. |

**Fix:** guard the denominator and show a neutral state when there is nothing to
measure.

---

## Props read once and never again

Four components seed state with `useState(prop)` and then ignore every later
value. Each one breaks in the same real situation: a parent that loads its data
asynchronously.

- `admin/ImageUploader.tsx` — `currentUrl`. Admin forms fetch the record they
  are editing, so the field routinely mounts before the URL exists and then
  shows "Click to upload image" over a record that has an image. The admin
  uploads a second copy and orphans the first.
- `transcript/TimeRangeSelector.tsx` — `value`, and it never calls `onChange` on
  mount either, so the parent's range and the on-screen range disagree until a
  handle is dragged.
- `souq-news/ArticleSentences.tsx` — the revealed-line set is keyed by index
  with no dependency on the content, so switching articles leaves the same line
  positions already translated.
- `ContinueCard.tsx` — the server-side lesson fallback has no expiry where the
  local entry has a seven-day one, so a lesson opened once in January is still
  offered as "Continue lesson · 250d ago" in September.

**Fix:** `useEffect` syncing on the prop, or key the component on it.

---

## Audio lifecycle

- `alphabet/LetterAudioButton.tsx` — nothing stops the clip on unmount, so
  tapping a letter and going straight back leaves it playing over the next
  screen. The autoplay branch also never sets `playing` or wires `onended`, so
  on the letter tour the button looks idle for the whole clip.
- `bible/VerseAudioButton.tsx` — `armed` is never cleared, so once a reader has
  listened to one verse, any later change to that row's text synthesises and
  plays on its own. A verse with empty text skips generation but leaves the
  button enabled with no spinner — a partially translated chapter shows
  live-looking buttons that do nothing and say nothing.
- `learn/SoundSpotlight.tsx` — collapsing unmounts the rows and revokes every
  blob, so reopening re-synthesises the lot. Hide with CSS, or lift the
  synthesis above the toggle.
- `learn/IntroCard.tsx` — "Tap the card to hear again" is unconditional, so a
  word with no `audio_url` (the normal state of a freshly authored lesson)
  promises audio that does not exist.

---

## Cost: TTS requested eagerly

`alphabet/LetterAudioButton.tsx` and `learn/SoundSpotlight.tsx` call
`useAzureTTS` with no `skip`, so a screen of 28 letter cards fires 28 TTS
requests before anything is tapped, and every blob is held for the life of the
page. `bible/VerseAudioButton.tsx` shows the pattern to copy: arm on first tap.

`admin/ImageUploader.tsx` calls `URL.createObjectURL` per upload and never
revokes it on any path, so an admin working through a batch pins every original
they touched in memory at full size.

---

## Error messages that say nothing

Several call sites read `error.message` from a supabase-js function invoke.
`FunctionsHttpError` carries the fixed string *"Edge Function returned a non-2xx
status code"* for every failure; the real status and body are on
`error.context`. So a 429 over-quota, a 400 and a 500 are indistinguishable to
the user, and the 429/402 branches written for them are unreachable.

Affected: `admin/AdminTranscriptEditor.tsx`, `review/LeechHelperPanel.tsx`.

**Fix:** read `error.context?.status` and the parsed body before falling back to
`error.message`. A shared helper would be worth it — this pattern is repeated.

---

## Accessibility

- `discover/DiscoverPreviewCard.tsx` — the whole card is a `<button>` whose
  `aria-label` is just the title, so the dialect, level, pace and running time
  inside it are inaudible. A screen-reader user gets none of the four things a
  sighted learner scans to choose between videos.
- `admin/curriculum-builder/ChatSidebar.tsx` — the archive control is
  `opacity-0` until hover with no `focus-visible` rule: invisible to keyboard
  users, unreachable on touch.

---

## Smaller, still real

- `admin/curriculum-builder/ChatSidebar.tsx` — `formatDate` floors a negative
  difference to `-1`, so a session whose server timestamp is a moment ahead of
  the browser clock (i.e. the one just saved) reads "-1d ago".
- `admin/curriculum-builder/ChatWindow.tsx` — a reply that was only a JSON
  payload renders as an empty grey bubble; and the preview button is gated on a
  hardcoded type map, so a generator added server-side produces drafts the admin
  cannot open or approve, with no button, label or warning.
- `MyWordsSection.tsx` — with "Mixed" on, the due count spans every dialect but
  the button routes to a bare `/review/my-words`, which reads the global active
  dialect. The learner is told "Review 3 due" and arrives at a session holding
  one.
- `TranscriptEditor/DiffPreview.tsx` — a boundary the proposal deletes has no
  per-line control, so keeping one merged-away split means rejecting everything.
- `learn/IntroCard.tsx` — `hasPlayed` is written on a card tap and on the clip
  ending, and never read. Either gate Continue on it or remove it.
- `TranscriptEditor/index.tsx` — undo/redo restore editor state but never run
  the debounced save, so an admin who undoes an edit still persists it.
- `shared/AskAISentence.tsx` — a malformed SSE frame is pushed back on the
  buffer and retried forever, silently discarding every token after it; a reply
  with no tokens leaves a permanent spinner.
- `review/ReviewQuizCard.tsx` and `review/ReviewImageQuizCard.tsx` — the option
  set is memoised on `word.id` alone, so a card that renders before its
  distractor pool loads is a one-option card that answers itself.

---

## The suite runs silent

The unit run used to print ~229 warnings — `not wrapped in act(...)`, "Unstubbed
network request", and four requests that escaped to real DNS. All of them are
gone, and it is worth keeping it that way: **a new warning now means something
new is wrong.**

Two causes, both fixed:

- `useAuth` resolves the session on a macrotask, so a test that rendered and
  asserted synchronously ended with the request in flight; it landed after
  `cleanup()` had handed `fetch` back to the hermeticity guard. Fixed once in
  `src/test/support/react/harness.tsx`, which now drains via `onTestFinished`
  — that hook runs after the test body but before any `afterEach`, so the
  component is still mounted and the backend still installed.
- Individual tests that called a state-updating async function outside `act()`,
  or asserted while a query was still settling. Fixed per file.

Two of those were passing only by racing: `RequestSituationCard` and
`SuggestFlashcardsDialog` asserted on the dialect before `DialectProvider` had
synced from the profile and overwritten localStorage. Once the settle was added
they read the profile's dialect and failed. **If you write a test that wants a
non-default dialect, set `personaOptions: { profile: { preferred_dialect } }`
as well as the localStorage key** — otherwise the component drifts back a tick
after render.

### The failure mode to watch for

This has bitten twice and both times turned CI red while every single test
passed: a component that schedules a timer and never cancels it on unmount
fires after jsdom teardown, and Vitest reports an uncaught
`ReferenceError: window is not defined`. `transcript/LineByLineTranscript` and
`alphabet/LetterTracer` both needed their test files put on fake timers with
`vi.clearAllTimers()` at teardown.

**Both underlying components still leak the timer** — the test files are worked
around, not fixed. Cancelling on unmount is the real fix and is worth doing.

## Running the suite

```sh
npm run typecheck          # tsconfig.app.json + tsconfig.e2e.json
npm run lint:ratchet       # fails only if errors rise above the 549 baseline
npx vitest run             # 244 files, ~4553 tests
npm run test:coverage      # same, and enforces the per-directory thresholds
                           # (src/components, src/hooks, src/lib, src/contexts)
npm run test:edge          # 1296 Deno tests; needs deno 2.9.5 on PATH
npm run test:e2e           # 64 Playwright specs; CI shards these four ways
npm run build
```

Check the **exit code**, not the summary line — the suite has printed "passed"
while exiting 1 on an unhandled error.

CI (`.github/workflows/ci.yml`) runs all of it on every pull request across
seven jobs.
