# QA sweep 2026-09-29 — REPORT

Target: https://laha-arabic.lovable.app (the only live domain; see Broken #1). Browser: Claude-in-Chrome, Daniel's profile.
Signed-in role: **admin** (danieljchandler@gmail.com, `/admin` dashboard loads, shows "Admin"). Learner data present (1604 cards due).
Built-in Claude browser is NOT signed in; not used.
Method note: results are appended per route *group* (not per route) and committed per group, to keep the run's context small.
Network 4xx/5xx are only inspected when a page looks broken or logs a console error; a silent failed request may be missed.

## 1. Broken (reproducible)

1. **Canonical domain hakiya.app does not exist.** `nslookup hakiya.app` -> "Non-existent domain"; `curl https://hakiya.app` -> no response; Chrome shows an error page.
   `index.html:25,30,31,39,58` point canonical, og:url, og:image, twitter:image and JSON-LD url at `https://hakiya.app/...`, while `public/robots.txt:6` and `public/sitemap.xml` use `https://laha-arabic.lovable.app`. Link previews (og:image) and search canonicalisation point at a dead host. Files: `index.html`, `public/robots.txt`, `public/sitemap.xml`.

## 2. Suspicious

- Cold deep link to `/admin` in a fresh Chrome tab landed on `/admin/login` (sign-in form) with no `sb-*` keys in localStorage; minutes later the same tab was signed in and `/admin` loaded fine. Could not reproduce or explain; either a session-hydration race or the tab group started without the profile session. Re-tested below if noted.
- First two loads of laha-arabic.lovable.app in Chrome showed a browser error page ("Frame ... showing error page") while `curl` returned 200 from 185.41.148.2 at the same time; third load fine. Likely transient.
- `/today` still shows a `.animate-spin` element 3s after load (content also rendered).

## 3. Passed

- `/` renders landing (signed-out copy shown in an earlier load; signed-in later), no console errors.
- `/choose` renders, "Review 1604 cards" + user_vocabulary REST calls 200, no console errors.
- `/skills/read` renders, no console errors.
- `/auth` while signed in redirects to `/`.
- `/terms`, `/privacy` render with content, no console errors.
- `/me` renders (level 10, 2706 XP-ish, 1604 due), admin link present.
- `/admin` renders dashboard as admin.

## 4. NOT TESTED, needs Daniel

- Microphone / pronunciation scoring, realtime voice (`/conversation`, `/pronunciation`, `/monologue`): needs mic + a human voice.
- Audio playback quality: can't hear audio.
- Stripe checkout and customer portal (`/pricing`, `/settings`): excluded by safety rules.
- Email flows (invites, password reset): can't read his inbox.
- 390px layout: Chrome window is 2560 wide and may refuse to go below ~500px; see per-route notes if achieved.
- Destructive/publishing admin controls: present, not exercised (list per route below).

## 5. Test data created, to clean up

(none yet)
