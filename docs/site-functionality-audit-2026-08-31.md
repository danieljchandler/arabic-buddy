# Site functionality audit — 2026-08-31

> **Status (end of day):** all 🔴 critical/high findings and most 🟠 medium
> findings below were fixed on this branch the same day — see the commit
> history from `7c661c3` through `7c67cc4` for what changed and why. Validated
> with typecheck, the lint ratchet, the full unit suite, and all four e2e
> shards green (2,084 tests); the Deno edge checks and migration replay run in
> CI. Still open, deliberately: the ~30 direct-gateway functions that log no
> LLM usage and hardcode model IDs (a batch refactor through the brain or
> registry, not a spot fix), server-side voice session reconciliation (the
> client-side unload report shipped; a per-session server floor needs schema),
> the assistant time-to-first-token pre-work, the orphaned `/quiz/:lessonId`
> route (decide: link it or delete it), the half-dead TranscriptionJobContext,
> and the remaining 🟡 low items not called out in commit messages.

Nine parallel audit passes over the whole codebase: a live run of the full test/build
suite, plus static audits of routing/auth, the learner core (SRS/lessons/quizzes),
the AI assistant, AI-generation edge functions, billing/access/security,
admin/transcript review, the data layer (migrations vs types vs queries), and
frontend hooks/audio/UI. **Findings only — nothing has been fixed.** Severities:
🔴 critical/high, 🟠 medium, 🟡 low.

---

## Executive summary — the most serious problems

1. 🔴 **The lesson import is broken in production and every test layer is blind to it.**
   `useLessonImport.ts:65-71` inserts seven columns (`unlock_condition`,
   `lesson_sequence`, `image_scenes`, `flashcard_spec`, `real_world_prompts`,
   `design_rationale`, `sound_spotlight`) that production's `lessons` table does not
   have. The migration history contains two disjoint `lessons` shapes
   (`20260224000000` vs `20260321182338`) and no migration produces their union;
   the freshly regenerated `types.ts` proves production is the shape *without* the
   seven columns. Every import 400s (`PGRST204`). The `typesDrift` allow-list pins
   exactly these columns, so the emulator, e2e, and contract tests all pass against
   a union schema that matches neither production nor a rebuilt DB. Read side:
   `useTopic.ts:95-111` / `useLessons.ts:60` read those fields → `undefined` →
   SoundSpotlight/LessonPlanSection silently render nothing in production.

2. 🔴 **The "stuck video" fix (commit 80d8912) is dead on arrival.**
   `analyze-gulf-arabic` writes `transcription_status: 'analysis_complete'`
   (index.ts:1855, 2874) but the CHECK constraint from
   `20260310200000_auto_transcription_status.sql:4-5` only allows
   `manual|pending|processing|completed|failed` and was never relaxed. The persist
   fails, the error is swallowed (`console.error` only), the row stays `processing`,
   and the run ends `failed` — the exact symptom the commit tried to fix. The new
   reaper's promote branch (`20260831081005`) can never fire because no row can hold
   `analysis_complete`. (If the constraint was hand-dropped in prod, the migrations
   no longer describe production.)

3. 🔴 **The same new migration breaks migration-replay CI**: `20260831081005` runs
   `CREATE EXTENSION pg_cron` + `cron.schedule` unguarded; stock `postgres:16` has
   no pg_cron, the file isn't in `KNOWN_REPLAY_FAILURES`, and there's no cron stub
   in `contract/prelude.sql`. The replay job goes red on the next push, and the
   file half-applies (psql runs without `--single-transaction`). The pgvector DO-block
   guard pattern from `20260812160000` exists in-repo and wasn't followed.

4. 🔴 **Stuck-`pending` videos are a dead end with the escape hatch disabled.**
   The reaper covers only `processing` and `analysis_complete`; a row stuck at
   `pending` (lost kickoff, `waitUntil` isolate death — `extract-visual-context`
   index.ts:255-295) sits at "queued" forever, and `AdminVideoForm.tsx:481-487`
   sets `isProcessing=true` on `pending`, disabling every re-transcribe control
   (:1539, :1553, :1586).

5. 🔴 **Personal-deck review sessions tear down and reshuffle after every new card's
   first rating.** `MyWordsReview.tsx:217-224` puts `remainingNewBudget` in the
   due-words queryKey; rating a new card invalidates `daily-new-card-count`
   (`useNewCardBudget.ts:48`) → key change → full loading swap + a rebuilt,
   reshuffled deck mid-session while `currentIndex` points into the old ordering →
   cards skipped/repeated, once per new card. The curriculum deck has the same key
   dependence (`useReview.ts:100`), triggered on window-refocus refetch.

6. 🔴 **Replaying a lesson quiz silently drops every rating and corrupts SRS state.**
   `Learn.tsx:116-139` snapshots reviews once with a narrow select (no `lapses`,
   `difficulty`, `production_next_review_at`) and never refetches. Consequences in
   `buildReviewUpdate` (`useReview.ts:300-361`): replayed first-rated words hit the
   INSERT branch again → unique-violation → error swallowed at `Learn.tsx:248`
   (all replay ratings lost); `lapses` clobbered to 1 (un-flagging leeches);
   `production_next_review_at` yanked to *now* on every good/easy answer;
   `difficulty` reset to 5.0.

7. 🔴 **Heavy users break at 1,000 rows.** `useDueWords`/`useReviewStats`
   (`useReview.ts:106-145, 232-245`) are unbounded; PostgREST truncates at 1000.
   Past 1000 review rows, reviewed words are presented as brand-new, ratings take
   the INSERT branch, hit the duplicate-key violation, and are permanently dropped
   (`useReviewQueue.ts:114-123`). The repo already knows the fix pattern
   (`useSRSStats.ts:99-104`, `useUserVocabulary.ts:41-64`).

8. 🔴 **Arabic cloze cards can render empty and unratable.** `MyWordsReview.tsx:436-438`
   gates cloze on raw `includes()`, but `ReviewClozeCard` needs a standalone token
   (`findWordSpan`) and returns null otherwise — routine in Arabic (بيت inside
   بيتي/البيت). Result: no card body, rating buttons locked behind "Pick an answer
   first"; only Skip escapes; recurs every session.

9. 🔴 **Learner-generated flashcard images on curriculum words are silently
   discarded.** `Review.tsx:850-861` updates `vocabulary_words.image_url`
   client-side; RLS restricts UPDATE to admin/recorder → 0 rows, no error,
   "Image generated!" toast, refetch wipes the image. AI cost spent, nothing saved.

10. 🔴 **An aborted/empty assistant chat stream poisons the conversation.**
    `ChatTab.tsx` removes the empty placeholder only on non-abort errors; closing
    the panel or switching to Voice mid-stream leaves an empty assistant message
    that (a) renders as a permanently spinning ThinkingBubble and (b) is re-sent on
    every later turn — Anthropic rejects empty-content messages, so the whole
    conversation 400s ("Couldn't reach the assistant") until New chat. Also
    reachable via a zero-delta stream (`sseChat.ts` never checks the resolved value).

11. 🔴 **Voice minutes are metered entirely by client self-report.** Usage is
    written only from the client's `action:"report"` fired in React cleanup
    (`useOpenAIRealtime.ts`); there is no `pagehide`/`beforeunload` handler, so
    closing the tab records zero seconds (honest users under-counted; dishonest
    clients unlimited). Budget is checked only at mint (1s remaining → full
    uncapped call, no mid-call cutoff); assistant mode has no per-day session
    throttle; `realtime-session-token/index.ts:159-215`, `voiceBudget.ts:57-71`.

12. 🔴 **Recorder role gets admin video controls that silently no-op.**
    `canManage` includes `isRecorder` (`AdminVideos.tsx:106-107`,
    `AdminVideoForm.tsx:144`) but RLS grants writes only to admin/content_reviewer
    and unpublished SELECT excludes recorder. `useTogglePublish`/`useDeleteDiscoverVideo`
    check no affected rows → recorder sees "Published"/"Video deleted" success
    toasts while nothing happened.

13. 🔴 **Listening practice (and daily challenge fallback) feed the model random
    curriculum words as "words the student knows."** `listening-quiz/index.ts:28,42-54`
    accepts client-supplied `words`; `ListeningPractice.tsx:179-190` sends
    `allWords.slice(0,30)` shuffled. `daily-challenge/index.ts:57-61` falls back to
    the same client list exactly for new learners. Both violate the documented
    server-side learner-profile rule; personalization is fake.

14. 🔴 **`draft_critic` silently degenerates to solo.** `aiBrain.ts:812-814` runs
    the critic only with `alwaysCritique`/`qualityGate`/`enforceDialect`;
    `generate-story`, `dailyStory.ts`, and `translate-story-dialect` get no critique
    and no dialect enforcement despite comments claiming otherwise — interactive
    stories are drafted by the cheapest model unchecked.

15. 🔴 **CI e2e is red right now**: 2 deterministic failures in
    `e2e/admin-access.spec.ts:403,424` — a new per-row "Copy access link" button
    makes the bare `.getByRole('button')` locator ambiguous under strict mode.
    Stale test locators; the feature itself looks fine. Any push will fail CI's
    e2e job until fixed.

16. 🔴 **Episode audio keeps playing after leaving the Listen page.**
    `ListenEpisode.tsx` creates detached `Audio` elements with no unmount cleanup —
    navigation leaves the episode playing over the next page with no way to stop it
    short of reload. Also: pause→play restarts from 0:00 (no resume), and the
    header play/pause state desyncs.

17. 🔴 **Tutor-upload flashcard creation lies on failure.**
    `useTutorUpload.ts:370-389` — any non-duplicate batch-insert failure logs to
    console then shows "Created N flashcards!" and advances, with zero rows saved.

18. 🔴 **Mid-recording navigation is unhandled in pronunciation practice.**
    `PronunciationPractice.tsx:125-171`: no unmount cleanup (mic stays live; timer
    fires post-unmount and sends a paid Azure scoring call); Previous/Next stay
    enabled while recording and `onstop` closes over the old word → word A's score
    renders under word B and pollutes session scores. `useShadowRecorder.ts:38-50`
    similarly fires completion callbacks after unmount.

---

## Full findings by area

### A. Live test/build run

- `npm ci` ✅ (npm audit: 3 moderate + 1 high dep vulnerabilities)
- `typecheck` ✅ · `lint:ratchet` ✅ at exactly baseline 533 (CLAUDE.md says 537 — stale doc; zero headroom)
- `test:coverage` ✅ 339 files, 5851 passed / 5 skipped, thresholds met
- `build` ✅ (Tailwind warning: ambiguous `duration-[400ms]` class)
- `test:e2e` ❌ 2081 passed, **2 failed** — `e2e/admin-access.spec.ts:403,424`, strict-mode
  ambiguity from the new "Copy access link" row button (see summary #15)
- Deno checks: not runnable in this environment (deno absent) — unverified here

### B. Routing, navigation, auth

- 🟠 `AdminSetPhrases.tsx:125` back button → `/admin/dashboard`, which doesn't exist → 404.
- 🟠 `/quiz/:lessonId` (App.tsx:289) is orphaned — nothing links or navigates to it; the
  `NO_LINK_NEEDED` excuse in `routeReachability.test.ts:36` is factually false. The page
  also records nothing (no lesson_progress, no SRS) and its "your answer" UI is dead.
- 🟠 `Auth.tsx:126-152` signup + invite redemption breaks if email confirmation is on
  (no session → RPC 'Not authenticated' → account created, user signed out with a
  misleading error, invite seat never consumed). Race with the `/onboarding` navigate
  even when auto-confirm is on.
- 🟡 Admin deep links never survive login (`AdminLayout.tsx:34` no `state.from`;
  `AdminLogin.tsx:76` hardcodes `/admin`); also a back-button history trap (missing
  `replace: true`).
- 🟡 `MyTranscriptions.tsx:51` uses `?redirect=` which Auth never reads.
- 🟡 `ResetPassword.tsx:21-45` leaks its auth subscription (cleanup returned from inner
  async fn) and can show "link expired" and the working form simultaneously.
- 🟡 Google OAuth drops the post-login destination (`Auth.tsx:347-349`).
- 🟡 One transient `has_role` RPC failure logs a legitimate admin out to `/admin/login`
  (`useAdminAuth.ts:75-118`, no retry).
- 🟡 `lazyRetry.ts:39-44` infinite reload loop when sessionStorage throws.

### C. Learner core (SRS, lessons, quizzes)

- 🔴 Mid-session deck teardown/reshuffle on every new-card rating (summary #5).
- 🔴 Lesson-quiz replay drops ratings + corrupts lapses/difficulty/production schedule (summary #6).
- 🔴 Unbounded queries hit the 1000-row PostgREST cap; ratings permanently dropped (summary #7).
- 🔴 Empty unratable cloze cards on clitic/article forms (summary #8).
- 🔴 Curriculum flashcard images silently discarded by RLS (summary #9).
- 🟠 Creating a jingle on a brand-new curriculum card fabricates a review object with no
  `id` → `UPDATE .eq("id", undefined)` → that card's first rating permanently errors
  (`Review.tsx:205-220`, `useReview.ts:390-395`).
- 🟠 Retention math wrong: `(reps−lapses)/reps` double-penalizes (10 successes + 5 lapses
  → 50% vs true 67%) and feeds FSRS calibration → systematic ~10-30% interval
  compression (`srsStats.ts:99-117`).
- 🟠 Grammar-drill localStorage restore re-asks the last question and re-posts ALL
  outcomes → mastery double-counted (`GrammarDrills.tsx:123-132`; entry never cleared).
- 🟠 "Next up" lesson pointer ignores stages — `display_order` is per-stage, so Stage 1/2/3
  Lesson 1 tie and a fresh learner's Next-up can land on Stage 3 (`Curriculum.tsx:77-85`,
  `lessonPath.ts:64-74`).
- 🟠 Quiz Continue button double-press inflates the score denominator and double-submits
  SRS (`QuizCard.tsx:107-109`; `Review.tsx:279` handleRate similarly unguarded).
- 🟠 Due-count includes new cards beyond the exhausted daily budget → auto-navigate into
  an empty "No saved words due" deck; Home vs Review badges disagree
  (`useUserVocabulary.ts:72-122`, `Review.tsx:423-426`).
- 🟡 `MyPhrasesReview` handleRate: no try/catch, no in-flight guard.
- 🟡 New card rated Again is never re-served in-session (`Review.tsx:306-308`).
- 🟡 Personal-deck transliteration never selected, hardcoded null → its UI is dead.
- 🟡 Undo doesn't refund the new-card budget; `is_leech` written from stale counts.
- 🟡 `useUpsertLessonProgress` read-error path can overwrite a higher best score.
- 🟡 Mixed-mode Learn can swap its 5 words mid-session on focus refetch.
- 🟡 `useSetPhrases` stores minute-scale steps as `interval_days: 1`.

### D. AI assistant (chat + voice)

- 🔴 Aborted/empty stream poisons the conversation (summary #10).
- 🔴 Voice metering client-reported only; no unload path, no mid-call cutoff (summary #11).
- 🟠 `streamBrain` calls `onComplete` twice on MSA-leak detection → two racing
  `updateLearnerMemory` jobs, last writer may be the uncorrected text
  (`aiBrain.ts:1199-1230`).
- 🟠 `sseChat.ts:93-104` re-buffers an unparseable frame forever → rest of the reply
  silently dropped and returned as success; upstream in-stream error frames ignored.
- 🟠 "New chat" during an active stream neither aborts nor re-targets it → reply
  vanishes, tokens keep billing, composer locked (`AiAssistantContext.tsx:115-119`).
- 🟠 `clampPageContext` never bounds document line count → 2000-line transcripts ship in
  full with every chat POST and voice mint (`pageContextCore.ts:310-337`).
- 🟠 First token gated on serial pre-work with 10-30s timeouts (`assistant-chat/index.ts:131-194`).
- 🟡 Failed voice transcription leaves the turn stuck partial forever; End-call during
  connect ends in an error banner; mic permission requested before entitlement checks;
  upstream 429 mislabeled "Daily free limit reached"; dead export `serializePagePayload`;
  `toolNamesRef` never cleared across sessions.

### E. AI generation edge functions

- 🔴 `listening-quiz` (and `daily-challenge` fallback) run on forbidden client-supplied
  vocab (summary #13).
- 🔴 `draft_critic` degenerates to solo for stories (summary #14); `runDraftCritic` also
  discards single-model overrides (`aiBrain.ts:727-729`).
- 🔴 `generate-suggested-story-text` self-contradictory prompt (dialect identity + "write
  MSA") and every deliberate-fusha import files high-severity MSA violations plus fake
  native-review tasks (`index.ts:74-88`; leak scan not skippable).
- 🟠 `souq-news` generates learner-facing Arabic outside the brain: no MSA detection, no
  repair, no usage logging, no fetch timeout (`index.ts:183-200`).
- 🟠 Anthropic tool-call retry nudge is a no-op (`opts.systemParts` wins over rewritten
  `opts.system`; `aiBrain.ts:602-612`) — affects transcript retranslation and
  publish-verified-clips.
- 🟠 ~30 direct-gateway functions log no LLM usage — cost dashboard undercounts
  (souq-news, daily-challenge, placement-quiz, pronunciation-feedback, translate-phrase,
  rate-video-cefr, suggest-flashcards, bible-passage, analyze-gulf-arabic, …).
- 🟠 Widespread hardcoded model IDs bypass `modelRegistry.ts` (13+ functions; some use
  `google/gemini-2.5-flash` which isn't even in `MODEL_IDS`).
- 🟡 `hf-chat` passes client strategy string unvalidated → unknown value → TypeError 500;
  clients can force the 4-call council path.
- 🟡 `pronunciation-feedback` returns 200 + empty tips on parse failure; `listening-quiz`
  ships a stub quiz from its catch-all.
- 🟡 No fetch timeouts on several direct gateway calls.
- 🟡 TTS pin doesn't survive a `/models` discovery outage, contradicting
  `docs/tts-voice-routing.md` (`ttsVoiceRoutingCore.ts:224`).
- 🟡 Several stale/wrong comments in `modelRegistry.ts` and `how-do-i-say`.

### F. Billing, access, security

- 🔴 Voice budget evadable (same as D; `realtime-session-token`, `voiceBudget.ts`).
- 🟠 `user_concept_mastery` retains client INSERT/UPDATE policies (inert today, a
  grant away from bypassing the mastery ladder) — the exact trap already removed for
  `usage_counters` (`20260731120000:63-75`).
- 🟡 CORS localhost match is unanchored `startsWith` → `http://localhost.evil.com`
  passes (`cors.ts:31`).
- 🟡 `request-situation-phrases` is the one model-calling generator with no daily cap.
- 🟡 `config.toml` comment/value mismatch on `generate-story-cover` (`verify_jwt=false`).
- 🟠 **Functional**: referral credit is never granted when the referrer had no Stripe
  customer at conversion — row left `converted`, the grant path only fires on
  `pending` (`check-subscription/index.ts:184-190`).

### G. Admin, video workflow, transcript review

- 🔴 `analysis_complete` violates the CHECK constraint → stuck-video fix dead (summary #2).
- 🔴 pg_cron migration breaks replay CI (summary #3).
- 🔴 Stuck-`pending` dead end with disabled retry controls (summary #4).
- 🔴 Recorder controls silently no-op against RLS (summary #12).
- 🟠 Debounce-save fix applied only to "Save transcript": "Update Video"
  (`AdminVideoForm.tsx:1327`) and `toggleReviewed` (:324-342) still lose/ignore the
  last keystroke inside the 800ms debounce window — the regression 5a0aead claims to fix.
- 🟠 The reaper "promotes" videos with a bare status flip, skipping
  `withoutOnScreenLines()` + `alignLinesToAudio()` + finalization → reaped videos go
  live with caption lines in the transcript and unaligned timings.
- 🟠 Error messages tell staff to "press Retry" — no Retry button exists anywhere.
- 🟠 `analysis_complete` is invisible to the client: polling stops, `isProcessing` never
  clears → "Processing on server…" until manual reload; no list badge.
- 🟠 Admin-only edge functions behind buttons offered to wider roles: meme upload by a
  content reviewer is marked `failed` ("Admin access required",
  `extract-visual-context:196-201`); "Re-read screen text" and "Auto-rate" 403 for
  reviewers.
- 🟡 Review-queue progress counts raw review rows (orphaned/stale ticks) and disagrees
  with the workspace's snapshot-aware progress.
- 🟡 Draft banner tells transcribers to press "Update Video", a button they don't have.
- 🟡 `handleSave` reassigns `created_by` to whoever presses Update Video; dead
  `ensurePendingVideoRecord`; `TranscriptionJobContext.startJob` never called (banner
  can never render); staged audio URLs expire after 1h with no refresh.

### H. Data layer (migrations vs types vs queries)

- 🔴 Lesson import column mismatch + typesDrift blindness (summary #1).
- 🔴 pg_cron replay breakage (summary #3, confirmed independently).
- 🟠 `feedback-screenshots` bucket never created by migrations (policies exist; upload
  fails on any rebuilt environment).
- 🟠 Three untracked production tables beyond the pinned two: `user_difficulty`
  (skill radar), `weekly_recommendations` (weekly coach), `learning_paths` —
  schemaContract's completeness test checks against types.ts so misses them.
- 🟠 `user_vocabulary.sentence_text/sentence_english` written by core flows
  (SaveUnknownsBar, Anki import, TappableArabicText) exist in no migration —
  "save unknown words" 400s on a rebuilt DB.
- 🟠 Two migrations violate the two-file enum rule (`20260413000000`,
  `20260706075500`) — fail under single-transaction runners; the UUID twin migrations
  suggest the handwritten files never applied cleanly to prod.
- 🟡 Pinned replay failures apply *partially* under autocommit: a rebuilt DB shows
  draft lessons to everyone and loses the role-helper REVOKEs plus two storage
  ownership policies (`20260529150401` §§8-10, `20260529155315`). Production itself is
  fine (`has_role` grant chain verified end-to-end).
- 🟡 `grant_achievement()` references untracked `review_streaks` → raises at first
  streak-achievement claim on a rebuilt env.
- 🟡 `curriculum_chat_approvals` has two irreconcilable shapes (latent).
- 🟡 `EditableTranscript.tsx:478` client line ids use `Date.now()` — same-millisecond
  adds collide, and reviews/revisions/comments key off that id.

### I. Frontend hooks, audio, UI

- 🔴 ListenEpisode audio survives navigation; no resume; desynced play state (summary #16).
- 🔴 Tutor-upload success toast on failed insert (summary #17).
- 🔴 Pronunciation recording unmount/word-switch bugs (summary #18).
- 🟠 `audioToWav.ts` leaks an AudioContext per failed decode → after ~6, all scoring,
  clipping, and TTS decoding fail until reload.
- 🟠 `useShadowQueue` applies the dialect filter after `.limit(40)` → Yemeni/Egyptian
  learners see "No native clips available yet" while eligible clips exist; query errors
  silently produce the same empty state.
- 🟠 DiscoverVideo subtitle clock freezes when the video row refetches mid-playback
  (transcript highlight stops until pause/play).
- 🟠 ConversationSimulator: mic and SSE survive unmount; TTS blob URLs never revoked.
- 🟠 Watch-progress reporting refetches the entire discover feed every ~10s of playback.
- 🟠 SetPhrasesPractice: unchunked `btoa(String.fromCharCode(...))` throws RangeError on
  recordings >~64KB — longer voice answers crash scoring; recorder also lacks unmount cleanup.
- 🟠 `TranscriptionJobContext` is half-dead (startJob never called; complete state unreachable).
- 🟠 `useVideoSync` highlight listener never attaches when the media element mounts late
  → no karaoke highlight in that case (file's own comment admits the pattern).
- 🟡 Pass-threshold state unusable (hardcoded 75); word-fetch errors shown as "add words
  first"; TTS fallback drops the dialect (Egyptian/Yemeni get the Saudi voice);
  VideoRating error handling resets instead of restoring; ContentRequestBar double-Enter
  double-inserts; "Heard:" bidi label renders reversed; space emitted before Arabic
  punctuation; MarkUnknowns provider-less fallback allocates per render; stale dialect in
  tutor uploads; MyPhrasesReview mutates the react-query cache in place.

---

## Cross-cutting themes

1. **Silent-failure epidemic.** The single most common root cause: errors checked
   nowhere (`{ data }` destructures), RLS-filtered 0-row writes with success toasts,
   swallowed catch blocks with `console.error`, and 200-with-garbage fallbacks. Most
   of the "site feels broken but nothing errors" experience traces to this.
2. **Schema drift with pinned-baseline blindness.** The typesDrift/schemaContract/replay
   baselines pin gaps as "known" but several pins are factually wrong, so the tests
   pass while production 400s (lesson import) or rebuilt environments break (buckets,
   untracked tables, partial migrations).
3. **The recent hot-fix commits didn't land.** "Fixed stuck video workflow" is blocked
   by a CHECK constraint and breaks CI; "Fixed reviewer audio & save" fixed one save
   path and left the identical bug on two adjacent ones.
4. **Client-trust violations resurfacing.** Client-supplied vocab lists (listening-quiz,
   daily-challenge), client-only voice metering, and client-writable-policy traps —
   each contradicts a rule the codebase itself documents.
5. **Audio/mic lifecycle.** Almost every recorder/player outside the shared hooks leaks
   on unmount: live mics, playing audio, AudioContexts, blob URLs, post-unmount paid
   API calls.
6. **Query invalidation shape bugs.** Budget-in-queryKey teardown, 10s feed refetch
   loops, refetch-freezes-subtitles — reactivity wired to the wrong keys.
