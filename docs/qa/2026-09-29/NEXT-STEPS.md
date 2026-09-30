# Next steps after the 2026-09-29 QA sweep

Source: [REPORT.md](REPORT.md). Numbers below are its Broken numbers. Ordered by what to do first.

## 0. Verify before fixing (10 minutes, Daniel)
- [ ] **Foreground check of #4/#5/#13/#16.** In a normal visible tab open `/stories`, click a story; then `/discover` -> a video. No "An unexpected error occurred" toast = these four were hidden-tab artifacts (view-transition "Document hidden") and can be closed. If it appears, fix per #16: ignore AbortError/InvalidStateError from `document.startViewTransition` in the global handler.
- [ ] **Run the e2e suite**: `npx playwright install chromium`, then `npm run test:e2e`. It never ran during the sweep (browsers missing).
- [ ] **AI credits**: check the AI gateway balance (the "AI credits exhausted" banner on `/today`). Top up, then retest #3, #6, #7, #8 before touching code: they are probably one cause.
- [ ] **Supabase function logs** for `translate-text`, `culture-guide`, `writing-coach` (502), `reading-passage`, `souq-news` (`ai_rewrite` step). Edge failures are not recorded in `/admin/errors`.
- [ ] **390px pass** on /today, /curriculum, /review, /my-words, /analytics, /discover/:id, /stories/:id, /translate, /settings, /profile. The automated browser could not resize.

## 1. Fix (real bugs, by severity)
1. **#2 `/quiz/:lessonId` crash**, `src/pages/Quiz.tsx:173`: guard an empty/short word list (`currentWord` undefined) and show an empty state. Add a unit test with a lesson under the quiz minimum.
2. **#1 dead domain**: decide the real domain. Either make `hakiya.app` resolve, or change `index.html` (lines 25, 30, 31, 39, 58) to the live host. Make `public/robots.txt` and `public/sitemap.xml` match whichever wins.
3. **#9 / #10 / #6 silent or generic AI failures**: after the credits/log check, fix `translate-text`; make `culture-guide` and `writing-coach` surface an error instead of nothing.
4. **#7 / #8 / #3** (`/today/story`, `/daily-challenge`, `/dialect-compare`, `/souq-news`, `/placement/c-test`): give each an error or empty state; `/souq-news` currently renders a blank page.
5. **#14 / #17 admin edit routes for nonexistent ids** (videos, topics, words, stories, reading-library, curriculum-builder): render not-found when the fetch returns no row.
6. **#4 `/skills/bogus`** should redirect to `/choose` without crashing (manifest says so).
7. **#11 `/settings` dialect picker has no Yemeni option** and no selected card.
8. **#15 `/admin/topics/:topicId/words/bulk`** asks for the microphone on mount; request only on Record.
9. **#12 `/admin/login` while signed in** stays on the form; redirect to `/admin`.

## 2. Look at (Suspicious, decide if real)
- Count mismatches for one user: /choose 1604 due, /my-words 310 words but /review/my-words "1 / 372 due", /profile 1000, /analytics 2145, /admin 304.
- Yemeni content gaps: /discover, /clips, /set-phrases, /bible/lessons empty for Yemeni; admin curriculum/trending/videos show Gulf material under the Yemeni module.
- `/how-do-i-say` hard-codes "Gulf Arabic" in its heading and empty-state copy.
- MSA-ish items in a Yemeni context (pronunciation "فلسفة", vocab-games pairs, how-do-i-say first option).
- `/stories/<fake>` and `/bible/lessons/<fake>` show empty pages instead of not-found.
- Missing accessible names on icon buttons in /transcribe, /tutor-upload, /learn-from-x.
- `/reading-library` title duplicates the suffix; `/admin/login` shows a public "Sign up".

## 3. Process
- [ ] Add the sweep prompt's known gaps to the next run: foreground browser, 390px via Playwright headed, and real POST status capture (the Chrome network tool only logged OPTIONS for edge functions).
- [ ] Clean-up: nothing must be deleted. Optional: remove the one how-do-i-say row in /saved-chats.
