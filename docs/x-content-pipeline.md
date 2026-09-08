# The X (Twitter) content pipeline

How Yemeni and Egyptian text from X gets into Hikaya, why it is shaped this
way, and how to run the research loop that feeds it.

## The problem this replaces

The first social harvester treated X as a source of **trending topics only** —
a chip on a page that links out to X search. Its reasoning was sound as far as
it went: X search needs a login, and X moved to pay-per-use with no free tier
in February 2026 (third-party resellers run $0.02–$0.20 per 1,000 tweets). So
every word of actual Arabic in the pipeline came from Telegram channels, and
the channels that reliably enable public previews are **news** channels.

That is the whole complaint. News is written in MSA — the one register this app
promises never to teach — so the screen rejected most of what was harvested,
and the reviewer's queue filled with wire copy. The feed was Telegram, and
Telegram was a newsroom.

## What changed

X's own embed backend is public and unauthenticated, because embedded tweets
have to render for logged-out readers:

| Endpoint | Gives | Cost |
| --- | --- | --- |
| `syndication.twitter.com/srv/timeline-profile/screen-name/<handle>` | 20–100 tweets from one account: full text, engagement, language tag | free, no key |
| `cdn.syndication.twimg.com/tweet-result?id=<id>&token=<derived>` | one tweet by id, as JSON | free, no key |

Both are implemented in `supabase/functions/_shared/xSyndication.ts`. The
`token` is a pure function of the id that X's own embed script computes
client-side; it is not a credential.

**There is still no free search.** `timeline-search`, `timeline-hashtag` and
`timeline-conversation` all 404. That single fact shapes everything below: X
content is reachable *per account*, so the scarce resource is knowing which
accounts to read — a research problem, not an API problem.

Two measured behaviours to design around:

- **Freshness varies per account.** Widely-embedded accounts return a live
  timeline (hours old); others return an engagement-ranked cached set that can
  be months or years stale. Nothing in the pipeline filters on recency, and
  that is deliberate: for a dialect corpus the cached set is often the *better*
  half, because high-engagement Arabic is more idiomatic than the routine
  posting around it. "What is trending right now" was the framing that forced
  news sources in the first place.
- **It rate-limits.** Roughly 40 timeline fetches from one IP inside a few
  minutes starts returning 429, and the throttle lasts minutes. Every caller
  paces at `SYNDICATION_PACING_MS` and gives up the platform on the first 429
  rather than burning a run's time budget against a wall.

## The pipeline

```
  research (you + Claude Code)         bundle.json
            │                               │
            ▼                               ▼
  scripts/discover-x-sources.ts  ──▶  import-x-bundle          social_content_sources
     probes every handle live          (candidate, never approved)   status='candidate'
            │                               │                            │
            │                               ▼                            │ a human approves
            │                        social_posts (pending)              ▼
            │                               │                     status='approved'
            │                               │                            │
            ▼                               ▼                            ▼
                          harvest-social-trends ◀───────────── approved X accounts
                                    │
                    socialPrescreen.prescreen  (free)
                        ├── no_arabic / too_short / news_register / headline → rejected
                        └── ok → askBrain screen (costs tokens)
                                    │
                              status='screened'
                                    │
                        /admin/social-trends — a human decides
                                    │
                              status='approved'
```

Four properties hold all the way down:

1. **An agent proposes; it never publishes.** A bundle can only create
   `candidate` sources and `pending` posts. It cannot approve anything, and a
   re-import never changes the status of a source a human already judged — an
   approved source stays approved, a rejected one stays rejected.
2. **A post's text is re-fetched, never believed.** `import-x-bundle` takes
   only the tweet *id* from a bundle and pulls the body from X itself, so a
   bundle cannot plant words nobody tweeted.
3. **The free filter runs before the paid one.**
   `_shared/socialPrescreen.ts` bins text with no Arabic, text too short to
   teach anything, and text in which nobody is speaking, before any of it costs
   a model call.
4. **A human is still the publisher.** Unchanged from the existing design.

## Stage 1: research

This is the part no API does, and the part an agent with web search does well.
Run it in Claude Code (or any agent that can search), and give it something
close to this:

> Find X/Twitter accounts that post regularly in **spoken Yemeni Arabic**
> (Sanaani, Adeni, Taizzi — not MSA). I want accounts where a person is
> writing the way they speak: comedians, poets, football fan accounts, food and
> daily-life accounts, ordinary people with a following. **Not** newspapers,
> news agencies, or government accounts — those write فصحى and I already have
> too much of it.
>
> For each account give me: the handle, a display name, the country, and one
> or two sentences on what it actually posts and why you think it is dialectal
> — quote a line if you can find one.
>
> Return it as JSON in this shape, 20–30 accounts:
>
> ```json
> { "sources": [
>     { "handle": "...", "displayName": "...", "dialect": "Yemeni",
>       "country": "Yemen", "notes": "what it posts, and the evidence" }
> ] }
> ```
>
> Handles must be exact — 1–15 characters of `[A-Za-z0-9_]`. If you are not
> sure a handle is right, say so in the notes rather than guessing silently.

Swap `Yemeni`/`Yemen` for `Egyptian`/`Egypt` for the other column. The same
bundle can also carry individual posts worth teaching, under `posts`:

```json
{ "posts": [
    { "url": "https://x.com/handle/status/123",
      "dialect": "Egyptian", "note": "why this one is worth teaching" }
] }
```

**Expect a low hit rate, and do not fight it.** On a plausible-looking list of
guessed handles, well over half returned an empty timeline — wrong handle,
protected account, or no syndication cache. That is exactly why stage 2 exists
and why nothing is approved on a hunch.

### Mention mining beats web search

Web search is bad at this. Asking it for "Yemeni comedians on X" returns TikTok
listicles and Wikipedia pages with no handles on them; a run of that produced
almost nothing usable. X's own graph is far better, and the harvest already
carries it: each tweet's `entities.user_mentions` names accounts the source
talks to, and those accounts are, by construction, in the same language
community.

Take a seed account that already works, collect the handles it mentions,
rank by frequency, and probe the top of that list. Measured on three Egyptian
seeds, it produced nine reachable accounts at 52–88% prefilter pass, including
two comedians whose feeds are exactly the register this app teaches. The same
run over Yemeni seeds is the honest counter-example below.

It only works on accounts that *talk to people*: three Yemeni news accounts
mentioned nobody at all across 299 tweets. Seed it with a person.

### What this actually found

A researched, live-verified starter bundle ships at
[`scripts/bundles/x-sources-2026-09.json`](../scripts/bundles/x-sources-2026-09.json)
— run it as-is. Every handle in it was fetched and every timeline read before
being written down. Two things it is worth being straight about:

**Egyptian is now solved-ish.** Comedians, actors and footballers pass the
prefilter at 52–88%, and the text is plainly what the app teaches:

> `تحبوا تفطروا ايه؟ انا طابخ بنفسي.. في رز شايط وملوخيه صايصه` — @ahelmy
>
> `للناس اللي لسة جايه تويتر.. اسمها تويتة مش بوست` — @OfficialHenedy

**Yemeni is genuinely thin on X, and no amount of pipeline fixes that.** Of
every Yemeni account reached, one — `ammaralazakii`, a singer — writes in
spoken register at any volume (56%). The rest are news desks (7–9%) or
political prose in MSA. If the Yemeni column matters, X is a supporting source
for it and Telegram or another platform has to carry the weight. That is a
finding about Yemeni X, not a gap in the tooling.

### The prefilter has a known false positive: devotional register

`MustafaHosny` scores 78% — higher than either comedian — and is almost
entirely MSA supplication:

> `اللهم إن الأرضَ أرضُك والسماءَ سماؤك وأنت نعم المولى ونعم النصير`

`اللهم` and `يا رب` are first and second person, so "someone is speaking" fires
exactly as designed; the register just isn't dialect. The model screen should
catch it and a reviewer certainly will, which is why the account is in the
bundle marked `VERIFY — probably reject` rather than quietly dropped. If this
class of source ever becomes common, the fix is a devotional-register list, not
a lower personal-marker weight.

## Stage 2: probe and import

```sh
SUPABASE_URL=... SOCIAL_HARVEST_SECRET=... \
  deno run --allow-env --allow-net --allow-read \
  scripts/discover-x-sources.ts bundle.json
```

The script probes every handle against syndication, prints a table (tweets
returned, how many are Arabic, how many clear the prefilter, how old the newest
is), drops anything under `--min-arabic`, and posts the survivors to
`import-x-bundle`. Useful flags:

- `--probe-only` — print the table and stop, touching Supabase not at all.
  This is the one to reach for when the edge function's IP is throttled but
  yours is not.
- `--dry-run` — probe, then print the payload instead of posting it.
- `--min-arabic N` — how many Arabic posts a handle must have returned to be
  worth a registry row (default 3).

Then approve what deserves it on `/admin/social-trends`. **Approving a source
is the decision that matters most in this whole pipeline**, because it decides
what gets harvested forever after — see "who is writing" below.

## Stage 3: harvest, prefilter, screen

`harvest-social-trends` walks every *approved* `x` source, fetches its
timeline, keeps the Arabic posts that clear the prefilter, and ranks them by
`colloquialScore` so a bounded screening budget spends itself on the most
colloquial of what came back rather than the top of the timeline. What each
source returned is written back to `social_content_sources.verification`, so a
handle that has quietly stopped resolving shows up in the registry instead of
just contributing nothing.

The platform keys, since `x` used to mean two things:

| Platform | Means |
| --- | --- |
| `x` | an X account handle — post bodies |
| `x_trends` | a getdaytrends country slug — trending topics, as before |
| `telegram`, `reddit` | unchanged |

## The prefilter, and what it can and cannot do

`_shared/socialPrescreen.ts` is the free half of the screen. One colloquial word
buys a model call outright — a headline quoting someone in dialect is the best
thing a news account produces. What it refuses:

| Reason | Rule |
| --- | --- |
| `no_arabic` | no Arabic script at all |
| `too_short` | fewer than 3 Arabic words once links, @mentions and #tags come off |
| `news_register` | no colloquial word, nobody in first or second person, and at least one newsroom marker |
| `headline` | no colloquial word, nobody speaking, and 7+ Arabic words |

The `headline` rule earns its place from a measurement, not from taste. Marker
lists alone barely dented a newspaper account — on 97 tweets from one, the
newsroom and MSA markers together rejected 3 — because headlines are long,
third-person and nominal and carry no marker from any list (`الأهلي يفوز على
الزمالك بهدفين في الدوري`). Adding "and nobody is speaking in it" is what
separates the two kinds of account. Measured live on 2026-09-05 with
`--probe-only`:

| Account | Kind | Arabic tweets | Clear the prefilter |
| --- | --- | --- | --- |
| `tamerhosny` | singer | 95 | **77 (81%)** |
| `amrdiab` | singer | 75 | **44 (59%)** |
| `AlAhly` | football club | 91 | **40 (44%)** |
| `almasryalyoum` | newspaper | 99 | **36 (36%)** |
| `masrawy` | newspaper | 100 | **27 (27%)** |

The ordering is the point: it falls out of who is writing, and it holds without
the filter knowing anything about the accounts. Before the register axis was
added, every one of these sat at 100%.

Two implementation notes that cost real time to find:

- JavaScript's `\b` is defined against `\w`, which is ASCII, so `\bمش\b`
  matches nowhere and every marker silently scores zero. Boundaries here are
  explicit lookarounds over the Arabic letter range.
- Arabic attaches pronouns as suffixes and conjunctions as prefixes, so a
  whole-word match on `شلون` misses `شلونكم`, which is the form people type.
  `wordRe` tolerates both.

**The prefilter is a backstop, not the strategy.** A newspaper account
harvests a wall of headlines whatever the prefilter does. Source curation is
what actually keeps the pipeline off the wire.

## Who is writing beats where they are

The split that matters is not country, it is **who is writing**. A newspaper
account writes wire copy in فصحى wherever it is based; a singer writing to
their followers writes the language this app teaches. From the seed harvest:

> `زوجتي حبيبتي ربنا يخليكي ليا ويخلي لينا اولادنا` — a personality account
>
> `طفل يعيد تمثيل مشهد اللحظات الأخيرة` — a newspaper account

Same country, same platform, same day. Only one of them is a lesson.

So the seed migration (`20260905120000_x_account_sources.sql`) approves
personality and club accounts and leaves newspapers as `candidate` with an
honest note, rather than seeding a wall of newsrooms and letting the screen
sort it out. That is what the Telegram side did, and it is why the Telegram
side reads the way it does.

## If free stops being enough

The paid option is a provider swap, not a redesign: `harvestXAccounts` becomes
a search call and everything downstream — prefilter, ranking, screen, review —
is untouched. Reference costs at the time of writing: X's own API $5/1K reads;
twitterapi.io $0.15/1K; SocialData $0.20/1K; several others $0.02–$0.05/1K.
Search is what the money buys — dialect-marker queries (`ازيك`, `عادك`, `بش`)
would find *content* rather than accounts, which is the one thing the free
route cannot do.

Do not add it speculatively. The free route's ceiling is set by how many good
accounts are in the registry, and the registry is nowhere near saturated.

## Related

- `README.md` — the feature and architecture writeup
- `docs/testing.md` — the test harness and CI gates
- `supabase/functions/_shared/xSyndication.ts` — the fetch/parse contract
- `supabase/functions/_shared/socialPrescreen.ts` — the prefilter
