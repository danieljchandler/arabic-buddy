import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCases,
  CANARY_DIALECTS,
  CANARY_GOLDEN_IDS,
  type CanaryCase,
  type CanaryDialect,
  DEFAULT_SPEND_THRESHOLDS,
  fetchSpend,
  type FetchLike,
  formatCaseLine,
  GOLDEN_FILES,
  type GoldenRow,
  judgeSpend,
  missingConfig,
  notConfiguredMessage,
  parseGolden,
  pickGolden,
  readSse,
  REQUIRED_ENV,
  runCase,
  type RunContext,
  signIn,
  souqDialectFor,
  type SpendReport,
  spendThresholdsFromEnv,
  supabaseUrlFromConfig,
} from "../../scripts/ai-canary-core.ts";

/**
 * The daily AI canary's deciding logic (scripts/ai-canary-core.ts).
 *
 * The canary's job is to go red when a learner-facing AI feature fails
 * silently or spend runs away, and to stay green otherwise. Both directions
 * are tested here against a mocked network: a canary that cannot fail is as
 * useless as one that always does. The live run itself needs production
 * credentials and lives in .github/workflows/ai-canary.yml.
 */

const GOLDEN_DIR = join(process.cwd(), "supabase", "functions", "_test", "eval", "golden");

function realGolden(): Record<CanaryDialect, GoldenRow> {
  const out = {} as Record<CanaryDialect, GoldenRow>;
  for (const d of CANARY_DIALECTS) {
    out[d] = pickGolden(parseGolden(readFileSync(join(GOLDEN_DIR, GOLDEN_FILES[d]), "utf8")), d);
  }
  return out;
}

const URL_BASE = "https://canary.supabase.test";

/** A fetch that answers from a route table and records what it was asked. */
function mockFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unrouted: ${url}`);
    return routes[key](init);
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sse = (...frames: string[]) =>
  new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

const chunk = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] });

/** A clock that moves only when told: `advance(ms)` from inside a mocked call. */
function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function ctx(fetchFn: FetchLike, now = clock().now): RunContext {
  return { fetch: fetchFn, now, supabaseUrl: URL_BASE, anonKey: "anon", accessToken: "user-jwt" };
}

function oneCase(fn: CanaryCase["fn"], dialect: CanaryDialect = "Gulf"): CanaryCase {
  const c = buildCases(realGolden(), { nowMs: 0, env: { CANARY_SOUQ_ALL_DIALECTS: "1" } }).find(
    (x) => x.fn === fn && x.dialect === dialect,
  );
  if (!c) throw new Error(`no case for ${fn}/${dialect}`);
  return c;
}

describe("configuration", () => {
  it("names every missing secret, so an unconfigured run fails loudly", () => {
    expect(missingConfig({})).toEqual([...REQUIRED_ENV]);
    expect(notConfiguredMessage(missingConfig({ HIKAYA_CANARY_EMAIL: "x" }))).toBe(
      "canary not configured: missing HIKAYA_SUPABASE_ANON_KEY, HIKAYA_CANARY_PASSWORD, HIKAYA_AI_CANARY_SECRET",
    );
    const all = Object.fromEntries(REQUIRED_ENV.map((n) => [n, "set"]));
    expect(missingConfig(all)).toEqual([]);
    // Whitespace is not a value.
    expect(missingConfig({ ...all, HIKAYA_CANARY_PASSWORD: "  " })).toEqual(["HIKAYA_CANARY_PASSWORD"]);
  });

  it("reads the project URL from the real supabase/config.toml", () => {
    const toml = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
    expect(supabaseUrlFromConfig(toml)).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(supabaseUrlFromConfig("nothing here")).toBeNull();
  });

  it("takes thresholds from repository variables, ignoring junk", () => {
    expect(spendThresholdsFromEnv({})).toEqual(DEFAULT_SPEND_THRESHOLDS);
    const t = spendThresholdsFromEnv({
      CANARY_MAX_DAILY_USD: "25",
      CANARY_SPIKE_RATIO: "abc",
      CANARY_REQUIRE_OPENROUTER_LIMIT: "0",
    });
    expect(t.maxDailyUsd).toBe(25);
    expect(t.spikeRatio).toBe(DEFAULT_SPEND_THRESHOLDS.spikeRatio);
    expect(t.requireOpenRouterLimit).toBe(false);
  });
});

describe("cases", () => {
  it("uses golden rows that exist in every dialect's file", () => {
    const golden = realGolden();
    for (const d of CANARY_DIALECTS) {
      expect(golden[d].id).toBe(CANARY_GOLDEN_IDS[d]);
      expect(golden[d].good.length).toBeGreaterThan(0);
    }
  });

  it("covers six functions in three dialects, souq-news on one rotating dialect", () => {
    const cases = buildCases(realGolden(), { nowMs: 0 });
    const fns = new Set(cases.map((c) => c.fn));
    expect(fns.size).toBe(6);
    expect(cases).toHaveLength(5 * 3 + 1);
    expect(cases.filter((c) => c.fn === "souq-news").map((c) => c.dialect)).toEqual([souqDialectFor(0)]);
    // Three consecutive days visit all three dialects.
    const day = 86_400_000;
    expect(new Set([0, day, 2 * day].map(souqDialectFor))).toEqual(new Set(CANARY_DIALECTS));
  });

  it("can be narrowed, and run souq-news in every dialect on request", () => {
    const narrowed = buildCases(realGolden(), { nowMs: 0, only: ["translate-text"] });
    expect(narrowed.map((c) => c.id)).toEqual(["translate-text/Gulf", "translate-text/Egyptian", "translate-text/Yemeni"]);
    const all = buildCases(realGolden(), { nowMs: 0, env: { CANARY_SOUQ_ALL_DIALECTS: "1" }, only: ["souq-news"] });
    expect(all).toHaveLength(3);
  });

  it("sends translate-text the golden line, and writing-coach the no-write prompt action", () => {
    const golden = realGolden();
    expect(oneCase("translate-text", "Egyptian").body).toEqual({ text: golden.Egyptian.good, dialect: "Egyptian" });
    expect(oneCase("writing-coach").body).toEqual({ action: "prompt", dialect: "Gulf" });
    expect(oneCase("assistant-chat", "Yemeni").body.seed).toEqual({ arabic: golden.Yemeni.good });
  });

  it("lets a latency ceiling be overridden per function", () => {
    const [c] = buildCases(realGolden(), {
      nowMs: 0,
      only: ["souq-news"],
      env: { CANARY_LATENCY_SOUQ_NEWS_MS: "5000" },
    });
    expect(c.maxLatencyMs).toBe(5000);
  });
});

describe("runCase", () => {
  const goodTranslation = {
    detected_dialect: "Gulf",
    sentences: [{ arabic: "وين رايح الحين؟", literal: "where going now?", natural: "Where are you off to now?" }],
  };

  it("passes a 2xx, non-empty, leak-free, fast answer and sends the user's token", async () => {
    const m = mockFetch({ "/functions/v1/translate-text": () => json(goodTranslation) });
    const r = await runCase(oneCase("translate-text"), ctx(m.fn));
    expect(r).toMatchObject({ ok: true, status: 200, failures: [] });
    const headers = m.calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user-jwt");
    expect(headers.apikey).toBe("anon");
    expect(m.calls[0].url).toBe(`${URL_BASE}/functions/v1/translate-text`);
  });

  it("fails a non-2xx with its status", async () => {
    const m = mockFetch({ "/functions/v1/translate-text": () => json({ error: "ai_failed" }, 429) });
    const r = await runCase(oneCase("translate-text"), ctx(m.fn));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.failures).toContain("HTTP 429");
    expect(r.excerpt).toContain("ai_failed");
  });

  it("fails an empty 200, which is how souq-news says it found nothing", async () => {
    const m = mockFetch({ "/functions/v1/souq-news": () => json({ articles: [] }) });
    const r = await runCase(oneCase("souq-news"), ctx(m.fn));
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("empty answer");
  });

  it("fails an MSA leak in the dialect Arabic, naming the token", async () => {
    const m = mockFetch({
      "/functions/v1/writing-coach": () =>
        json({ prompt: { message_arabic: "سوف أتصل بك غدا", message_english: "I will call you tomorrow", scenario_english: "x" } }),
    });
    const r = await runCase(oneCase("writing-coach"), ctx(m.fn));
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/MSA leak: .*سوف/);
  });

  it("fails a slow answer even when it is otherwise good", async () => {
    const c = clock();
    const kase = oneCase("translate-text");
    const m = mockFetch({
      "/functions/v1/translate-text": () => {
        c.advance(kase.maxLatencyMs + 1_000);
        return json(goodTranslation);
      },
    });
    const r = await runCase(kase, ctx(m.fn, c.now));
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/^latency \d+\.\ds over 45s$/);
  });

  it("reports a thrown request without throwing", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError("connection reset");
    };
    const r = await runCase(oneCase("reading-passage"), ctx(failing));
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toBe("request failed: connection reset");
  });

  it("reads a streamed answer up to [DONE] and judges it", async () => {
    const m = mockFetch({
      "/functions/v1/assistant-chat": () =>
        sse(chunk("وين means where, "), chunk("الحين means now."), "[DONE]", JSON.stringify({ app: "native_review" })),
    });
    const r = await runCase(oneCase("assistant-chat"), ctx(m.fn));
    expect(r.ok).toBe(true);
    expect(r.excerpt).toBe("وين means where, الحين means now.");
  });

  it("times a stream to [DONE], and still reads what follows it", async () => {
    // assistant-chat keeps the connection open after [DONE] for a native
    // review. That wait is not the learner's, so it must not count; but the
    // stream is read to the end, because hanging up skips the function's own
    // usage logging.
    const c = clock();
    const kase = oneCase("assistant-chat");
    const enc = new TextEncoder();
    let pulls = 0;
    let readToEnd = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) {
          controller.enqueue(enc.encode(`data: ${chunk("الحين means now.")}\n\ndata: [DONE]\n\n`));
        } else if (pulls === 2) {
          c.advance(kase.maxLatencyMs * 1.5);
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: "late review failed" } })}\n\n`));
        } else {
          readToEnd = true;
          controller.close();
        }
      },
      // Pull only when read: otherwise the stream pre-fetches the late frame
      // (and moves the clock) before the reader has seen [DONE].
    }, { highWaterMark: 0 });
    const m = mockFetch({
      "/functions/v1/assistant-chat": () =>
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    });
    const r = await runCase(kase, ctx(m.fn, c.now));
    expect(r.failures).toEqual([]);
    expect(r.latencyMs).toBe(0);
    expect(readToEnd).toBe(true);
  });

  it("fails culture-guide's canned no-answer text, sent with a 200", async () => {
    const m = mockFetch({
      "/functions/v1/culture-guide": () =>
        sse(chunk("I couldn't come up with an answer for that. Try asking it another way."), "[DONE]"),
    });
    const r = await runCase(oneCase("culture-guide"), ctx(m.fn));
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("canned no-answer text");
  });

  it("fails a stream that carries an error frame", async () => {
    const m = mockFetch({
      "/functions/v1/assistant-chat": () => sse(chunk("half an"), JSON.stringify({ error: { message: "upstream died" } })),
    });
    const r = await runCase(oneCase("assistant-chat"), ctx(m.fn));
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/upstream died/);
  });

  it("warns, without failing, when translate-text detects a different dialect", async () => {
    const m = mockFetch({
      "/functions/v1/translate-text": () => json({ ...goodTranslation, detected_dialect: "Yemeni" }),
    });
    const r = await runCase(oneCase("translate-text"), ctx(m.fn));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(["detected Yemeni, sent Gulf"]);
    expect(formatCaseLine(r)).toContain("(detected Yemeni, sent Gulf)");
  });

  it("formats a failure line with the reasons", async () => {
    const m = mockFetch({ "/functions/v1/translate-text": () => json({}, 500) });
    const r = await runCase(oneCase("translate-text"), ctx(m.fn));
    expect(formatCaseLine(r)).toMatch(/^FAIL {2}translate-text\/Gulf +500 .* HTTP 500$/);
  });
});

describe("readSse", () => {
  it("returns what arrived when the stream ends without [DONE]", async () => {
    const res = sse(chunk("a"), chunk("b"));
    await expect(readSse(res.body!)).resolves.toBe("ab");
  });
});

describe("signIn", () => {
  it("posts the password grant with the anon key and returns the access token", async () => {
    const m = mockFetch({ "/auth/v1/token": () => json({ access_token: "jwt-123" }) });
    await expect(signIn(m.fn, URL_BASE, "anon", "canary@example.test", "pw")).resolves.toBe("jwt-123");
    expect(m.calls[0].url).toBe(`${URL_BASE}/auth/v1/token?grant_type=password`);
    expect((m.calls[0].init?.headers as Record<string, string>).apikey).toBe("anon");
  });

  it("fails with the status only, never the credentials", async () => {
    const m = mockFetch({ "/auth/v1/token": () => json({ error: "invalid_grant" }, 400) });
    const err = await signIn(m.fn, URL_BASE, "anon", "canary@example.test", "hunter2").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/HTTP 400/);
    expect((err as Error).message).not.toMatch(/hunter2|canary@example/);
  });
});

describe("spend", () => {
  const report = (over: Partial<SpendReport["llm"]> = {}, or: Partial<SpendReport["openrouter"]> = {}): SpendReport => ({
    llm: { last_24h_usd: 1, previous_7d_usd: 7, costed_rows_24h: 100, uncosted_rows_24h: 5, truncated: false, ...over },
    openrouter: { configured: true, ok: true, limit: 50, limit_remaining: 30, usage_daily: 1, ...or },
  });
  const t = DEFAULT_SPEND_THRESHOLDS;

  it("passes an ordinary day", () => {
    expect(judgeSpend(report(), t)).toEqual({ ok: true, failures: [], notes: [] });
  });

  it("fails a day over the ceiling", () => {
    const v = judgeSpend(report({ last_24h_usd: 12, previous_7d_usd: 70 }), t);
    expect(v.ok).toBe(false);
    expect(v.failures).toEqual(["LLM spend in the last 24h is over the $10.00 daily ceiling"]);
  });

  it("fails a spike against the trailing week, but not one under the floor", () => {
    const spike = judgeSpend(report({ last_24h_usd: 4, previous_7d_usd: 7 }), t);
    expect(spike.failures).toEqual(["LLM spend spike: the last 24h is more than 3x the trailing 7-day daily mean"]);
    // 1.5 is 10x a quiet week's mean, and still not worth an alarm.
    expect(judgeSpend(report({ last_24h_usd: 1.5, previous_7d_usd: 1 }), t).ok).toBe(true);
  });

  it("never prints amounts unless asked: the repository and its logs are public", () => {
    const v = judgeSpend(report({ last_24h_usd: 12.34, previous_7d_usd: 7 }), t);
    expect(v.failures.join(" ")).not.toContain("12.34");
    const shown = judgeSpend(report({ last_24h_usd: 12.34, previous_7d_usd: 7 }), t, true);
    expect(shown.failures.join(" ")).toContain("$12.34");
  });

  it("fails an OpenRouter key that is low, unlimited, unreadable or missing", () => {
    expect(judgeSpend(report({}, { limit_remaining: 3 }), t).failures).toEqual([
      "OpenRouter key has less than $5.00 left of its limit",
    ]);
    expect(judgeSpend(report({}, { limit: null, limit_remaining: null }), t).failures).toEqual([
      "OpenRouter key has no credit limit set; set a per-key limit",
    ]);
    expect(judgeSpend(report({}, { ok: false, status: 401 }), t).failures).toEqual([
      "OpenRouter key-info read failed (HTTP 401)",
    ]);
    expect(judgeSpend(report({}, { configured: false, ok: false }), t).failures).toEqual([
      "OpenRouter: OPENROUTER_API_KEY is not set on the functions",
    ]);
  });

  it("only notes an unlimited key when that check is switched off", () => {
    const v = judgeSpend(report({}, { limit: null }), { ...t, requireOpenRouterLimit: false });
    expect(v.ok).toBe(true);
    expect(v.notes).toEqual(["OpenRouter key has no credit limit set"]);
  });

  it("notes a total it cannot trust", () => {
    const v = judgeSpend(report({ uncosted_rows_24h: 500, truncated: true }), t);
    expect(v.ok).toBe(true);
    expect(v.notes).toHaveLength(2);
  });

  it("fetches the report with the canary secret, and names the fix when refused or undeployed", async () => {
    const good = mockFetch({ "/functions/v1/ai-canary-spend": () => json(report()) });
    const ok = await fetchSpend(good.fn, URL_BASE, "anon", "s3cret");
    expect(ok).toEqual({ ok: true, report: report() });
    expect((good.calls[0].init?.headers as Record<string, string>)["x-canary-secret"]).toBe("s3cret");

    const missing = mockFetch({ "/functions/v1/ai-canary-spend": () => json({}, 404) });
    expect(await fetchSpend(missing.fn, URL_BASE, "anon", "s")).toEqual({
      ok: false,
      failure: "spend check: ai-canary-spend is not deployed (404)",
    });

    const refused = mockFetch({ "/functions/v1/ai-canary-spend": () => json({}, 401) });
    const r = await fetchSpend(refused.fn, URL_BASE, "anon", "s");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failure).toMatch(/AI_CANARY_SECRET/);

    const odd = mockFetch({ "/functions/v1/ai-canary-spend": () => json({ hello: 1 }) });
    expect(await fetchSpend(odd.fn, URL_BASE, "anon", "s")).toEqual({
      ok: false,
      failure: "spend check returned an unexpected body",
    });
  });
});
