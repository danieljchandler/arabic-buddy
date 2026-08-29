# Security review — 2026-08-29

Whole-repo audit (edge functions, migrations/RLS, storage policies, client,
dependencies). Findings are ordered by exploitability × blast radius. Every
item names the file and the line so it can be checked rather than taken on
trust.

**Status: every finding below has been fixed in the same branch.** Each entry
keeps the original description — what was wrong and why it mattered — and ends
with a `**Fixed:**` note saying what changed. Line numbers refer to the code as
it was *before* the fix. See "What the fix changed" at the end for the shape of
the whole diff.

One finding turned out to be worse on inspection than the audit first recorded,
and it is marked where it appears (H2).

---

## 0. The premise that makes several of these exploitable

`verify_jwt = true` in `supabase/config.toml` is **not an authorization
control**. Supabase's gateway checks that the bearer token is a JWT signed by
the project — and the publishable/anon key is exactly such a JWT, shipped in
the browser bundle (`vite.config.ts:8`, hard-coded as a build fallback). So
"`verify_jwt = true` and nothing else" means *publicly reachable by anyone who
views source*, and "signed-in user" means *anyone who can complete a free
signup*.

Several functions below are gated by one or the other and treat that as
sufficient. 36 functions are absent from `config.toml` entirely and inherit the
platform default, which is the same weak gate.

---

## High

### H1 — `process-approved-video` accepts the public anon key as authentication, and accepts any string prefixed `sb_publishable_`

`supabase/functions/process-approved-video/index.ts:1526-1541`

```ts
const isAnonKey = token === anonKey;
const isPublishableKey = publishableKey.length > 0 && token === publishableKey;
const looksLikePublishable = token.startsWith("sb_publishable_");
const isPublicKey = isAnonKey || isPublishableKey || looksLikePublishable;
if (!isInternalServiceCall && !isPublicKey) { /* ...only here is a JWT checked... */ }
```

`looksLikePublishable` accepts an arbitrary attacker-chosen string — the prefix
is the whole check. The function then runs the full ingestion pipeline for any
`videoId` in the body under the service role: media download, multiple ASR
providers, several LLM passes, image generation. That is unbounded third-party
spend triggered by an unauthenticated request, plus service-role writes to
`discover_videos`.

The in-code comment ("`verify_jwt = false` already means anyone can hit this
endpoint") contradicts `config.toml`, which sets `verify_jwt = true` for this
function. Whichever is current, the in-function check is a no-op.

**Fix:** drop the public-key branch entirely; require a real user JWT and an
`admin`/`content_reviewer` role, or the service-role key for the internal call.
`reextract-on-screen-text:217-226` already does exactly this and is the model to
copy.

**Fixed:** the whole public-key branch is gone. `process-approved-video` now
calls `requireContentManager(req, corsHeaders)` — a real user JWT plus an
`admin`/`content_reviewer` row read from the database, or the service-role key
for the internal call. The two tests that pinned this as known-broken
(`process_approved_video_test.ts`) now assert the opposite, and a new one
covers the `sb_publishable_` prefix specifically.

### H2 — `analyze-gulf-arabic`: any signed-in user can overwrite any video's learner content

`supabase/functions/analyze-gulf-arabic/index.ts:1685`, writes at `:1842-1855`
and `:2782-2875`

`videoId` is destructured straight from the request body and used as the target
of a **service-role** update:

```ts
const { ..., videoId: pipelineVideoId, ... } = body;
...
await svc.from('discover_videos').update({
  transcript_lines: [], vocabulary: ..., grammar_points: ...,
  cultural_context: ..., transcription_status: 'analysis_complete',
}).eq('id', pipelineVideoId);
```

The only gate is `auth.getUser()` (`:1677`) — no ownership check, no role check.
Any account can blank the transcript of, or plant arbitrary vocabulary and
"cultural context" into, any published video in the Discover feed. Content
learners read, tampered with by anyone who signs up.

**Fix:** require `admin`/`content_reviewer` (or the service-role bearer) before
any `pipelineVideoId` write.

**Worse than first recorded.** The internal-call detection did not just compare
against the service-role key — on a mismatch it base64-decoded the bearer's JWT
payload *without verifying the signature* and accepted
`payload.role === 'service_role' || !payload.sub` as proof of an internal call.
The publishable key has no `sub`, so the key in the browser bundle passed, and
so would any unsigned token an attacker assembled. This was an authentication
bypass, not merely a missing authorization check.

**Fixed:** the claim-sniffing is deleted; internal calls are recognised only by
a constant-time comparison against the service-role key (`isServiceRoleCall`).
Separately, any request carrying a `videoId` — the parameter that drives the
service-role write — now passes `requireContentManager` first.

### H3 — `backfill-literal-translations`: no authentication at all, service role, arbitrary global writes

`supabase/functions/backfill-literal-translations/index.ts:60-129`

No `Authorization` handling anywhere in the file. It creates a service-role
client, selects `discover_videos` (optionally a caller-supplied `videoId`), runs
a Lovable-gateway LLM call per video, and writes `transcript_lines` back. Not
listed in `config.toml`, so its only protection is the platform JWT gate — i.e.
the public anon key (see §0).

**Fix:** admin gate, or delete it if the backfill is done — it is a one-shot
migration tool left mounted as a public endpoint.

**Fixed:** gated with `requireContentManager`. The test that pinned
"runs for an anonymous caller" now asserts 401, with a companion asserting 403
for a signed-in learner.

### H4 — `ai-resegment-transcript`: no authentication, unbounded LLM spend

`supabase/functions/ai-resegment-transcript/index.ts:322` (`Deno.serve`)

The only `Authorization` header in the file is the outbound one to the model
provider (`:196`). `config.toml` sets `verify_jwt = true`, which per §0 the anon
key satisfies. Anyone can post a large segment array and bill an LLM call.

**Fixed:** gated with `requireRole(req, TRANSCRIPT_EDITOR_ROLES, …)` —
`admin`, `content_reviewer` *and* `transcriber`. The wider set is deliberate and
was caught by tracing the callers: `AdminTranscriptEditor` renders for a
transcriber, and re-segmenting is the work that role exists to do, so the
content-manager gate used everywhere else would have taken a tool away from the
people it was built for. Kept in step with `REVIEWER_ROLES` in
`transcript-review`, which is the other half of the same permission.

### H5 — The `authentic_stories` editorial pipeline is gated on "is signed in", nothing more

| function | line | what it does |
|---|---|---|
| `generate-story-video` | `index.ts:152-224` | overwrites `story_video_url`, `video_preview_url`, `line_durations`, `video_status` for any `story_id`; runs paid image-gen + TTS |
| `generate-story-video-full` | `index.ts:285` auth, `:254-266` write | writes `story_video_segments` |
| `generate-story-full-audio` | `index.ts:19-123` | writes `video_status`, uploads audio |
| `generate-story-preview-audio` | `index.ts:41-102` | writes `authentic_story_lines.audio_url` |
| `translate-story-dialect` | `index.ts:19-117` | rewrites story line translations |

Each authenticates the caller and then ignores who they are: `story_id` comes
from the body, the write goes through the service role, and there is no role
check and no `enforceDailyCap`. A single free account can deface every story in
the catalogue and run the paid image/TTS generators in a loop.

`edit-story-scene-image` in the same family *does* check a role — the
inconsistency is the tell.

**Fixed:** all five now call `requireContentManager` before touching
`authentic_stories`. `story_video_full_test.ts` and `story_admin_test.ts` each
carried a test pinning this as known-broken; both now assert the refusal, with
a companion covering the content-manager path.

### H6 — `extract-concepts` writes global curriculum data on a signed-in-only gate

`supabase/functions/extract-concepts/index.ts:106-195`

Authenticates the caller (`:112`), then ignores who they are: it upserts into
`curriculum_concepts` and `content_concept_links` under the service role, with
the content id taken from the body. These tables share a key space with
`grammarTaxonomy.ts` and the mastery ladder, so a poisoned row propagates into
every learner's grammar mastery.

`extract-grammar-points` has the same shape and appends to a global
`discover_videos.grammar_points` — but its docblock (`:1-4`) says signed-in
callers are *intended* to reach it ("signed-in users (target their own level) or
admins (any level)"). Worth re-examining anyway: the write lands on shared
content, not on the caller's own row, so any account can append arbitrary
"grammar points" to any video. If that is the intent, the write should be
scoped or queued for review rather than applied directly.

**Fixed:** `extract-concepts` is gated with `requireContentManager`.
`extract-grammar-points` keeps its learner path — the Discover page depends on
the shared append, so gating it would remove a feature rather than close a hole
— but it was also an uncapped LLM call, which is what made it abusable; it now
runs under `enforceDailyCap(…, 20)`. The shared-append behaviour is left as the
product decision it is, and is now written down as one.

---

## Medium

### M1 — SSRF with response exfiltration in `download-media`

`supabase/functions/download-media/index.ts:968-990` ("Strategy 1")

```ts
const headResp = await fetch(normalizedUrl, { method: 'HEAD', redirect: 'follow', ... });
if (looksLikeMedia(finalUrl, ct)) { const audioData = await downloadAsBase64(finalUrl); ... }
```

Runs **before** any host check. `isSocialMediaUrl` exists (`:21`) but only gates
Strategies 2–3. `looksLikeMedia` treats `application/octet-stream` as media
(`:606`), so any internal or link-local endpoint that returns that content type
has its body handed back to the caller base64-encoded (up to 25 MB), and
redirects are followed. Auth is "any signed-in user"; there is no usage cap.

**Fix:** apply the host allow-list to Strategy 1 too, or drop the generic path.

**Fixed:** new `_shared/safeFetch.ts`. `assertPublicHttpUrl` refuses loopback,
private, link-local (169.254.0.0/16 — cloud metadata), CGNAT, multicast, the
`.local`/`.internal` suffixes and integer-encoded IP spellings; `safeFetch`
follows redirects by hand and re-checks every hop, because a public URL that
302s into link-local defeats a first-hop-only check on its own. Both the
Strategy 1 probe and `downloadAsBase64` (the call that actually returns bytes)
go through it. Covered by `_test/safe_fetch_test.ts`.

Its one honest limit is documented in the module: a hostname that *resolves* to
a private address (DNS rebinding) is not caught, because the edge runtime's
`fetch` gives no way to pin a connection to a pre-resolved address.

### M2 — Unauthenticated open fetch-proxy in `scrape-x-post`

`supabase/functions/scrape-x-post/index.ts:26`, fetch at `:78`

```ts
const isXPost = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
```

The regex is **unanchored**, so `https://attacker.tld/?u=https://x.com/a/status/1`
passes. The URL is then string-concatenated into `https://r.jina.ai/${url}` and
fetched. The function has no authentication and no usage cap, so this is an
unauthenticated proxy that reads arbitrary URLs on `JINA_API_KEY`'s bill.

**Fix:** anchor with `^…$` and validate via `new URL()` + hostname equality (the
pattern `download-media:21` already uses); add `enforceAnonymousDailyCap`.

**Fixed:** the substring test is replaced by `isXPostUrl`, which parses the URL
and compares the host for equality (plus `www.`) against a `/{handle}/status/{id}`
path. The function also now runs under `enforceAnonymousDailyCap(…, 20)`, so
the Jina key is metered whether or not the caller has an account.

### M3 — Role grants are applied before the email is proven

`supabase/migrations/20260824113000_role_email_grants.sql:248-281`

```sql
CREATE OR REPLACE FUNCTION public.apply_pending_role_grants() ... AS $$
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, g.role FROM public.pending_role_grants g
  WHERE lower(g.email) = lower(NEW.email) AND g.claimed_at IS NULL;
```

The trigger is `AFTER INSERT ON auth.users` and checks only that the address
*string* matches. `email_confirmed_at` is never consulted — at INSERT time it is
always null. `admin` is a grantable role (`is_grantable_role`, `:57`). So whoever
learns an invited address can sign up with it and claim the grant, and the
`UPDATE … SET claimed_at` immediately after means the legitimate invitee silently
gets nothing.

Whether this is reachable depends on the project's "Confirm email" auth setting,
which is not in the repo — the guard should not depend on that setting.

**Fix:** move the claim to `AFTER UPDATE ON auth.users` when
`email_confirmed_at` transitions from null, or add
`AND NEW.email_confirmed_at IS NOT NULL`.

**Fixed:** migration `20260829120000_confirm_email_before_role_grant.sql`. The
trigger function returns early unless `email_confirmed_at` is set, and a second
trigger fires on the null → non-null transition of that column, so the claim
happens at confirmation. Accounts that arrive already confirmed (OAuth,
admin-created) still claim on INSERT. Verified against a replayed schema: an
unconfirmed signup on an invited address gets no role and leaves the invitation
unclaimed; confirming the address grants it.

### M4 — The anonymous rate-limit key is attacker-controlled

`supabase/functions/_shared/usageCap.ts:319`

```ts
const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
```

`X-Forwarded-For` is append-only: a proxy adds its observation to the end and
preserves what the client sent, so index `[0]` is the *client's own* header.
Sending `X-Forwarded-For: <random>` on each request yields a fresh bucket every
time. This is the only cost control on the three deliberately signed-out
endpoints — `placement-quiz`, `score-set-phrase-voice`, `score-shadow-attempt` —
which all make paid model/ASR calls. The docblock's honest framing ("an IP bucket
is a backstop, not accounting") holds for NAT and botnets; it does not cover a
one-header bypass.

**Fix:** take the **last** XFF entry, or whatever header the platform sets and
the client cannot forge.

**Fixed:** `clientIpForBucket` takes the *last* `X-Forwarded-For` entry — the
one written by the hop we trust — falling back to `cf-connecting-ip`. It is
still a backstop rather than accounting, which the docblock says; it just no
longer takes one header to leave the bucket.

### M5 — CORS allow-list carries a wildcard over three third-party domains

`supabase/functions/_shared/cors.ts:31`

```ts
const isLovablePreview = /^https:\/\/([a-z0-9-]+\.)*(lovable\.(app|dev)|lovableproject\.com)$/i.test(origin);
```

Every subdomain of `lovable.app`, `lovable.dev` and `lovableproject.com` — a
namespace anyone can get a subdomain in — is a trusted origin for every edge
function, permanently, in production. That is a standing browser-side CSRF
surface against every endpoint whose only gate is the anon key.

**Fix:** pin the specific preview host(s), or make the wildcard conditional on a
non-production `ALLOWED_ORIGINS`.

**Fixed:** the preview wildcard is opt-in. It applies only when
`ALLOW_PREVIEW_ORIGINS=true`, which a preview project sets and production does
not. Tests cover both directions, including that a non-`true` value is off.

### M6 — TOCTOU on the native-feedback credit ledger

`supabase/functions/native-feedback/index.ts:100-122`

Balance is read, the request row is inserted, and only then is the `-1` ledger
entry written. Concurrent submits all observe the same balance, so one credit
buys N pieces of native-speaker feedback — a real cost, since a person does the
work.

**Fix:** spend atomically (a SECURITY DEFINER function doing the conditional
decrement, or a unique constraint / `CHECK` that makes the overdraft fail).

**Fixed:** migration `20260829120100_atomic_native_feedback_spend.sql` adds
`spend_native_feedback_credit(uuid, text)` — a `SECURITY DEFINER` function that
takes a per-user transaction-scoped advisory lock, re-reads the balance, and
either appends the `-1` row or returns NULL. The edge function spends through
it before creating the request, and refunds if the request insert then fails,
which keeps the "never charge for nothing" property the old ordering was
protecting. Verified by racing 8 concurrent spends against a balance of 1:
exactly one succeeded, the balance ended at 0 and never went negative.

---

## Low / hygiene

- **L1 — Dependencies.** `npm audit --omit=dev` reported 24 vulnerabilities in
  the production tree, 12 of them high.
  **Fixed:** `npm audit fix` (lockfile only — no `package.json` change, no major
  bumps) cleared 21 of them. `xlsx` had **no fix on npm** — SheetJS left the
  registry — so it is now installed from the vendor's own CDN
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), which clears the
  prototype-pollution and ReDoS advisories. *This is the one change that alters
  how CI installs: the build now needs to reach `cdn.sheetjs.com`.* If that host
  is not reachable from CI, revert this single dependency and accept the
  advisory — the only parse path is the admin lesson importer
  (`src/lib/parseLessonXlsx.ts:229`), where the file is admin-supplied.
  What is left: `react-router` (moderate, an open-redirect XSS) needs a major
  version bump, which is a breaking change and wants its own PR rather than
  being smuggled into a security fix. Prod tree is now 2 moderate, 0 high.
- **L2 — Non-constant-time secret comparison.**
  **Fixed:** `CLIP_PIPELINE_SECRET` (six functions), `SOCIAL_HARVEST_SECRET`,
  and both service-role bearer comparisons now go through `secretEquals` in
  `_shared/requireRole.ts`, which SHA-256s both sides and compares the digests
  with an accumulating XOR — so neither the value nor its length is timed. A
  remote timing attack on these was never realistic; the fix is free.
- **L3 — Usage counters fail open.** `usageCap.ts:262` and `:336` return
  `limited: false` when `increment_usage_counter` errors.
  **Left as is, deliberately.** It is a considered availability trade-off, and
  changing it would newly break paying users during a database hiccup. Recorded
  here so the trade is visible: a counter outage removes every spend ceiling at
  once.
- **L4 — Telemetry sinks swallow their own errors** (`llmUsageLogger`,
  `msaViolationLogger`, `trainingExampleLogger`, `featureMetrics`).
  **Left as is** — correct for request safety, already documented in
  `CLAUDE.md`. Noted only because it means the abuse-detection trail can stop
  existing without anyone noticing.

## What is already right

Worth recording, because it is the standard the findings above fall short of:

- **RLS is on for every table** in `supabase/migrations/` — no exceptions found.
- **`user_roles` and `subscribers` are correctly asymmetric**: read-your-own-row
  for clients, writes through `is_admin()` policies or the service role. Nobody
  can grant themselves a role or a subscription from the browser.
- **Every `SECURITY DEFINER` function pins `search_path`** — all 60+ of them.
  That is the single most commonly missed Postgres hardening step.
- **`increment_usage_counter` is revoked from `anon` and `authenticated`** and
  granted only to `service_role` (`20260529094207…sql:51-52`).
- **The admin-role guard trigger** (`guard_admin_role_removal`) blocks self-revoke
  and last-admin-revoke *in the database*, not in the page.
- **Storage policies were tightened**: the original `tutor-audio-clips` DELETE
  policy let any authenticated user delete any object; migrations
  `20260529144915` and `20260529155315` replaced it with `auth.uid() = owner`.
  Every user-scoped bucket is now owner- or folder-scoped.
- **`create-checkout` price IDs are server-side constants** — no price, amount or
  coupon is accepted from the client. `native-feedback confirm` verifies
  `payment_status` and `metadata.user_id` against the retrieved Stripe session
  and makes the grant exactly-once via a unique `stripe_session_id`.
- **`referral` blocks self-referral and old-account farming** server-side.
- **Assistant tools are read-only** and every one is scoped to `ctx.userId`
  derived from the JWT — no function anywhere takes a user id from the request
  body.
- **`transcript-review` reads the reviewer's role from the database** and stamps
  `changed_by` / `reviewed_by` from the JWT, never the body — the audit trail
  cannot be authored by its own subject.
- **No XSS sinks**: one `dangerouslySetInnerHTML` (`components/ui/chart.tsx:70`,
  generated CSS from a static config) and one bootstrap `innerHTML`
  (`main.tsx:23`). No `eval` / `new Function` in app or function code.
- **No secrets committed**; `.env` is gitignored and only `.env.example` is
  tracked.

---

## What the fix changed

Two new shared modules carry almost all of it:

- **`supabase/functions/_shared/requireRole.ts`** — `requireContentManager` /
  `requireAdmin` / `requireRole`, plus `isServiceRoleCall`, `hasSharedSecret`
  and `secretEquals`. One place decides who may write content nobody owns:
  a staff row read from `user_roles` server-side, the service-role key, or a
  configured shared secret. Result shape matches `usageCap`'s `CapResult` so
  call sites branch identically. Modelled on `reextract-on-screen-text`, which
  had this right before the rest of the pipeline did.
- **`supabase/functions/_shared/safeFetch.ts`** — the SSRF guard described in
  M1, with its DNS-rebinding limit written down rather than left to be
  rediscovered.

Two migrations: `20260829120000` (confirm email before granting a role) and
`20260829120100` (atomic credit spend).

Eleven edge functions gained a gate; seven had a secret comparison replaced;
`cors.ts` and `usageCap.ts` each changed one decision.

### Verification

- `deno check` over every function and shared module: clean.
- Edge suite: **1746 passed, 0 failed**. Four tests that *pinned these
  vulnerabilities as known-broken* now assert the fixed behaviour, and new
  tests cover the gate, the SSRF guard and the CORS default.
- Vitest: **5806 passed**, including every drift guard.
- `lint:ratchet`: no new errors. `tsc`: clean. Production build: clean.
- Migration replay: both new migrations apply from scratch, and both fixes were
  exercised against the replayed schema (see M3 and M6).

### Known-failing, and not from this work

`supabase/migrations/20260828192151_…sql` fails to replay from scratch —
`policy "social_posts_manage" for table "social_posts" already exists`. It
arrived with the previous commit on this branch and fails identically with this
diff stashed. It needs a `DROP POLICY IF EXISTS` and is left alone here so that
a security change stays a security change.

### Still worth doing

- A drift guard in `src/test/`: every function directory that mentions
  `SUPABASE_SERVICE_ROLE_KEY` must also name an authorization helper, with a
  written exemption list. That is what would keep this class of gap from coming
  back, the way the existing coverage guards do.
- `react-router` major bump (L1).
- Decide whether `extract-grammar-points` should really let any learner append
  to shared video content, or whether those notes belong in a review queue (H6).
