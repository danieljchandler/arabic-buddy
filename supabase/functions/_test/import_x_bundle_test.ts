import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * import-x-bundle — where the research loop's proposals land.
 *
 * There is no free X search, so which accounts write Yemeni or Egyptian is a
 * research question rather than an API call, and the answer arrives from
 * outside the trust boundary: an agent proposes, this function records. The
 * tests pin the boundary, because that is the whole design:
 *
 *   - a proposed source becomes a candidate, never an approved one, and a
 *     re-import can neither approve a source nor resurrect a rejected one;
 *   - a proposed post's text is re-fetched from X rather than believed, so a
 *     bundle cannot plant words nobody tweeted;
 *   - everything lands as 'pending' and goes through the same screen and the
 *     same human review as anything the harvester found.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const tweetResult = (over: Record<string, unknown> = {}) => ({
  id_str: "1900000000000000001",
  full_text: "والله يا جماعة عادكم ما شفتوا شي، الوضع هنا غير تماما",
  created_at: "2026-09-04T10:00:00.000Z",
  lang: "ar",
  favorite_count: 300,
  user: { screen_name: "yemenivoice" },
  ...over,
});

const timeline = (tweets: Array<Record<string, unknown>>) =>
  `<html><script id="__NEXT_DATA__" type="application/json">` +
  JSON.stringify({
    props: {
      pageProps: { timeline: { entries: tweets.map((t) => ({ type: "tweet", content: { tweet: t } })) } },
    },
  }) +
  `</script></html>`;

function upstreams(
  existingSources: Array<Record<string, unknown>> = [],
  extra: Record<string, UpstreamHandler> = {},
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([]),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/social_content_sources": (request) =>
      request.method === "GET" ? json(existingSources) : json([], request.method === "POST" ? 201 : 200),
    "/rest/v1/social_posts": (request) => json([], request.method === "POST" ? 201 : 200),
    "syndication.twitter.com/srv/timeline-profile": () =>
      new Response(timeline([tweetResult()]), { status: 200 }),
    "cdn.syndication.twimg.com/tweet-result": () => json(tweetResult()),
    ...extra,
  };
}

async function call(
  body: unknown,
  handlers: Record<string, UpstreamHandler>,
  options: { secret?: boolean } = {},
) {
  const fn = await loadFunction("import-x-bundle", { upstreams: handlers });
  try {
    const response = await fn.handler(
      jsonRequest("import-x-bundle", body, {
        jwt: null,
        headers: options.secret === false ? {} : { "x-harvest-secret": "fixture-harvest-secret" },
      }),
    );
    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
      calls: fn.calls.map((c) => ({ url: c.url, method: c.method, body: c.body })),
    };
  } finally {
    fn.restore();
  }
}

type SourceOutcome = { handle: string; outcome: string; verification?: Record<string, unknown> };
type PostOutcome = { id: string; outcome: string };

Deno.test("import-x-bundle refuses a caller with neither secret nor manager role", async () => {
  const { status, body, calls } = await call(
    { sources: [{ handle: "yemenivoice", dialect: "Yemeni" }] },
    upstreams(),
    { secret: false },
  );

  assertEquals(status, 403);
  assertEquals(body.error, "content_manager_required");
  assert(!calls.some((c) => c.url.includes("syndication")));
});

Deno.test("import-x-bundle rejects an empty bundle", async () => {
  const { status, body } = await call({}, upstreams());
  assertEquals(status, 400);
  assertEquals(body.error, "empty_bundle");
});

Deno.test("import-x-bundle stores a proposed source as a candidate with its evidence", async () => {
  const { status, body, calls } = await call(
    {
      sources: [
        {
          handle: "yemenivoice",
          displayName: "Yemeni Voice",
          dialect: "Yemeni",
          country: "Yemen",
          notes: "Found via research: posts daily in Sanaani.",
        },
      ],
    },
    upstreams(),
  );

  assertEquals(status, 200);
  const [source] = body.sources as SourceOutcome[];
  assertEquals(source.outcome, "candidate");
  // Verified by fetching, not by trusting the bundle.
  assertEquals(source.verification?.tweets, 1);
  const insert = calls.find(
    (c) => c.url.includes("social_content_sources") && c.method === "POST",
  );
  assertStringIncludes(insert?.body ?? "", '"status":"candidate"');
  assertStringIncludes(insert?.body ?? "", "Sanaani");
  assert(!(insert?.body ?? "").includes('"status":"approved"'));
});

Deno.test("import-x-bundle refuses a handle that does not resolve", async () => {
  const { body, calls } = await call(
    { sources: [{ handle: "ghosthandle", dialect: "Yemeni" }] },
    upstreams([], {
      "syndication.twitter.com/srv/timeline-profile": () =>
        new Response(timeline([]), { status: 200 }),
    }),
  );

  // Guessing handles has a poor hit rate — well over half of a plausible list
  // returns an empty timeline — so an unreachable handle must not become a
  // registry row a reviewer then has to work out.
  assertEquals((body.sources as SourceOutcome[])[0].outcome, "unreachable");
  assert(!calls.some((c) => c.url.includes("social_content_sources") && c.method === "POST"));
});

Deno.test("import-x-bundle refuses a malformed handle or dialect without fetching", async () => {
  const { body, calls } = await call(
    {
      sources: [
        { handle: "has-a-dash", dialect: "Yemeni" },
        { handle: "goodhandle", dialect: "Levantine" },
      ],
    },
    upstreams(),
  );

  const outcomes = (body.sources as SourceOutcome[]).map((s) => s.outcome);
  assertEquals(outcomes, ["invalid_handle", "invalid_dialect"]);
  assert(!calls.some((c) => c.url.includes("syndication")));
});

Deno.test("import-x-bundle never changes the status of a source a human judged", async () => {
  const { body, calls } = await call(
    { sources: [{ handle: "yemenivoice", dialect: "Yemeni", notes: "re-proposed" }] },
    upstreams([{ id: "src-1", handle: "yemenivoice", status: "rejected", dialect: "Yemeni", country: "Yemen" }]),
  );

  assertEquals((body.sources as SourceOutcome[])[0].outcome, "existing_rejected");
  const patch = calls.find(
    (c) => c.url.includes("social_content_sources") && c.method === "PATCH",
  );
  // Evidence and notes refresh; the verdict does not. A bundle must not be
  // able to resurrect a source a human binned.
  assertStringIncludes(patch?.body ?? "", "re-proposed");
  assert(!(patch?.body ?? "").includes('"status"'));
});

Deno.test("import-x-bundle re-fetches a proposed post rather than believing the bundle", async () => {
  const { body, calls } = await call(
    {
      posts: [
        {
          url: "https://x.com/yemenivoice/status/1900000000000000001",
          dialect: "Yemeni",
          note: "great Sanaani phrasing",
        },
      ],
    },
    upstreams(),
  );

  assertEquals((body.posts as PostOutcome[])[0].outcome, "pending");
  assertEquals(body.accepted, 1);
  const insert = calls.find((c) => c.url.includes("social_posts") && c.method === "POST");
  // The stored body is X's, not the bundle's, and it enters the queue
  // unjudged — same prefilter, same screen, same human as everything else.
  assertStringIncludes(insert?.body ?? "", "عادكم");
  assertStringIncludes(insert?.body ?? "", "great Sanaani phrasing");
  assert(!(insert?.body ?? "").includes('"status"'));
});

Deno.test("import-x-bundle refuses a URL that merely embeds an X link", async () => {
  const { body, calls } = await call(
    { posts: [{ url: "https://attacker.tld/?u=https://x.com/a/status/1", dialect: "Yemeni" }] },
    upstreams(),
  );

  assertEquals((body.posts as PostOutcome[])[0].outcome, "invalid_url");
  assert(!calls.some((c) => c.url.includes("attacker.tld")));
});

Deno.test("import-x-bundle skips a deleted or protected post", async () => {
  const { body, calls } = await call(
    { posts: [{ url: "https://x.com/yemenivoice/status/1900000000000000001", dialect: "Yemeni" }] },
    upstreams([], {
      "cdn.syndication.twimg.com/tweet-result": () => json({ __typename: "TweetTombstone" }),
    }),
  );

  assertEquals((body.posts as PostOutcome[])[0].outcome, "unavailable");
  assert(!calls.some((c) => c.url.includes("social_posts") && c.method === "POST"));
});

Deno.test("import-x-bundle takes a post's dialect from the source when the bundle omits it", async () => {
  const { body, calls } = await call(
    { posts: [{ url: "https://x.com/yemenivoice/status/1900000000000000001" }] },
    upstreams([{ id: "src-1", handle: "yemenivoice", status: "approved", dialect: "Yemeni", country: "Yemen" }]),
  );

  assertEquals((body.posts as PostOutcome[])[0].outcome, "pending");
  const insert = calls.find((c) => c.url.includes("social_posts") && c.method === "POST");
  assertStringIncludes(insert?.body ?? "", '"dialect":"Yemeni"');
  assertStringIncludes(insert?.body ?? "", '"source_id":"src-1"');
});
