# QA sweep — prompt for a local session

Start a local session in `C:\dev\arabic-buddy`, pull this branch, and say:

> Read and follow `docs/qa/QA-SWEEP-PROMPT.md`.

Before walking away: sign in once in the browser the session will use.

---

## Task

Unattended QA sweep of Hikaya as a real user. Daniel is away and can't answer questions or
sign in. Find what's broken. Do NOT fix anything.

## Keep context small (this is the main constraint)

The sweep is long. A big context makes you confidently wrong, so state lives in files.

- Create `docs/qa/2026-09-29/CHECKLIST.md` first: one line per route/flow, `[ ]` to start.
  Build it from `src/test/support/routes/manifest.ts` and `src/App.tsx`.
- Work **one route at a time**. After each route, append its result to
  `docs/qa/2026-09-29/REPORT.md` (Broken / Suspicious / Passed) and tick the checklist. Then
  commit (`qa: <route>`). Never hold results in your head for later.
- Don't paste page HTML, full console dumps or full network logs into the conversation.
  Save screenshots to `docs/qa/2026-09-29/img/` and note only the relevant line
  (console error text, endpoint + status).
- Prefer screenshots at reduced size and accessibility-tree/text snapshots over full DOM reads.
- If context gets heavy, stop, make sure CHECKLIST.md and REPORT.md are current and committed,
  and say so. A fresh session resumes from the checklist. Don't `/compact`.
- Feel free to delegate a route group to a subagent (one dialect, or one area of the app),
  as long as it writes to the same files and returns only a two-line summary.

## Setup

- Branch: `claude/qa-sweep-2026-09-29` from the latest main. Never push to main.
- Read `CLAUDE.md` and skim `README.md` first.
- Use the deployed app in a browser (Claude-in-Chrome if available, else Playwright headed
  with a persistent profile). Daniel has already signed in. If you get signed out, do NOT ask
  for or type credentials: log "signed out at <time>, <areas> untested" and continue with what
  doesn't need auth.
- At the start, record which account role you're actually signed in as (learner / admin /
  reviewer / transcriber). Everything above that role goes under "Not tested".

## Safety (this hits PRODUCTION Supabase)

- No Stripe checkout, customer portal, delete-account or role/permission changes.
- Nothing on `/admin/id-logins` that mints or disables accounts.
- Don't touch other users' data. Log anything you create so Daniel can clean it up.
- AI-backed features cost real money: exercise each once with a short input, never in loops.
- Never read, list or add `G:\My Drive\oversight` or `O:\` as a directory.
- Never write a secret, token or cookie into any file, log or report.

## Method, per route

1. Load it, use its main controls, submit its forms, try empty and obviously-bad input, then
   go back / refresh mid-flow.
2. Capture: console errors, failed requests (status + endpoint, especially edge-function
   4xx/5xx), blank or forever-spinner states, broken layout, dead links, MSA-looking Arabic
   where a dialect is expected, RTL problems.
3. Repeat at 390px width for each main page.
4. Cover all three dialects (Gulf, Egyptian, Yemeni) wherever there's a dialect switch.
5. Once, at the start, run `npm run typecheck` and `npm run test:e2e`; record failures
   verbatim in REPORT.md (first ~30 lines of each failure only).

## REPORT.md structure

1. **Broken** (reproducible): route, steps, expected, actual, evidence, suspected file if
   obvious. Ranked by severity.
2. **Suspicious** (odd, unsure).
3. **Passed**: one line per route/flow that worked.
4. **NOT TESTED, needs Daniel**: each item with the reason and exactly what he must do.
   Expect at least: microphone / pronunciation scoring, realtime voice, audio playback
   quality, Stripe checkout and portal, any view above the signed-in role, email flows
   (invites, resets), anything lost to a sign-out, anything skipped for cost or safety.
5. **Test data created, to clean up.**

Terse and factual. Quote failing output. "Passed" means you saw it work. Name skipped steps
as skipped.

## Finish

Push the branch and open a draft PR whose body links `docs/qa/2026-09-29/REPORT.md` and
lists the top five broken items.
