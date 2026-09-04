# qa/ — live pre-production QA harness

Everything in here runs against the **real** Supabase project, unlike `e2e/`,
which is hermetic. It exists so the same crawl can be re-run after each fix
round without re-deriving the app map.

| File | What it does |
| --- | --- |
| `build-map.mjs` | Regenerates `QA_MAP.md`: every route → page → tables/RPCs/edge functions/buckets, annotated with the RLS SELECT policy (from a migration replay) and what the anon role actually gets from production. Hand-edit `flows.md` only. |
| `flows.md` | The hand-written flows section of the map. |
| `playwright.qa.config.ts` | Serves `dist/` with `vite preview` (same production fallbacks a Lovable preview uses) and drives Chromium against it. Not the e2e config: nothing is stubbed. |
| `support.ts` | Monitors (console, page errors, every 4xx/5xx and network failure classified by layer: rest / storage / functions / auth), page-state reader, session injection, the Node-side relay for Supabase traffic. |
| `crawl.spec.ts` | One test per manifest route (live ids substituted where they exist). Loads the page, screenshots it, records failures, then clicks every safe control and records what happened (navigated / dialog / DOM change / request / **no-op**). Paid controls are listed as "needs live API test", never clicked. |
| `resilience.spec.ts` | Injects a backend 500, a network drop, and a 4s delay on every Supabase call for the key routes and records whether the UI shows an error, spins forever, or silently renders an empty state. |
| `media.spec.ts` | Opens one YouTube and one TikTok Discover video, checks the player and the transcript timings, and records every storage/function failure the page makes. |
| `report.mjs` | Merges `output/routes`, `output/resilience`, `output/media` into `output/crawl-report.md` + `.json`. |
| `gallery.mjs` | Builds `output/gallery.html`, one page with every screenshot as a thumbnail and its verdict. |
| `probe-page.mjs`, `probe-summary.mjs` | One-route tracers: every Supabase request/response in order, or request counts by endpoint. |
| `output/schema/` | The Phase-2 evidence: replayed RLS policies and buckets (`rls-*.txt`, `buckets.txt`), the live anon probe of every table (`anon-table-probe.txt`), edge function preflight/deploy status (`fn-preflight.txt`) and guard classification (`fn-guards.txt`), client write-vs-policy cross-check (`client-writes.txt`). |

## Running it

```sh
npm run build                                   # dist/ with the production project baked in
npx playwright test -c qa/playwright.qa.config.ts crawl.spec.ts
npx playwright test -c qa/playwright.qa.config.ts resilience.spec.ts media.spec.ts
node qa/report.mjs && node qa/build-map.mjs && node qa/gallery.mjs
```

Options (environment variables):

- `QA_EMAIL` / `QA_PASSWORD` — sign in as this learner first. The account must be
  confirmed; signup needs an invite code *and* an email confirmation click, so
  the harness does not create accounts.
- `QA_ROUTES=/discover,/review` — restrict the crawl.
- `QA_ALLOW_PAID=1` — let `media.spec.ts` press one TTS control once.
- `--timeout 420000` — `/discover/:videoId` visits three videos and needs more
  than the default 150s per test.

## Regenerating the schema evidence

```sh
# replay every migration on a throwaway Postgres 16 (see contract/build.mjs)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres node contract/build.mjs > qa/output/schema/replay.json
psql $DATABASE_URL -At -F'|' -c "select schemaname||'.'||tablename, policyname, cmd, array_to_string(roles,','), coalesce(qual,''), coalesce(with_check,'') from pg_policies where schemaname in ('public','storage') order by 1,3,2" > qa/output/schema/rls-policies.txt
psql $DATABASE_URL -At -F'|' -c "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m') order by 1" > qa/output/schema/rls-tables.txt
psql $DATABASE_URL -At -F'|' -c "select id, public from storage.buckets order by 1" > qa/output/schema/buckets.txt
```

The anon probe (`anon-table-probe.txt`) is one `GET /rest/v1/<table>?select=*&limit=1`
with `Prefer: count=exact` per table in `types.ts`, using the publishable key;
the preflight (`fn-preflight.txt`) is one `OPTIONS` per function directory.
Both take under a minute with curl.

## Caveats baked into the results

- Migrations that fail to replay (listed in `replay.json`) contribute no
  policies to the dump, so a table can look under-policied here and be fine in
  production. Cross-check with the live probe column before calling it a gap.
- In a sandboxed container, Chromium's own connections to `supabase.co` are
  reset by the egress relay while Node's are not, so `installBackendRelay`
  replays every Supabase request from Node. Status codes and bodies are real;
  websockets (Realtime, live voice) cannot be relayed and third-party hosts
  (YouTube, TikTok, Google Fonts) are blocked there, so player playback needs a
  run from an unrestricted network.
- `ERR_ABORTED` during the interaction phase is usually the harness navigating
  away while a query is in flight, not a bug.
