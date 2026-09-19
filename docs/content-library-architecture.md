# The content library — architecture for a third app

**Status:** design, not built. Written 2026-09-19 against Hikaya @ `main` and
Ingleezy @ `main`.

A separate repo and a separate app that holds **everything researched or sent
in** — TikToks, YouTube links, X posts, screenshots, voice notes, articles —
categorised, attributed to creators, searchable, and dispatchable to Hikaya
(Arabic) or Ingleezy (English) for transcription and translation with one
button.

Working name in this document: **Maktaba** (مكتبة, "the library"). It sits
beside Hikaya (حكاية, "story") and Ingleezy (إنجليزي) rather than inside
either.

---

## 1. Why a third app is the right call

The instinct to keep it separate is correct, and the codebase already shows
why. The two learning apps are **learner-facing products** — RLS scoped to a
learner's own rows, subscription tiers, usage caps, voice budgets, a
publishable key in every browser bundle. The library is the opposite shape:
**one operator, no learners, mostly unpublished material, and a lot of
half-finished notes.**

Three concrete arguments:

- **`discover_videos` is a publishing table, not a research table.** In both
  apps it is the row a learner eventually watches: it carries
  `transcription_status`, `published`, `transcript_lines`, `cefr_level`. There
  is no honest place in it for "Ahmed sent me this on WhatsApp, might be good
  for the Sanaani column, haven't watched it yet". Today that state lives in
  `trending_video_candidates` (Hikaya only, and only for the trending
  harvester) or in nothing at all.
- **Creators are not modelled anywhere.** `creator_name` / `creator_handle`
  exist on `trending_video_candidates` and are **dropped on the floor** when a
  candidate becomes a `discover_videos` row. `content_channels` and
  `social_content_sources` model *feeds* to harvest from, not *people* whose
  work you are collecting. The request "store creator names" has no home in
  either app today. This is the single biggest schema gap the library fills.
- **The two apps must stay independently deployable.** That is already the
  stated reason `sync-hakiya-videos` snapshots rather than queries live
  (`supabase/functions/sync-hakiya-videos/index.ts`). A shared library that
  both apps *depend on at runtime* would undo that. The library must be a
  **source that pushes**, never a service either app reads to render a page.

### The overlap the user asked for, modelled honestly

"English module and Arabic module … but they can have some overlap as well."

Do **not** model this as two tables, or a hard `is_arabic` switch. Model it as:

- `items.language` — a fact about the content (`ar`, `en`, `mixed`).
- `dispatches` — a list of *destinations*, many per item.

An Arabic clip goes to Hikaya. An English clip goes to Ingleezy. A
code-switched Gulf/English clip goes to **both**, and each app transcribes it
in its own direction. A Khaleeji creator's English-language interview is
Ingleezy content by an Arabic-column creator — the creator record is shared,
the dispatch is not. Nothing in the schema forces a choice, which is exactly
the overlap asked for.

---

## 2. What already exists that this must not duplicate

Read these before building anything; four of the five pieces already work.

| Piece | Where | What it already does |
| --- | --- | --- |
| URL → platform/id/embed | `src/lib/videoEmbed.ts` + server twin in `ingest-shared-video` | TikTok (incl. `vt.`/`vm.` short links), YouTube (watch/shorts/embed/live/youtu.be), Instagram reels. **Pure string work, never fails, needs no network.** |
| Media acquisition | `supabase/functions/download-media` | Cobalt + `youtubeHLS` for YouTube audio, TikTok/IG/X/SoundCloud domain allow-list, 25 MB cap, SSRF-guarded via `_shared/safeFetch.ts` |
| Free X access | `supabase/functions/_shared/xSyndication.ts` | `syndication.twitter.com` timelines + `cdn.syndication.twimg.com` single tweets — **free, no key, no login**. Rate-limits at ~40 fetches/IP/few-minutes. |
| Agent-proposes / human-publishes | `docs/x-content-pipeline.md`, `import-x-bundle`, `scripts/discover-x-sources.ts` | The exact research loop asked for, already proven once: Claude researches → bundle JSON → probe script → import as `candidate` → human approves in `/admin/social-trends`. |
| Service-to-service auth | `_shared/requireRole.ts` → `hasSharedSecret()` + `secretEquals()` | Constant-time shared-secret header check. `import-x-bundle` already uses it (`x-harvest-secret` / `SOCIAL_HARVEST_SECRET`). **This is the bridge's auth, already written.** |
| Cross-app content bridge | `ingleezy/supabase/functions/sync-hakiya-videos` | Pull direction only: Hikaya's *published* rows → Ingleezy, via Hikaya's anon key and the `published = true` RLS policy, upserting on Hikaya's UUID so re-syncs are idempotent. |
| Semantic search | `content_embeddings`, `match_content` RPC, `embed-content`, `_shared/embeddings.ts` | pgvector index over transcript lines / vocabulary / corpus sentences. Degrades cleanly where pgvector is absent. Lift wholesale. |

**Ingleezy is the older fork** and lacks `_shared/requireRole.ts` entirely —
its functions do inline `user_roles` checks (see `sync-hakiya-videos`). Its
`discover_videos` also lacks `dialect_features`, `dialect_subvariety`,
`visual_timeline` and — despite `sync-hakiya-videos` writing it — `source`,
because `20260813160000_hakiya_bridge_source.sql` has not been applied to the
live project. That is the Lovable hazard in §7, live and already biting.

---

## 3. Data model

Postgres. The shape is **items + creators + facets + an outbox**, not
"videos".

### 3.1 `items` — one row per thing you saved

```sql
create table public.items (
  id              uuid primary key default gen_random_uuid(),

  -- identity: what it is and where it lives
  kind            text not null,          -- video | post | article | audio | image | note
  platform        text,                   -- tiktok | youtube | instagram | x | telegram | web | upload
  source_url      text,                   -- canonical, as parsed (never the share-sheet URL)
  platform_id     text,                   -- the id inside that URL
  embed_url       text,
  url_hash        text generated always as (md5(coalesce(source_url,''))) stored,

  -- what it says
  title           text,
  title_native    text,                   -- title in the content's own script
  description     text,
  language        text not null default 'ar',   -- ar | en | mixed
  dialect         text,                   -- gulf | egyptian | yemeni | levantine | ... | null
  subvariety      text,                   -- mirrors _shared/dialectSubvarieties.ts
  register        text,                   -- spoken | msa | mixed | devotional | news | sung
  cefr_estimate   text,
  duration_seconds int,

  -- why you kept it
  note            text,                   -- your own words. The most valuable column here.
  rating          smallint,               -- 1-5, your gut call
  status          text not null default 'inbox',
                  -- inbox | triaged | ready | dispatched | archived | rejected
  reject_reason   text,

  -- provenance
  received_from   text,                   -- 'Ahmed (WhatsApp)', 'mention-mining', 'claude:research-2026-09'
  received_at     timestamptz,
  added_by        uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index items_url_unique
  on public.items (platform, platform_id)
  where platform_id is not null;
create index items_status_idx   on public.items (status);
create index items_language_idx on public.items (language, dialect);
create index items_fts_idx on public.items
  using gin (to_tsvector('simple',
    coalesce(title,'') || ' ' || coalesce(title_native,'') || ' ' ||
    coalesce(note,'')  || ' ' || coalesce(description,'')));
```

Three deliberate choices:

- **`note` is a first-class column, not a tag.** Your reason for saving
  something is the thing you will search on in six months, and it is the one
  field no API and no model can reconstruct. `docs/x-content-pipeline.md`
  already found this: the bundle format carries a `notes` field with "what it
  posts, and the evidence" precisely because the evidence is the value.
- **`status` is a queue, not a boolean.** `inbox → triaged → ready →
  dispatched` is the workflow; `rejected` with a reason is a *memory* so the
  same link sent twice doesn't get re-evaluated from scratch.
- **Unique on `(platform, platform_id)`, not on URL.** The same TikTok arrives
  as `vt.tiktok.com/XYZ`, `tiktok.com/@h/video/123` and
  `tiktok.com/@h/video/123?is_from_webapp=1`. Parse first, then dedupe. Hikaya
  already learned this — `ingest-shared-video` resolves short links before
  its `ilike` dedupe check.

### 3.2 `creators` — the gap neither app fills

```sql
create table public.creators (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  native_name   text,
  country       text,
  dialect       text,
  subvariety    text,
  genre         text,          -- comedy | food | football | poetry | vlog | news | religious
  register_note text,          -- 'writes the way he speaks'; 'MSA supplication, do not use'
  notes         text,
  status        text not null default 'candidate',  -- candidate | approved | rejected
  created_at    timestamptz not null default now()
);

create table public.creator_handles (
  creator_id  uuid not null references public.creators(id) on delete cascade,
  platform    text not null,
  handle      text not null,
  url         text,
  verified_at timestamptz,
  primary key (platform, handle)
);

create table public.item_creators (
  item_id    uuid not null references public.items(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  role       text not null default 'speaker',   -- speaker | uploader | author | subject
  primary key (item_id, creator_id, role)
);
```

`creator_handles` is separate because **one person is several handles** — a
comedian with TikTok *and* X *and* YouTube is one creator whose dialect,
country and register you assess once. `social_content_sources` and
`content_channels` in Hikaya both conflate person-with-feed, which is why
neither could answer "what else do I have by this guy".

`register_note` earns its place from a real finding: `MustafaHosny` scores 78%
on Hikaya's dialect prefilter and is almost entirely MSA supplication
(`docs/x-content-pipeline.md`). That judgement is expensive to make and must
be recorded once against the person, not rediscovered per clip.

### 3.3 Facets — categorisation that survives contact with reality

```sql
create table public.tags (
  id     uuid primary key default gen_random_uuid(),
  facet  text not null,   -- topic | setting | function | grammar | vibe | project
  slug   text not null,
  label  text not null,
  label_ar text,
  unique (facet, slug)
);

create table public.item_tags (
  item_id uuid not null references public.items(id) on delete cascade,
  tag_id  uuid not null references public.tags(id)  on delete cascade,
  source  text not null default 'human',   -- human | claude | imported
  primary key (item_id, tag_id)
);
```

**Faceted, not a flat tag cloud.** A flat cloud turns into 400 tags and
becomes unsearchable; the facet is what makes `setting:majlis` and
`topic:football` compose. Five facets cover what you actually filter on:

| Facet | Examples | Why |
| --- | --- | --- |
| `topic` | football, food, politics, relationships | what it's *about* |
| `setting` | majlis, street, kitchen, classroom, phone-call | what it *teaches* — situational language is the app's unit |
| `function` | complaining, bargaining, apologising, storytelling | speech acts; maps to `set_phrase_occasions` |
| `grammar` | keyed to `_shared/grammarTaxonomy.ts` | so a dispatched clip can seed a lesson concept |
| `vibe` | funny, slow-speech, fast, shouty, clean-audio | practical selection criteria you'll use constantly |

`source = 'claude'` on the join row is load-bearing: it lets Claude propose
tags freely while keeping "what a human actually confirmed" recoverable. Same
principle as the `dialect_native_reviews` / `transcript_line_reviews` split in
Hikaya — **an audit trail its own subject can author is worth nothing.**

`grammar` tags must use `_shared/grammarTaxonomy.ts` keys verbatim. That
module exists so free-text model output and the mastery ladder agree on one
key space; a library that invents its own grammar vocabulary breaks the one
thing dispatch could usefully carry.

### 3.4 `item_files` — mirror it or lose it

```sql
create table public.item_files (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  role        text not null,   -- thumbnail | audio | video | screenshot | attachment | transcript
  storage_path text not null,
  mime_type   text,
  bytes       bigint,
  created_at  timestamptz not null default now()
);
```

**Mirror the thumbnail and the audio at capture time, not at dispatch time.**
TikToks get deleted, accounts go private, YouTube videos get region-locked.
Hikaya already has `persist-video-thumbnail` and `_shared/thumbnailMirror.ts`
for exactly this reason on the publishing side; the library needs it further
upstream, because the gap between "saved it" and "got round to processing it"
is months, not minutes. An item whose audio is mirrored is still dispatchable
after the source 404s.

### 3.5 `dispatches` — the outbox, and the reason the button is trustworthy

```sql
create table public.dispatches (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items(id) on delete cascade,
  target        text not null,          -- hikaya | ingleezy
  remote_id     uuid,                   -- the target's discover_videos.id
  remote_url    text,                   -- deep link to the target's edit page
  status        text not null default 'queued',
                -- queued | sent | processing | completed | failed | rejected
  error         text,
  requested_by  uuid not null,
  sent_at       timestamptz,
  completed_at  timestamptz,
  payload       jsonb not null default '{}',   -- exactly what was sent
  result        jsonb not null default '{}',   -- what came back
  created_at    timestamptz not null default now(),
  unique (item_id, target)
);
```

This one table is what turns "push a button" from a fire-and-forget hope into
something you can operate:

- **Idempotent.** `unique (item_id, target)` means the button is safe to press
  twice. Re-pressing updates the existing dispatch rather than creating a
  second `discover_videos` row.
- **Auditable.** `payload` records what was actually sent, so when the target
  produces something odd you can tell whether it was sent bad input.
- **Recoverable.** A failed dispatch is a row you can retry, not a lost
  toast notification.
- **Two-way.** `status` advances from the target's callback, so the library
  knows `completed` without polling.

---

## 4. The bridge

Three edges. The existing `sync-hakiya-videos` pull stays exactly as it is —
it serves a different purpose (published Hikaya content as *learner* content
in Ingleezy) and conflating the two would break both.

```
   ┌──────────────────────────── Maktaba ────────────────────────────┐
   │  items · creators · tags · item_files · dispatches              │
   └───┬──────────────────────────────────────────────────▲─────────┘
       │ (1) dispatch-item                                │ (2) dispatch-callback
       │     POST  x-library-secret                       │     POST  x-library-secret
       ▼                                                  │
   ┌───────────────────────┐                  ┌───────────────────────┐
   │ Hikaya                │                  │ Ingleezy              │
   │  ingest-from-library  │                  │  ingest-from-library  │
   │        ↓              │                  │        ↓              │
   │  discover_videos row  │                  │  discover_videos row  │
   │        ↓              │                  │        ↓              │
   │ process-approved-video│                  │ process-english-video │
   │  (6-engine ASR ladder)│                  │  (Deepgram nova-3)    │
   └───────────────────────┘                  └───────────────────────┘
                         (3) existing sync-hakiya-videos
                         Hikaya published ──▶ Ingleezy  (unchanged)
```

### 4.1 Push — `ingest-from-library` (new, one per target app)

A single new edge function in each app. Roughly 120 lines, and most of it
already exists as `ingest-shared-video`.

```ts
// POST /functions/v1/ingest-from-library
// Header: x-library-secret: <LIBRARY_BRIDGE_SECRET>
{
  library_item_id: "uuid",
  source_url:      "https://www.tiktok.com/@handle/video/123",
  platform:        "tiktok",
  title:           "...",
  language:        "ar",
  dialect:         "yemeni",
  subvariety:      "sanaani",
  creator_name:    "...",
  creator_handle:  "@...",
  note:            "...",
  tags:            ["setting:majlis", "topic:food"],
  thumbnail_url:   "https://<maktaba>/storage/.../thumb.jpg",  // already mirrored
  audio_url:       "https://<maktaba>/storage/.../audio.m4a",  // optional, signed, short-lived
  callback_url:    "https://<maktaba>/functions/v1/dispatch-callback",
  autostart:       true
}
→ 200 { remote_id, remote_url, status: "processing" }
→ 200 { remote_id, remote_url, status: "exists" }   // already ingested, idempotent
```

Auth is `hasSharedSecret(req, "x-library-secret", "LIBRARY_BRIDGE_SECRET")` —
the helper is already written in Hikaya's `_shared/requireRole.ts` and used by
`import-x-bundle`. **Ingleezy needs `requireRole.ts` ported first**; it has no
equivalent.

Why a shared secret and not a user JWT: the library is a separate origin with
its own auth. Making it mint Hikaya JWTs means the two apps' identity systems
become coupled, which is exactly what was avoided when Ingleezy forked its own
Supabase project. A secret in an edge-function environment variable, compared
in constant time, with one function as the whole attack surface, is the
smaller thing. `config.toml` must set `verify_jwt = false` for this function,
because the check is the secret, not the gateway.

**`audio_url` is the quiet win.** If the library already mirrored the audio,
the target skips `download-media`/Cobalt entirely — which is the single
flakiest step in both pipelines (YouTube PO tokens, TikTok rate limits). The
target's acquisition ladder already reads *staged storage first*
(`process-approved-video` stage 1 checks `video-audio` storage before calling
`download-media`), so this drops in with no pipeline change: the library
uploads to the target's `video-audio` bucket as `<remote_id>.m4a` and the
existing ladder finds it.

### 4.2 Callback — `dispatch-callback` (new, in the library)

```ts
// POST /functions/v1/dispatch-callback
// Header: x-library-secret
{ library_item_id, target, remote_id, status, transcript_preview?, error? }
```

Called by each app when `transcription_status` settles. Updates the dispatch,
flips `items.status` to `dispatched`, and stores enough transcript text to
make the item searchable by **what was said in it**, which is the search you
will actually want.

Cheapest implementation in each app: a Postgres trigger on
`discover_videos.transcription_status` that calls `pg_net` to the callback
URL when a row carries a `library_item_id`. No pipeline code changes.

### 4.3 Small migration needed in both apps

```sql
alter table public.discover_videos
  add column if not exists library_item_id uuid,
  add column if not exists creator_name    text,
  add column if not exists creator_handle  text;

create index if not exists discover_videos_library_item_idx
  on public.discover_videos (library_item_id);
```

`creator_name`/`creator_handle` are not decoration. Today
`trending_video_candidates` collects them and the promotion to
`discover_videos` drops them, so **no published video in either app knows who
made it** — no attribution on the learner surface, no "more from this
creator", no way to pull a creator's work if they ask you to.

> ⚠️ **Do not merge that migration and assume it landed.** Both apps run on
> Lovable Cloud, which regenerates `types.ts` from the *live* schema and only
> applies SQL it ran itself. A migration merged through GitHub creates columns
> in CI's replay and in nobody's database, and the next Lovable session deletes
> them from `types.ts`. This removed the curriculum-track columns four times,
> and it is why Ingleezy's `discover_videos.source` is missing from `types.ts`
> today while `sync-hakiya-videos` writes to it. Apply it to each project
> (ask Lovable to run it, or `supabase db push` with a token) and let the
> regeneration carry the columns. See `CLAUDE.md`, "A migration merged through
> GitHub is not applied to the database".

---

## 5. "Relying on APIs doesn't always work"

This is the correct read, and it should shape the app rather than be worked
around. The library's rule: **nothing about saving an item may depend on a
network call succeeding.**

Three layers, in strict order:

**Layer 1 — pure URL parsing. Never fails, no network.**
`parseVideoUrl` gives platform, id, canonical URL and embed URL from the string
alone. That is enough to create the row, dedupe it, and render a player. Lift
`src/lib/videoEmbed.ts` verbatim; it is pure and unit-tested.

**Layer 2 — best-effort enrichment, every source optional.**

| Source | Gives | Reliability |
| --- | --- | --- |
| TikTok oEmbed | title, author name+handle, thumbnail | good; no key; occasionally 403s on region-locked |
| YouTube oEmbed | title, channel, thumbnail | good; no key |
| `cdn.syndication.twimg.com` | full tweet JSON | good; **free, no key** (`_shared/xSyndication.ts`) |
| `syndication.twitter.com` timeline | 20–100 posts per account | good but rate-limits at ~40 fetches/IP/few min |
| Cobalt (`download-media`) | audio for mirroring + duration | variable; YouTube PO-token churn |
| Instagram | almost nothing without login | assume it fails |

Each runs in a `Promise.allSettled`, writes the fields it got, and records
nothing on failure. **No enrichment failure may block the save or surface as
an error** — it surfaces as a blank field with a "enrich" button next to it.

**Layer 3 — the human and the agent fill the rest.** This is the layer the
other two exist to protect, and `docs/x-content-pipeline.md` already proved
it out: *"X content is reachable per account, so the scarce resource is knowing
which accounts to read — a research problem, not an API problem."* Web search
for "Yemeni comedians on X" returned listicles with no handles; **mention
mining from a seed account** returned nine reachable accounts at 52–88%
prefilter pass. No API would have found those.

So the library's answer to flaky APIs is not better APIs. It is: **a row is
valid with nothing but a URL**, and everything else arrives later from you or
from Claude.

---

## 6. The Claude skills

This is the part that makes the library better than a spreadsheet. Ship
`.claude/skills/` in the Maktaba repo so any Claude Code session opened on it
gets them. Each skill is a thin wrapper over the library's REST surface (the
Supabase PostgREST API plus the two edge functions), authenticated with a
personal token — **not** a re-implementation of anything.

The established precedent to copy is `scripts/discover-x-sources.ts` +
`import-x-bundle`: **an agent proposes, a human publishes.** Preserve all four
of its properties.

| Skill | What it does | Guard rail |
| --- | --- | --- |
| `maktaba-add` | Paste one link, twenty links, a screenshot of a chat, or a WhatsApp export. Parses, dedupes against the library, enriches best-effort, creates `status='inbox'` rows with `received_from` set. | Never sets `ready`. Never dispatches. Reports dupes rather than silently skipping. |
| `maktaba-research` | The generalised X loop, across platforms: *"find TikTok creators posting in spoken Sanaani"*. Produces a bundle, probes every handle live, imports creators as `status='candidate'` and items as `inbox`. | Cannot approve a creator. Re-import never changes a status a human set. Handles verified by fetch, never by guess. |
| `maktaba-triage` | Walk the inbox: watch/read, propose `dialect`, `subvariety`, `register`, tags, creator link, and a one-line `note`. | Writes tags with `source='claude'`. Sets `triaged`, never `ready`. |
| `maktaba-search` | Natural-language search across full-text + pgvector + facets: *"slow, clean-audio Gulf clips about food that I haven't sent anywhere yet"*. | Read-only. |
| `maktaba-dispatch` | *"Send everything tagged `setting:majlis` and marked ready to Hikaya."* Batches, reports what was queued, watches the callbacks. | Only items with `status='ready'`. Refuses items with no mirrored thumbnail. Prints the list and asks before sending. |

Two implementation notes that matter:

- **Prefer a typed CLI in `scripts/` over hand-written HTTP calls.** The
  existing `scripts/discover-x-sources.ts` is the model: a Deno script the
  skill shells out to, with the auth and the payload shape compiled and
  tested. A skill that tells Claude to construct `curl` calls against
  PostgREST will drift the moment a column is added; a skill that runs
  `deno run scripts/maktaba.ts add <url>` will not.
- **An MCP server is the alternative, and worth it only if you want the
  library reachable from sessions that aren't opened on this repo** — e.g.
  triaging from a Hikaya session. It is strictly more work than the CLI; start
  with the CLI, and promote it to MCP if the cross-repo case turns up.

---

## 7. Hosting: do *not* put this one on Lovable

Both existing apps run on Lovable Cloud, and `CLAUDE.md`'s longest warning is
about the consequence: Lovable regenerates `types.ts` from the live schema and
only applies SQL it ran itself, so migrations that land from a branch exist in
CI and nowhere else. That has cost the curriculum-track columns four times and
is currently costing Ingleezy its `discover_videos.source` column.

The library has no reason to inherit that. It is an operator tool with no
learner-facing design work, so the thing Lovable is good at buys nothing here.

Recommended:

- **A plain Supabase project** (own project, own keys), migrations applied by
  `supabase db push` from CI on merge. Then a migration merged through GitHub
  *is* applied, `types.ts` is generated by `supabase gen types` in the same
  job, and the drift class disappears entirely.
- **Vite + React + shadcn + Tailwind** — same stack, so components,
  `videoEmbed.ts`, the transcript viewer and the admin table patterns port
  directly.
- **Static host** (Vercel/Netlify/Cloudflare Pages). `docs/deployment.md` in
  this repo already documents all three, including the SPA-fallback configs.
- **Auth: you, and anyone you trust.** Supabase Auth with a single
  `admin`/`contributor` role split, RLS denying anon everything. No
  subscription machinery, no usage caps, no voice budget — none of that
  cross-cutting apparatus applies.

---

## 8. Build order

Each phase is independently useful; stop after any of them and you still have
something better than now.

**Phase 1 — the library stands alone.** Repo, Supabase project, `items` +
`creators` + `creator_handles` + `item_creators` + `tags` + `item_tags`.
Paste-a-link intake with layer-1 parsing only. A table view with facet
filters. *Outcome: everything currently scattered across chats and bookmarks
is in one searchable place.*

**Phase 2 — it stops rotting.** `item_files`, thumbnail mirroring on save,
best-effort layer-2 enrichment, audio mirroring for anything marked `ready`.
*Outcome: a deleted TikTok is still usable.*

**Phase 3 — the button.** `dispatches` table, `dispatch-item` in the library,
`ingest-from-library` in Hikaya, the `library_item_id` / `creator_*` migration
in both apps (applied to the live projects, per §4.3), `dispatch-callback` and
the `pg_net` trigger. *Outcome: one button, auditable, idempotent.*

**Phase 4 — Ingleezy joins.** Port `_shared/requireRole.ts` into Ingleezy,
add its `ingest-from-library`, wire `process-english-video`. *Outcome: both
directions, and code-switched items dispatchable to both.*

**Phase 5 — the agent.** `scripts/maktaba.ts` CLI, then the five skills.
*Outcome: "find me Sanaani food TikToks and put them in the inbox" works.*

**Phase 6 — search that understands.** pgvector over `title + note +
returned transcript`, lifting `_shared/embeddings.ts` and the `match_content`
RPC. *Outcome: "the clip where the guy complains about the AC" finds it.*

---

## 9. Open decisions

1. **Name.** Maktaba (مكتبة, library) is the placeholder and fits the Hikaya /
   Ingleezy family. `danieljchandler/maktaba` is free.
2. **Do the two apps' trending harvesters keep writing to their own candidate
   tables, or does everything route through the library?** Recommendation:
   leave `trending_video_candidates`, `content_channels` and
   `social_content_sources` where they are for now — they feed *automated*
   harvesting that already works — and have the library be the home for
   *curated* content. Revisit once the library has real volume; merging them
   later is a data migration, merging them now is a rewrite of three working
   pipelines.
3. **Should the library hold the returned transcript, or link to it?**
   Recommendation: hold a **copy** for search, treat the app's as canonical.
   Same argument as `sync-hakiya-videos`' snapshot: schema drift degrades to
   stale text instead of a runtime error.
4. **Mobile intake.** Most of "people have sent me this" arrives on a phone.
   Hikaya's `share_target` PWA plumbing (`docs/sharing.md`, `public/sw.js`,
   `src/lib/shareInbox.ts`) ports almost unchanged and is the difference
   between a library you feed and one you mean to feed.
