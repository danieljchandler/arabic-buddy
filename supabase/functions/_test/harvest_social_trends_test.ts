import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * harvest-social-trends — the free-sources social pipeline.
 *
 * The function stitches together three fetch paths that cost nothing (Jina
 * over getdaytrends, t.me channel previews, Reddit's registered-app API) and
 * one thing that costs model tokens: the per-post dialect screen. The tests
 * pin the two properties the feature stands on — that nothing reaches
 * learners unscreened (a model outage leaves posts pending rather than
 * approving them), and that MSA is rejected rather than published, because a
 * "trending" feed that teaches فصحى is worse than no feed at all.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const TRENDS_MARKDOWN = [
  "| 1 | [#يوم_الجمعه](https://getdaytrends.com/saudi-arabia/trend/a/) |  | View details |",
  "| 2 | [محمد](https://getdaytrends.com/saudi-arabia/trend/b/) |  | View details |",
  "| 1 | [#yesterday_recap](https://getdaytrends.com/saudi-arabia/trend/c/) |  | View details |",
].join("\n");

const TELEGRAM_HTML = [
  '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kuwaitnews/101">',
  '<div class="tgme_widget_message_text js-message_text" dir="auto">شلونكم يا جماعة؟ اليوم عندنا خبر <b>مهم</b></div>',
  '<span class="tgme_widget_message_views">14.7K</span>',
  '<time datetime="2026-08-28T09:00:00+00:00" class="time">09:00</time></div></div>',
  '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kuwaitnews/102">',
  '<div class="tgme_widget_message_text js-message_text" dir="auto">English only message</div>',
  '<span class="tgme_widget_message_views">2K</span></div></div>',
].join("\n");

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
      if (request.method === "GET") return json(pending);
      return json([], request.method === "POST" ? 201 : 200);
    },
    "https://r.jina.ai/https://getdaytrends.com": () =>
      json({ code: 200, data: { content: TRENDS_MARKDOWN } }),
    "https://t.me/s/": () => new Response(TELEGRAM_HTML, { status: 200 }),
    "www.reddit.com/api/v1/access_token": () =>
      json({ access_token: "fixture-token", expires_in: 3600 }),
    "oauth.reddit.com": () => json(REDDIT_LISTING),
    "ai.gateway.lovable.dev": () => chatCompletion("", aVerdict()),
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

Deno.test("harvest-social-trends refuses a caller with neither secret nor manager role", async () => {
  const { status, body, calls } = await call({}, caller([]), { secret: false });

  // verify_jwt = false in config.toml, so this check is the only wall between
  // the open internet and a run that spends model tokens on screening.
  assertEquals(status, 403);
  assertEquals(body.error, "content_manager_required");
  assert(!calls.some((c) => c.url.includes("getdaytrends") || c.url.includes("t.me")));
});

Deno.test("harvest-social-trends stores topics and Arabic posts from all three platforms", async () => {
  const pending = [{ id: "post-1", arabic_text: "شلونكم يا جماعة؟", dialect: "Gulf" }];
  const { status, body, calls } = await call({}, caller(pending));

  assertEquals(status, 200);
  // Two current trends parse; the rank-restart row (a recap table) does not.
  assertEquals(body.topics, 2);
  const topicUpsert = calls.find((c) => c.url.includes("trending_topics") && c.method === "POST");
  assertStringIncludes(topicUpsert?.body ?? "", "#يوم_الجمعه");
  // Trends link out to X search rather than embedding post bodies — the only
  // free (and terms-compatible) way to show the tweets themselves.
  assertStringIncludes(topicUpsert?.body ?? "", "https://x.com/search?q=");

  // The English-only Telegram caption and Reddit thread never become rows:
  // an Arabic-script filter is cheaper than a model call that says "no".
  assertEquals(body.telegramPosts, 1);
  assertEquals(body.redditPosts, 1);
  const postUpserts = calls.filter((c) => c.url.includes("social_posts") && c.method === "POST");
  const upserted = postUpserts.map((c) => c.body ?? "").join("\n");
  assertStringIncludes(upserted, "kuwaitnews/101");
  assertStringIncludes(upserted, "t3_arabic");
  assert(!upserted.includes("t3_english"));

  // The pending post passed the screen, so the row carries the verdict's
  // translation and lands approved.
  assertEquals((body.screened as Record<string, number>).approved, 1);
  const patch = calls.find((c) => c.url.includes("social_posts") && c.method === "PATCH");
  assertStringIncludes(patch?.body ?? "", '"status":"approved"');
  assertStringIncludes(patch?.body ?? "", "How is everyone?");
});

Deno.test("harvest-social-trends rejects MSA rather than publishing it", async () => {
  const pending = [{ id: "post-1", arabic_text: "أعلنت الوزارة اليوم", dialect: "Gulf" }];
  const { body, calls } = await call(
    { platform: "x", screenLimit: 5 },
    caller(pending, {
      "ai.gateway.lovable.dev": () =>
        chatCompletion("", aVerdict({ register: "msa", reason: "Formal news register." })),
    }),
  );

  // The whole feature exists to surface dialect; a news-register post going
  // out as "trending" would teach exactly the فصحى the app promises never to.
  assertEquals((body.screened as Record<string, number>).rejected, 1);
  const patch = calls.find((c) => c.url.includes("social_posts") && c.method === "PATCH");
  assertStringIncludes(patch?.body ?? "", '"status":"rejected"');
});

Deno.test("harvest-social-trends leaves posts pending when the screen is down", async () => {
  const pending = [{ id: "post-1", arabic_text: "شلونكم", dialect: "Gulf" }];
  const { status, body, calls } = await call(
    { platform: "x", screenLimit: 5 },
    caller(pending, {
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  // Nothing auto-publishes unjudged (the clip pipeline's rule, same reason):
  // an outage must mean "try again next run", never "approve everything".
  assertEquals(status, 200);
  assertEquals((body.screened as Record<string, number>).pending, 1);
  assert(!calls.some((c) => c.url.includes("social_posts") && c.method === "PATCH"));
});

Deno.test("harvest-social-trends skips Reddit quietly when no app is registered", async () => {
  const { status, body, calls } = await call(
    { platform: "reddit", screenLimit: 0 },
    caller([]),
    { env: { REDDIT_CLIENT_ID: undefined, REDDIT_CLIENT_SECRET: undefined } },
  );

  // Reddit is the one source needing a (free) registered app. Unset secrets
  // are a setup state, not an error — the other platforms keep working and
  // the skip is visible in metrics rather than a 500.
  assertEquals(status, 200);
  assertEquals(body.redditPosts, 0);
  assert(!calls.some((c) => c.url.includes("reddit.com/r/") || c.url.includes("oauth.reddit")));
});
