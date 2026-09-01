import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * harvest-social-trends — the free-sources social pipeline.
 *
 * The function stitches together three fetch paths that cost nothing (Jina
 * over getdaytrends, t.me channel previews, Reddit's registered-app API) and
 * one thing that costs model tokens: the per-post dialect screen. The screen
 * is triage — a pass lands the post in the human review queue as 'screened',
 * never published — so the tests pin the properties the feature stands on:
 * nothing skips the queue, clear MSA is binned rather than queued, an outage
 * leaves posts pending, and the screening budget is spent per dialect so one
 * productive dialect cannot starve the others (the bug the first cut shipped:
 * Egyptian filled a global quota while Gulf stayed at zero).
 */

const USER = "00000000-0000-4000-8000-000000000001";

const TRENDS_MARKDOWN = [
  "| 1 | [#يوم_الجمعه](https://getdaytrends.com/saudi-arabia/trend/a/) |  | View details |",
  "| 2 | [محمد](https://getdaytrends.com/saudi-arabia/trend/b/) |  | View details |",
  "| 1 | [#yesterday_recap](https://getdaytrends.com/saudi-arabia/trend/c/) |  | View details |",
].join("\n");

const telegramPage = (posts: Array<{ id: number; text: string }>) =>
  posts
    .map(
      (p) =>
        `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kuwaitnews/${p.id}">` +
        `<div class="tgme_widget_message_text js-message_text" dir="auto">${p.text}</div>` +
        `<span class="tgme_widget_message_views">1.2K</span></div></div>`,
    )
    .join("\n");

const REDDIT_LISTING = {
  data: {
    children: [
      { data: { name: "t3_arabic", title: "وش رايكم بهالمطعم الجديد؟", selftext: "جربته امس وكان خرافي", ups: 42, num_comments: 7, permalink: "/r/Kuwait/comments/arabic/", created_utc: 1756300000, author: "u1" } },
      { data: { name: "t3_english", title: "Best shawarma in Salmiya?", selftext: "", ups: 90, num_comments: 20, permalink: "/r/Kuwait/comments/english/", created_utc: 1756300000, author: "u2" } },
    ],
  },
};

const sourceRows = [
  { id: "src-x", platform: "x", handle: "saudi-arabia", display_name: "Saudi Arabia trends", dialect: "Gulf", country: "Saudi Arabia" },
  { id: "src-tg", platform: "telegram", handle: "kuwaitnews", display_name: "Kuwait News", dialect: "Gulf", country: "Kuwait" },
  { id: "src-rd", platform: "reddit", handle: "Kuwait", display_name: "r/Kuwait", dialect: "Gulf", country: "Kuwait" },
];

const aVerdict = (over: Record<string, unknown> = {}) => ({
  is_arabic: true,
  register: "dialect",
  dialect: "Gulf",
  confidence: 0.9,
  translation: "How is everyone? Big news today.",
  reason: "Colloquial Gulf phrasing throughout.",
  ...over,
});

function caller(
  pending: Array<Record<string, unknown>>,
  extra: Record<string, UpstreamHandler> = {},
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([]),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/social_content_sources": (request) => {
      if (request.method !== "GET") return json([]);
      const platform = /platform=eq\.(\w+)/.exec(request.url)?.[1];
      return json(sourceRows.filter((s) => s.platform === platform));
    },
    "/rest/v1/trending_topics": () => json([], 201),
    "/rest/v1/social_posts": (request) => {
      // Three shapes hit this table: the countInReview head-count
      // (status=in.(…)), the per-dialect pending select (status=eq.pending),
      // and the upsert/update writes.
      if (request.method === "GET") {
        if (request.url.includes("status=in.")) return json([]);
        const dialect = /dialect=eq\.(\w+)/.exec(request.url)?.[1];
        return json(pending.filter((p) => !dialect || p.dialect === dialect));
      }
      return json([], request.method === "POST" ? 201 : 200);
    },
    "https://r.jina.ai/https://getdaytrends.com": () =>
      json({ code: 200, data: { content: TRENDS_MARKDOWN } }),
    "https://t.me/s/": (request) =>
      new Response(
        request.url.includes("before=")
          ? ""
          : telegramPage([
              { id: 101, text: "شلونكم يا جماعة؟ اليوم عندنا خبر <b>مهم</b>" },
              { id: 102, text: "English only message" },
            ]),
        { status: 200 },
      ),
    "www.reddit.com/api/v1/access_token": () =>
      json({ access_token: "fixture-token", expires_in: 3600 }),
    "oauth.reddit.com": () => json(REDDIT_LISTING),
    "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", aVerdict()),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  options: { secret?: boolean; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("harvest-social-trends", { upstreams, env: options.env });
  try {
    const response = await fn.handler(
      jsonRequest("harvest-social-trends", body, {
        jwt: null,
        headers: options.secret === false ? {} : { "x-harvest-secret": "fixture-harvest-secret" },
      }),
    );
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => ({ url: c.url, method: c.method, body: c.body })),
    };
  } finally {
    fn.restore();
  }
}

type Review = Record<string, { have: number; screenedThisRun: Record<string, number>; queueEmpty: boolean }>;

Deno.test("harvest-social-trends refuses a caller with neither secret nor manager role", async () => {
  const { status, body, calls } = await call({}, caller([]), { secret: false });

  // verify_jwt = false in config.toml, so this check is the only wall between
  // the open internet and a run that spends model tokens on screening.
  assertEquals(status, 403);
  assertEquals(body.error, "content_manager_required");
  assert(!calls.some((c) => c.url.includes("getdaytrends") || c.url.includes("t.me")));
});

Deno.test("harvest-social-trends stores topics and Arabic posts, queueing passes for human review", async () => {
  const pending = [{ id: "post-1", arabic_text: "شلونكم يا جماعة؟", dialect: "Gulf" }];
  const { status, body, calls } = await call({}, caller(pending));

  assertEquals(status, 200);
  // Two current trends parse; the rank-restart row (a recap table) does not.
  assertEquals(body.topics, 2);
  const topicUpsert = calls.find((c) => c.url.includes("trending_topics") && c.method === "POST");
  assertStringIncludes(topicUpsert?.body ?? "", "#يوم_الجمعه");
  assertStringIncludes(topicUpsert?.body ?? "", "https://x.com/search?q=");

  // The English-only Telegram caption and Reddit thread never become rows.
  assertEquals(body.telegramPosts, 1);
  assertEquals(body.redditPosts, 1);
  const upserted = calls
    .filter((c) => c.url.includes("social_posts") && c.method === "POST")
    .map((c) => c.body ?? "")
    .join("\n");
  assertStringIncludes(upserted, "kuwaitnews/101");
  assertStringIncludes(upserted, "t3_arabic");
  assert(!upserted.includes("t3_english"));

  // The pass lands in the review queue — 'screened', never 'approved'. The
  // human on /admin/social-trends is the publisher now.
  assertEquals((body.review as Review).Gulf.screenedThisRun.screened, 1);
  const patch = calls.find((c) => c.url.includes("social_posts") && c.method === "PATCH");
  assertStringIncludes(patch?.body ?? "", '"status":"screened"');
  assertStringIncludes(patch?.body ?? "", "How is everyone?");
  assert(!(patch?.body ?? "").includes('"status":"approved"'));
});

Deno.test("harvest-social-trends screens each dialect's own queue", async () => {
  const pending = [
    { id: "post-g", arabic_text: "شلونكم", dialect: "Gulf" },
    { id: "post-e", arabic_text: "إزيكم", dialect: "Egyptian" },
  ];
  const { body, calls } = await call({ platform: "x", targetPerDialect: 2 }, caller(pending));

  // The first cut screened one global pool: whichever dialect harvested most
  // filled the quota and the rest never got a model call. Now each dialect's
  // pending rows are fetched and screened separately.
  const review = body.review as Review;
  assertEquals(review.Gulf.screenedThisRun.screened, 1);
  assertEquals(review.Egyptian.screenedThisRun.screened, 1);
  // Yemeni had nothing pending: its queue is reported empty rather than the
  // run pretending it was served.
  assertEquals(review.Yemeni.queueEmpty, true);
  assertEquals(review.Yemeni.screenedThisRun, {});
  const pendingSelects = calls.filter(
    (c) => c.url.includes("status=eq.pending") && c.url.includes("dialect=eq."),
  );
  assert(pendingSelects.length >= 3);
});

Deno.test("harvest-social-trends pages further back through a thin Telegram channel", async () => {
  const { calls } = await call({ platform: "telegram", screenLimit: 0 }, caller([]));

  // One preview page is ~20 messages and a news channel's captions are often
  // media-only: a single page can yield one screenable post. The harvester
  // walks ?before= pages until it has enough Arabic posts or pages run out.
  const telegramFetches = calls.filter((c) => c.url.includes("t.me/s/kuwaitnews"));
  assert(telegramFetches.length >= 2, `expected pagination, saw ${telegramFetches.length} fetches`);
  // The cursor is the oldest id of everything parsed — 101 — not of the
  // Arabic survivors only.
  assert(telegramFetches.some((c) => c.url.includes("before=101")));
});

Deno.test("harvest-social-trends rejects MSA without queueing it for review", async () => {
  const pending = [{ id: "post-1", arabic_text: "أعلنت الوزارة اليوم", dialect: "Gulf" }];
  const { body, calls } = await call(
    { platform: "x", targetPerDialect: 1 },
    caller(pending, {
      "generativelanguage.googleapis.com/v1beta/openai": () =>
        chatCompletion("", aVerdict({ register: "msa", reason: "Formal news register." })),
    }),
  );

  // Generous triage still has a floor: clear فصحى wastes reviewer time, and
  // is the one register the app promises never to teach.
  assertEquals((body.review as Review).Gulf.screenedThisRun.rejected, 1);
  const patch = calls.find((c) => c.url.includes("social_posts") && c.method === "PATCH");
  assertStringIncludes(patch?.body ?? "", '"status":"rejected"');
});

Deno.test("harvest-social-trends leaves posts pending when the screen is down", async () => {
  const pending = [{ id: "post-1", arabic_text: "شلونكم", dialect: "Gulf" }];
  const { status, body, calls } = await call(
    { platform: "x", targetPerDialect: 1 },
    caller(pending, {
      "generativelanguage.googleapis.com/v1beta/openai": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  // Nothing reaches the review queue unjudged: an outage must mean "try
  // again next run", never "queue everything".
  assertEquals(status, 200);
  assertEquals((body.review as Review).Gulf.screenedThisRun.pending, 1);
  assert(!calls.some((c) => c.url.includes("social_posts") && c.method === "PATCH"));
});

Deno.test("harvest-social-trends skips Reddit quietly when no app is registered", async () => {
  const { status, body, calls } = await call(
    { platform: "reddit", screenLimit: 0, targetPerDialect: 1 },
    caller([], {
      "/rest/v1/social_posts": (request) =>
        request.method === "GET" ? json([]) : json([], 201),
    }),
    { env: { REDDIT_CLIENT_ID: undefined, REDDIT_CLIENT_SECRET: undefined } },
  );

  // Reddit is the one source needing a (free) registered app. Unset secrets
  // are a setup state, not an error — the other platforms keep working and
  // the skip is visible in metrics rather than a 500.
  assertEquals(status, 200);
  assertEquals(body.redditPosts, 0);
  assert(!calls.some((c) => c.url.includes("reddit.com/r/") || c.url.includes("oauth.reddit")));
});
