# QA sweep 2026-09-29 — REPORT

Target: https://laha-arabic.lovable.app (the only live domain; see Broken #1). Browser: Claude-in-Chrome, Daniel's profile.
Signed-in role: **admin** (danieljchandler@gmail.com, `/admin` dashboard loads, shows "Admin"). Learner data present (1604 cards due).
Built-in Claude browser is NOT signed in; not used.
Method note: results are appended per route *group* (not per route) and committed per group, to keep the run's context small.
Network 4xx/5xx are only inspected when a page looks broken or logs a console error; a silent failed request may be missed.

## 1. Broken (reproducible)

1. **Canonical domain hakiya.app does not exist.** `nslookup hakiya.app` -> "Non-existent domain"; `curl https://hakiya.app` -> no response; Chrome shows an error page.
   `index.html:25,30,31,39,58` point canonical, og:url, og:image, twitter:image and JSON-LD url at `https://hakiya.app/...`, while `public/robots.txt:6` and `public/sitemap.xml` use `https://laha-arabic.lovable.app`. Link previews (og:image) and search canonicalisation point at a dead host. Files: `index.html`, `public/robots.txt`, `public/sitemap.xml`.

2. **`/quiz/:lessonId` crashes for every real lesson.** Steps: /curriculum -> take real ids 96d72ee2-..., 6b96b203-..., 63298e7b-... -> load `/quiz/<id>` (full load). Expected: quiz. Actual: error boundary "Something went wrong / This page hit an error while loading", details: `Cannot read properties of undefined (reading 'id')`. 3/3 ids reproduce; `/learn/<same id>` works. Fake uuid gives a clean "Topic not found". Suspect `src/pages/Quiz.tsx:173` (`key={currentWord.id}` with currentWord undefined, e.g. empty/short quiz word list). No console error captured.

3. **`/placement/c-test` shows "Edge Function returned a non-2xx status code" + "Try again"** on load (reproduced 3 loads, Yemeni Advanced C-test). Called function: `reading-passage` (`src/pages/CTest.tsx:62`). Status code not captured (network tool did not log functions calls). Likely tied to "AI credits exhausted" banner on /today (see section 2).

4. **Unknown skill id crashes and leaves a sticky crash banner.** `/skills/bogus` (full load) -> error boundary fires, app redirects to /choose with toast "An unexpected error occurred", and sets sessionStorage `__app_last_crash`. Every later page in that tab (e.g. /leaderboard) then rendered only "The app crashed recently / Details logged to the console. Please try again." instead of its content until the key was cleared or the page reloaded again (a later /leaderboard load was fine). Expected: a not-found state for an unknown skill, no crash. Suspect `src/pages/Skill*.tsx` route param handling plus the crash-flag logic that reads `__app_last_crash`.

## 2. Suspicious

- Cold deep link to `/admin` in a fresh Chrome tab landed on `/admin/login` (sign-in form) with no `sb-*` keys in localStorage; minutes later the same tab was signed in and `/admin` loaded fine. Could not reproduce or explain; either a session-hydration race or the tab group started without the profile session. Re-tested below if noted.
- First two loads of laha-arabic.lovable.app in Chrome showed a browser error page ("Frame ... showing error page") while `curl` returned 200 from 185.41.148.2 at the same time; third load fine. Likely transient.
- `/today` still shows a `.animate-spin` element 3s after load (content also rendered).
- `/today` (2nd load, admin): top banner "AI credits exhausted. Please add credits to continue generating fresh phrases." Likely the workspace AI gateway is out of credits (402). Probable root cause of Broken #3 and of the /set-phrases emptiness; not verified.
- `/set-phrases`, `/set-phrases/practice`, `/set-phrases/review`: Yemeni has 0 phrases. Review says "No phrases available — ask an admin to seed some. No phrases ready yet."; practice shows a spinner ~3s then "No phrases ready yet." Either the Yemeni set-phrase seed is missing or generation (see credits banner) failed. Not seen with Gulf/Egyptian (dialect not switched).
- Count mismatches for one user: /choose "Review 1604 cards"; /my-words "Review 452 due words", title "My Words (310)"; /review/my-words "1 / 372 due" (372 > 310 words in list); /analytics "Total Words 2145". Might be different definitions (curriculum vs my words vs all), but 372 due of a 310-word list looks wrong.
- `/review` first "Reveal Arabic" click via a ref click (ref_9) left the card unrevealed in an immediate screenshot; a scripted `.click()` revealed it. Possibly just animation timing; not reproduced further.
- `/onboarding` heading renders as "!أهلاً وسهلاً" in DOM text order (the "!" is first in logical order); visually fine in a 0.4 screenshot but check RTL punctuation in source.
- `/pricing` copy says "You're on the All-In plan" for the admin account (expected for admin/beta? unverified).

## 3. Passed

- `/` renders landing (signed-out copy shown in an earlier load; signed-in later), no console errors.
- `/choose` renders, "Review 1604 cards" + user_vocabulary REST calls 200, no console errors.
- `/skills/read` renders, no console errors.
- `/auth` while signed in redirects to `/`.
- `/terms`, `/privacy` render with content, no console errors.
- `/me` renders (level 10, 2706 XP-ish, 1604 due), admin link present.
- `/admin` renders dashboard as admin.
- Group 1 passed (rendered content, no console errors, no horizontal overflow at 2560px): /today (content; see suspicious re banner), /skills/listen, /skills/speak, /skills/write, /leaderboard (fresh load; rank #1 shown), /pricing (shows "You're on the All-In plan"), /onboarding (step 1 of 5 only), /reset-password (form only), /curriculum, /learn (flashcards), /learn/96d72ee2... (lesson page), /learn/<fake uuid> and /quiz/<fake uuid> ("Topic not found" + Go Home), /placement (intro), /bridge, /grammar, /alphabet, /alphabet/sounds, /alphabet/alif, /alphabet/checkpoint/0 (locked state), /review (reveal + Good rating worked, +15 XP, next card loaded), /review/my-words, /review/my-phrases ("Deck complete"), /my-words, /mistakes, /analytics, /set-phrases (renders; empty, see suspicious).

## 4. NOT TESTED, needs Daniel

- Microphone / pronunciation scoring, realtime voice (`/conversation`, `/pronunciation`, `/monologue`): needs mic + a human voice.
- Audio playback quality: can't hear audio.
- Stripe checkout and customer portal (`/pricing`, `/settings`): excluded by safety rules.
- Email flows (invites, password reset): can't read his inbox.
- 390px layout: Chrome window is 2560 wide and may refuse to go below ~500px; see per-route notes if achieved.
- Destructive/publishing admin controls: present, not exercised (list per route below).
- Group 1: 390px check impossible: `resize_window` to 390x800 reported success but `innerWidth` stayed 2560, so no mobile layout was seen for any group-1 route. Daniel: check /today, /curriculum, /review, /my-words, /analytics at phone width.
- Group 1: dialect switch (Gulf/Egyptian) not exercised on these routes; only Yemeni seen. /pricing checkout/portal ("Manage" button), /onboarding steps 2-5 and reset-password submit: present, not exercised. Mic/audio ("Say it", alphabet sound pairs) not tested.
- Group 1: /alphabet/checkpoint/0 is locked ("Master letters 1-7 first"), so the checkpoint itself was not seen. /learn flashcard "Practice a sentence"/Generate Image/jingle buttons not clicked (AI cost).

## 5. Test data created, to clean up

(none yet)
- Group 1 (learner core): answered 1 SRS card ("Good") on /review (curriculum deck, "I drink"), +15 XP. No other data created. `__app_last_crash` sessionStorage key was cleared by me in-tab (harmless).
