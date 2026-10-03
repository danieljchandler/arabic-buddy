import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * ai-canary-spend — the two totals the daily canary judges spend on.
 *
 * What must hold: nothing is read without the canary secret or an admin
 * session; costed rows land in the right window (last 24h vs the 7 days
 * before); the OpenRouter key's numbers come back and its label does not; a
 * missing or refusing OpenRouter key is reported, not thrown; a failed read is
 * a 500 rather than a total of zero.
 */

const SECRET = "fixture-canary-secret";
const HOUR = 60 * 60 * 1000;

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace("Z", "+00:00");

function usageRoute(rows: Array<{ cost_usd: number | null; created_at: string }>, uncosted = 2): UpstreamHandler {
  return (request) => {
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-range": `*/${uncosted}` } });
    }
    return json(rows);
  };
}

const keyInfo = (data: Record<string, unknown>): UpstreamHandler => () => json({ data });

async function call(
  opts: {
    secret?: boolean;
    jwt?: string | null;
    upstreams?: Record<string, UpstreamHandler>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const fn = await loadFunction("ai-canary-spend", {
    env: { AI_CANARY_SECRET: SECRET, ...(opts.env ?? {}) },
    upstreams: opts.upstreams ?? {},
  });
  try {
    const response = await fn.handler(
      jsonRequest("ai-canary-spend", {}, {
        jwt: opts.jwt === undefined ? null : opts.jwt,
        headers: opts.secret === false ? {} : { "x-canary-secret": SECRET },
      }),
    );
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body, calls: fn.calls };
  } finally {
    fn.restore();
  }
}

Deno.test("ai-canary-spend refuses an anonymous caller without the secret", async () => {
  const res = await call({ secret: false, jwt: null });
  assertEquals(res.status, 401);
  assert(!res.calls.some((c) => c.url.includes("/rest/v1/llm_usage_logs")));
  assert(!res.calls.some((c) => c.url.includes("openrouter.ai")));
});

Deno.test("ai-canary-spend refuses a signed-in learner who is not admin", async () => {
  const res = await call({
    secret: false,
    jwt: fixtureJwt(),
    upstreams: { "/rest/v1/user_roles": () => json([]) },
  });
  assertEquals(res.status, 403);
  assert(!res.calls.some((c) => c.url.includes("/rest/v1/llm_usage_logs")));
});

Deno.test("ai-canary-spend refuses a wrong secret", async () => {
  const fn = await loadFunction("ai-canary-spend", { env: { AI_CANARY_SECRET: SECRET } });
  try {
    const response = await fn.handler(
      jsonRequest("ai-canary-spend", {}, { jwt: null, headers: { "x-canary-secret": "guess" } }),
    );
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});

Deno.test("ai-canary-spend splits costed rows into the 24h and previous-7d windows", async () => {
  const res = await call({
    upstreams: {
      "/rest/v1/llm_usage_logs": usageRoute([
        { cost_usd: 0.25, created_at: iso(30 * HOUR) },
        { cost_usd: 1.5, created_at: iso(5 * 24 * HOUR) },
        { cost_usd: 0.1, created_at: iso(2 * HOUR) },
        { cost_usd: 0.05, created_at: iso(23 * HOUR) },
      ]),
      "openrouter.ai/api/v1/key": keyInfo({
        label: "hikaya-prod-key-name",
        limit: 50,
        limit_remaining: 12.5,
        usage_daily: 0.4,
      }),
    },
  });
  assertEquals(res.status, 200);
  const llm = res.body.llm as Record<string, unknown>;
  assertEquals(llm.last_24h_usd, 0.15);
  assertEquals(llm.previous_7d_usd, 1.75);
  assertEquals(llm.costed_rows_24h, 2);
  assertEquals(llm.uncosted_rows_24h, 2);
  assertEquals(llm.truncated, false);

  const or = res.body.openrouter as Record<string, unknown>;
  assertEquals(or, { configured: true, ok: true, limit: 50, limit_remaining: 12.5, usage_daily: 0.4 });
  assert(!JSON.stringify(res.body).includes("hikaya-prod-key-name"), "the key's label must not leave");

  // It asked for costed rows only, from eight days back.
  const read = res.calls.find((c) => c.url.includes("/rest/v1/llm_usage_logs") && c.method === "GET");
  assert(read, "expected a read of llm_usage_logs");
  assert(read.url.includes("cost_usd=not.is.null"), read.url);
  assert(read.url.includes("created_at=gte."), read.url);
  // And sent the OpenRouter key to OpenRouter only.
  const keyCall = res.calls.find((c) => c.url.includes("openrouter.ai/api/v1/key"));
  assertEquals(keyCall?.headers["authorization"], "Bearer fixture-openrouter");
});

Deno.test("ai-canary-spend reports an unlimited OpenRouter key as limit null", async () => {
  const res = await call({
    upstreams: {
      "/rest/v1/llm_usage_logs": usageRoute([]),
      "openrouter.ai/api/v1/key": keyInfo({ limit: null, limit_remaining: null, usage_daily: 3 }),
    },
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.openrouter, { configured: true, ok: true, limit: null, limit_remaining: null, usage_daily: 3 });
});

Deno.test("ai-canary-spend reports a missing or refusing OpenRouter key instead of throwing", async () => {
  const missing = await call({
    env: { OPENROUTER_API_KEY: undefined },
    upstreams: { "/rest/v1/llm_usage_logs": usageRoute([]) },
  });
  assertEquals(missing.status, 200);
  assertEquals(missing.body.openrouter, { configured: false, ok: false });
  assert(!missing.calls.some((c) => c.url.includes("openrouter.ai")));

  const refused = await call({
    upstreams: {
      "/rest/v1/llm_usage_logs": usageRoute([]),
      "openrouter.ai/api/v1/key": () => json({ error: { message: "No auth credentials found" } }, 401),
    },
  });
  assertEquals(refused.status, 200);
  assertEquals(refused.body.openrouter, { configured: true, ok: false, status: 401 });
});

Deno.test("ai-canary-spend answers 500 when the usage table cannot be read", async () => {
  const res = await call({
    upstreams: {
      "/rest/v1/llm_usage_logs": () => json({ message: "permission denied", code: "42501" }, 403),
      "openrouter.ai/api/v1/key": keyInfo({ limit: 50, limit_remaining: 40 }),
    },
  });
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "spend_read_failed");
  assert(!("llm" in res.body), "a failed read must not look like a zero total");
});

Deno.test("ai-canary-spend lets an admin session in without the secret", async () => {
  const res = await call({
    secret: false,
    jwt: fixtureJwt(),
    upstreams: {
      "/rest/v1/user_roles": () => json([{ role: "admin" }]),
      "/rest/v1/llm_usage_logs": usageRoute([]),
      "openrouter.ai/api/v1/key": keyInfo({ limit: 50, limit_remaining: 49 }),
    },
  });
  assertEquals(res.status, 200);
});
