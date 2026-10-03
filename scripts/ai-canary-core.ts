/**
 * The pure half of the daily AI canary (scripts/ai-canary.ts).
 *
 * Everything that decides pass or fail lives here, with `fetch` and the clock
 * passed in, so the Vitest suite can drive it with a mocked network
 * (src/test/aiCanary.test.ts). The runner only reads the environment, the
 * golden files and the clock, and prints.
 *
 * Two halves:
 *
 *   1. Feature checks. About six learner-facing functions, each called with a
 *      fixed Gulf, Egyptian and Yemeni input from the golden set, as a signed-in
 *      subscriber. A check passes on a 2xx, a non-empty answer that is not one
 *      of the functions' own canned "nothing came back" texts, no MSA leak by
 *      `detectMsaLeaks` for the dialect asked for, and a latency under the
 *      function's threshold. The 2026-09-29 sweep found these failing silently
 *      for days; this is the check that would have said so the first morning.
 *
 *   2. Spend. The `ai-canary-spend` function returns two totals (24h and the
 *      seven days before, from `llm_usage_logs`) and the OpenRouter key's
 *      remaining limit. The canary fails on a day over the ceiling, a spike
 *      against the trailing week, a key with less than the floor left, or a
 *      key with no limit at all.
 */
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector.ts";

export type CanaryDialect = "Gulf" | "Egyptian" | "Yemeni";
export const CANARY_DIALECTS: readonly CanaryDialect[] = ["Gulf", "Egyptian", "Yemeni"];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * GitHub Actions secret names. All four are needed; the canary refuses to run
 * (and fails) without them rather than reporting a green run that checked
 * nothing.
 */
export const REQUIRED_ENV = [
  // The public anon/publishable key, the same value the frontend ships.
  "HIKAYA_SUPABASE_ANON_KEY",
  // The dedicated canary account, marked subscriber (complimentary role).
  "HIKAYA_CANARY_EMAIL",
  "HIKAYA_CANARY_PASSWORD",
  // Same value as the AI_CANARY_SECRET function secret in Supabase.
  "HIKAYA_AI_CANARY_SECRET",
] as const;

export type Env = Record<string, string | undefined>;

export function missingConfig(env: Env): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

export function notConfiguredMessage(missing: string[]): string {
  return `canary not configured: missing ${missing.join(", ")}`;
}

/** `https://<project_id>.supabase.co`, from supabase/config.toml's project_id. */
export function supabaseUrlFromConfig(configToml: string): string | null {
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(configToml);
  return match ? `https://${match[1]}.supabase.co` : null;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Per-function latency ceilings, in milliseconds.
 *
 * DECISION FOR DANIEL: generous on purpose. A canary that goes red on an
 * ordinary slow morning gets ignored, and these exist to catch "hung" and
 * "silently failing", not to tune performance. reading-passage runs a quality
 * gate and a repair pass; souq-news runs Firecrawl searches and four rewrites.
 * Override any one with CANARY_LATENCY_<NAME>_MS (e.g. CANARY_LATENCY_SOUQ_NEWS_MS).
 */
export const DEFAULT_LATENCY_MS: Record<CanaryFunction, number> = {
  "translate-text": 45_000,
  "culture-guide": 60_000,
  "writing-coach": 45_000,
  "reading-passage": 90_000,
  "souq-news": 120_000,
  "assistant-chat": 60_000,
};

export interface SpendThresholds {
  /** Fail when the last 24h of logged LLM cost exceeds this. */
  maxDailyUsd: number;
  /** Fail when the last 24h is more than this multiple of the trailing 7-day daily mean... */
  spikeRatio: number;
  /** ...and above this floor, so a quiet week cannot turn $0.30 into an alarm. */
  spikeFloorUsd: number;
  /** Fail when the OpenRouter key has less than this left of its limit. */
  minOpenRouterRemainingUsd: number;
  /** Fail when the OpenRouter key has no limit at all. */
  requireOpenRouterLimit: boolean;
}

/**
 * DECISION FOR DANIEL: these are guesses made without the real daily spend,
 * which nothing outside the database records. Conservative means "alarm early":
 * a red morning costs a look at the dashboard, a missed spike costs the bill.
 * Override with the repository variables CANARY_MAX_DAILY_USD,
 * CANARY_SPIKE_RATIO, CANARY_SPIKE_FLOOR_USD, CANARY_MIN_OPENROUTER_USD and
 * CANARY_REQUIRE_OPENROUTER_LIMIT (0 to switch that check off).
 */
export const DEFAULT_SPEND_THRESHOLDS: SpendThresholds = {
  maxDailyUsd: 10,
  spikeRatio: 3,
  spikeFloorUsd: 2,
  minOpenRouterRemainingUsd: 5,
  requireOpenRouterLimit: true,
};

function numberFromEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function spendThresholdsFromEnv(env: Env): SpendThresholds {
  const d = DEFAULT_SPEND_THRESHOLDS;
  const requireRaw = env.CANARY_REQUIRE_OPENROUTER_LIMIT?.trim();
  return {
    maxDailyUsd: numberFromEnv(env, "CANARY_MAX_DAILY_USD", d.maxDailyUsd),
    spikeRatio: numberFromEnv(env, "CANARY_SPIKE_RATIO", d.spikeRatio),
    spikeFloorUsd: numberFromEnv(env, "CANARY_SPIKE_FLOOR_USD", d.spikeFloorUsd),
    minOpenRouterRemainingUsd: numberFromEnv(env, "CANARY_MIN_OPENROUTER_USD", d.minOpenRouterRemainingUsd),
    requireOpenRouterLimit: requireRaw ? requireRaw !== "0" && requireRaw.toLowerCase() !== "false" : d.requireOpenRouterLimit,
  };
}

export function latencyFromEnv(env: Env, fn: CanaryFunction): number {
  const name = `CANARY_LATENCY_${fn.toUpperCase().replace(/-/g, "_")}_MS`;
  return numberFromEnv(env, name, DEFAULT_LATENCY_MS[fn]) || DEFAULT_LATENCY_MS[fn];
}

// ── Golden inputs ────────────────────────────────────────────────────────────

export interface GoldenRow {
  id: string;
  prompt: string;
  good: string;
}

/**
 * The golden row each dialect's checks are built from: "ask where the learner
 * is going right now", whose MSA trap (الآن) every model falls into first.
 * Fixed, so a red run is never a different input from yesterday's green one.
 */
export const CANARY_GOLDEN_IDS: Record<CanaryDialect, string> = {
  Gulf: "gulf-002",
  Egyptian: "egy-002",
  Yemeni: "yem-002",
};

export const GOLDEN_FILES: Record<CanaryDialect, string> = {
  Gulf: "gulf.jsonl",
  Egyptian: "egyptian.jsonl",
  Yemeni: "yemeni.jsonl",
};

export function parseGolden(jsonl: string): GoldenRow[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as GoldenRow);
}

export function pickGolden(rows: GoldenRow[], dialect: CanaryDialect): GoldenRow {
  const id = CANARY_GOLDEN_IDS[dialect];
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`golden row ${id} not found for ${dialect}`);
  return row;
}

// ── The checks ───────────────────────────────────────────────────────────────

export type CanaryFunction =
  | "translate-text"
  | "culture-guide"
  | "writing-coach"
  | "reading-passage"
  | "souq-news"
  | "assistant-chat";

export const CANARY_FUNCTIONS: readonly CanaryFunction[] = [
  "translate-text",
  "culture-guide",
  "writing-coach",
  "reading-passage",
  "souq-news",
  "assistant-chat",
];

/** What a function said, reduced to what the assertions need. */
export interface Extracted {
  /** Everything a learner would read. Empty means "nothing came back". */
  text: string;
  /** The dialect Arabic the function wrote, for the MSA check. */
  arabic: string;
  /** Something odd worth printing that is not a failure. */
  warnings?: string[];
}

export interface CanaryCase {
  id: string;
  fn: CanaryFunction;
  dialect: CanaryDialect;
  body: Record<string, unknown>;
  stream: boolean;
  maxLatencyMs: number;
}

/**
 * Texts the functions send with a 200 when they have nothing to say. A 2xx
 * carrying one of these is a failure: it is exactly the "page sat there and
 * said nothing useful" the sweep kept finding.
 */
export const CANNED_EMPTY_ANSWERS = [
  "I couldn't come up with an answer for that. Try asking it another way.",
  "I can't help with that one. Try asking about a custom, a greeting or a situation.",
];

/**
 * souq-news is the expensive one: up to three Firecrawl searches and four
 * model rewrites a call. DECISION FOR DANIEL: it runs for one dialect a day,
 * rotating, rather than all three, to keep Firecrawl credits for learners.
 * CANARY_SOUQ_ALL_DIALECTS=1 runs all three.
 */
export function souqDialectFor(nowMs: number): CanaryDialect {
  const day = Math.floor(nowMs / 86_400_000);
  return CANARY_DIALECTS[day % CANARY_DIALECTS.length];
}

export function buildCases(
  golden: Record<CanaryDialect, GoldenRow>,
  opts: { nowMs: number; env?: Env; only?: CanaryFunction[] },
): CanaryCase[] {
  const env = opts.env ?? {};
  const souqAll = env.CANARY_SOUQ_ALL_DIALECTS === "1";
  const souqDialect = souqDialectFor(opts.nowMs);
  const cases: CanaryCase[] = [];

  for (const fn of CANARY_FUNCTIONS) {
    if (opts.only && opts.only.length > 0 && !opts.only.includes(fn)) continue;
    for (const dialect of CANARY_DIALECTS) {
      if (fn === "souq-news" && !souqAll && dialect !== souqDialect) continue;
      const row = golden[dialect];
      cases.push({
        id: `${fn}/${dialect}`,
        fn,
        dialect,
        body: requestBody(fn, dialect, row),
        stream: fn === "culture-guide" || fn === "assistant-chat",
        maxLatencyMs: latencyFromEnv(env, fn),
      });
    }
  }
  return cases;
}

function requestBody(fn: CanaryFunction, dialect: CanaryDialect, row: GoldenRow): Record<string, unknown> {
  switch (fn) {
    case "translate-text":
      // A native line in; the function must hand the same Arabic back with English.
      return { text: row.good, dialect };
    case "culture-guide":
      return {
        dialect,
        messages: [
          {
            role: "user",
            content: `How would a local say this in ${dialect} Arabic: "${row.prompt}" Give the phrase and one line on when to use it.`,
          },
        ],
      };
    case "writing-coach":
      // `prompt`, not `review`: one model call, nothing written to the account,
      // and the answer is a dialect message, which is what the MSA check wants.
      return { action: "prompt", dialect };
    case "reading-passage":
      return {
        difficulty: "beginner",
        dialect,
        topic: `An everyday scene built around this moment: ${row.prompt}`,
      };
    case "souq-news":
      return { dialect };
    case "assistant-chat":
      return {
        dialect,
        seed: { arabic: row.good },
        messages: [
          {
            role: "user",
            content: "What does this sentence mean? Go word by word, briefly. No need to compare it with Modern Standard Arabic.",
          },
        ],
      };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const join = (parts: unknown[]): string => parts.map(str).filter(Boolean).join("\n");
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Pull the learner-visible text and the dialect Arabic out of a function's answer. */
export function extractOutput(fn: CanaryFunction, dialect: CanaryDialect, payload: unknown): Extracted {
  if (typeof payload === "string") {
    // The two streaming functions: the assembled reply.
    return { text: payload.trim(), arabic: payload };
  }
  const body = asRecord(payload);
  switch (fn) {
    case "translate-text": {
      const sentences = asArray(body.sentences).map(asRecord);
      const warnings: string[] = [];
      if (sentences.length && str(body.detected_dialect) && body.detected_dialect !== dialect) {
        warnings.push(`detected ${str(body.detected_dialect)}, sent ${dialect}`);
      }
      return {
        text: join(sentences.map((s) => s.natural)),
        arabic: join(sentences.map((s) => s.arabic)),
        warnings,
      };
    }
    case "writing-coach": {
      const p = asRecord(body.prompt);
      return {
        text: join([p.message_arabic, p.message_english, p.scenario_english]),
        arabic: str(p.message_arabic),
      };
    }
    case "reading-passage": {
      const p = asRecord(body.passage);
      const lines = asArray(p.lines).map(asRecord);
      return {
        text: join(lines.map((l) => l.arabic)),
        arabic: join([p.title, ...lines.map((l) => l.arabic)]),
      };
    }
    case "souq-news": {
      const articles = asArray(body.articles).map(asRecord);
      return {
        text: join(articles.map((a) => a.body_dialect ?? a.title_dialect)),
        arabic: join(articles.flatMap((a) => [a.title_dialect, a.body_dialect])),
      };
    }
    default:
      return { text: "", arabic: "" };
  }
}

/**
 * Read an OpenAI-shaped SSE body and return the answer's text.
 *
 * `[DONE]` is where the answer is complete, and `onDone` fires there: that is
 * what a learner waits for, so it is what latency measures. Reading carries on
 * to the end of the stream regardless, as the app's own client does.
 * assistant-chat appends a native-speaker review after `[DONE]` and does its
 * usage logging and memory update when the stream finishes; hanging up at
 * `[DONE]` would skip those, so the canary's own spend would go unlogged.
 * Throws on an `error` frame before `[DONE]`; after it, nothing can fail the answer.
 */
export async function readSse(body: ReadableStream<Uint8Array>, onDone?: () => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let complete = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (complete) return text;
        throw e;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data:") || complete) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          complete = true;
          onDone?.();
          continue;
        }
        let frame: { error?: { message?: string }; choices?: Array<{ delta?: { content?: string } }> };
        try {
          frame = JSON.parse(data);
        } catch {
          continue;
        }
        if (frame?.error) throw new Error(`stream error frame: ${frame.error.message ?? "unknown"}`);
        const delta = frame?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      }
    }
    return text;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export interface CaseResult {
  id: string;
  fn: CanaryFunction;
  dialect: CanaryDialect;
  ok: boolean;
  status: number;
  latencyMs: number;
  failures: string[];
  warnings: string[];
  /** The first part of what came back, printed only when the check failed. */
  excerpt: string;
}

export interface RunContext {
  fetch: FetchLike;
  now: () => number;
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
}

/** Call one function and judge the answer. Never throws. */
export async function runCase(c: CanaryCase, ctx: RunContext): Promise<CaseResult> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const started = ctx.now();
  let status = 0;
  let excerpt = "";
  let extracted: Extracted = { text: "", arabic: "" };
  // For a stream, when `[DONE]` arrived; for JSON, when the body was read.
  let answeredAt: number | null = null;

  // Twice the threshold before giving up, so a slow answer is reported as
  // slow (with its real latency) rather than as a timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.maxLatencyMs * 2);

  try {
    const res = await ctx.fetch(`${ctx.supabaseUrl}/functions/v1/${c.fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ctx.anonKey,
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify(c.body),
      signal: controller.signal,
    });
    status = res.status;
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      excerpt = raw.slice(0, 300);
      failures.push(`HTTP ${res.status}`);
    } else if (c.stream && res.body && (res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const reply = await readSse(res.body, () => {
        answeredAt = ctx.now();
      });
      extracted = extractOutput(c.fn, c.dialect, reply);
    } else {
      const payload: unknown = await res.json();
      answeredAt = ctx.now();
      extracted = extractOutput(c.fn, c.dialect, payload);
      if (!extracted.text) excerpt = JSON.stringify(payload).slice(0, 300);
    }
  } catch (e) {
    const aborted = controller.signal.aborted;
    failures.push(aborted ? `no answer within ${Math.round((c.maxLatencyMs * 2) / 1000)}s` : `request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = (answeredAt ?? ctx.now()) - started;

  if (status >= 200 && status < 300 && failures.length === 0) {
    const text = extracted.text.trim();
    if (!text) {
      failures.push("empty answer");
    } else if (CANNED_EMPTY_ANSWERS.some((canned) => text === canned || text.startsWith(canned))) {
      failures.push("canned no-answer text");
    }
    if (!excerpt) excerpt = text.slice(0, 300);
    const { leaks } = detectMsaLeaks(extracted.arabic, c.dialect);
    if (leaks.length > 0) failures.push(`MSA leak: ${leaks.join(", ")}`);
    warnings.push(...(extracted.warnings ?? []));
  }

  if (latencyMs > c.maxLatencyMs) {
    failures.push(`latency ${(latencyMs / 1000).toFixed(1)}s over ${(c.maxLatencyMs / 1000).toFixed(0)}s`);
  }

  return { id: c.id, fn: c.fn, dialect: c.dialect, ok: failures.length === 0, status, latencyMs, failures, warnings, excerpt };
}

/** Run cases a few at a time; results come back in case order. */
export async function runCases(cases: CanaryCase[], ctx: RunContext, concurrency = 3): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i], ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return results;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

/**
 * Password sign-in for the canary account, straight against GoTrue. The
 * error names the status only: GoTrue's body is safe, but nothing here should
 * ever be able to print the credentials it was given.
 */
export async function signIn(
  fetchFn: FetchLike,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetchFn(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`canary sign-in failed (HTTP ${res.status}). Check the account exists, is confirmed, and the secrets match.`);
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("canary sign-in returned no access token");
  }
  return body.access_token;
}

// ── Spend ────────────────────────────────────────────────────────────────────

export interface SpendReport {
  llm: {
    last_24h_usd: number;
    previous_7d_usd: number;
    costed_rows_24h: number;
    uncosted_rows_24h: number | null;
    truncated: boolean;
  };
  openrouter: {
    configured: boolean;
    ok: boolean;
    status?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    usage_daily?: number | null;
  };
}

export type SpendFetch =
  | { ok: true; report: SpendReport }
  | { ok: false; failure: string };

export async function fetchSpend(
  fetchFn: FetchLike,
  supabaseUrl: string,
  anonKey: string,
  canarySecret: string,
): Promise<SpendFetch> {
  let res: Response;
  try {
    res = await fetchFn(`${supabaseUrl}/functions/v1/ai-canary-spend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "x-canary-secret": canarySecret,
      },
      body: "{}",
    });
  } catch (e) {
    return { ok: false, failure: `spend check unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return { ok: false, failure: "spend check: ai-canary-spend is not deployed (404)" };
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    return {
      ok: false,
      failure: `spend check refused (HTTP ${res.status}): AI_CANARY_SECRET in Supabase and HIKAYA_AI_CANARY_SECRET in GitHub must be set and equal`,
    };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, failure: `spend check failed (HTTP ${res.status})` };
  }
  const body = (await res.json()) as Partial<SpendReport>;
  if (!body?.llm || !body?.openrouter) return { ok: false, failure: "spend check returned an unexpected body" };
  return { ok: true, report: body as SpendReport };
}

export interface SpendVerdict {
  ok: boolean;
  failures: string[];
  notes: string[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Judge the totals. Messages name thresholds, never the measured amounts,
 * unless `printAmounts` is set: the repository is public, and so are its
 * Actions logs.
 */
export function judgeSpend(report: SpendReport, t: SpendThresholds, printAmounts = false): SpendVerdict {
  const failures: string[] = [];
  const notes: string[] = [];
  const { llm, openrouter } = report;
  const amt = (n: number) => (printAmounts ? ` (${usd(n)})` : "");

  if (llm.last_24h_usd > t.maxDailyUsd) {
    failures.push(`LLM spend in the last 24h${amt(llm.last_24h_usd)} is over the ${usd(t.maxDailyUsd)} daily ceiling`);
  }
  const dailyMean = llm.previous_7d_usd / 7;
  if (llm.last_24h_usd > t.spikeFloorUsd && llm.last_24h_usd > t.spikeRatio * dailyMean) {
    failures.push(
      `LLM spend spike: the last 24h${amt(llm.last_24h_usd)} is more than ${t.spikeRatio}x the trailing 7-day daily mean${amt(dailyMean)}`,
    );
  }
  if (llm.truncated) notes.push("llm_usage_logs total was truncated at the page limit; the real total is higher");
  if (llm.uncosted_rows_24h !== null && llm.uncosted_rows_24h > llm.costed_rows_24h) {
    notes.push("more usage rows in the last 24h have no cost than have one; the total understates spend");
  }

  if (!openrouter.configured) {
    failures.push("OpenRouter: OPENROUTER_API_KEY is not set on the functions");
  } else if (!openrouter.ok) {
    failures.push(`OpenRouter key-info read failed${openrouter.status ? ` (HTTP ${openrouter.status})` : ""}`);
  } else if (openrouter.limit === null || openrouter.limit === undefined) {
    if (t.requireOpenRouterLimit) failures.push("OpenRouter key has no credit limit set; set a per-key limit");
    else notes.push("OpenRouter key has no credit limit set");
  } else if (typeof openrouter.limit_remaining === "number" && openrouter.limit_remaining < t.minOpenRouterRemainingUsd) {
    failures.push(
      `OpenRouter key has less than ${usd(t.minOpenRouterRemainingUsd)} left of its limit${amt(openrouter.limit_remaining)}`,
    );
  }

  return { ok: failures.length === 0, failures, notes };
}

// ── Report ───────────────────────────────────────────────────────────────────

export function formatCaseLine(r: CaseResult): string {
  const head = `${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(26)} ${String(r.status).padStart(3)}  ${(r.latencyMs / 1000).toFixed(1).padStart(6)}s`;
  const tail = r.ok ? (r.warnings.length ? `  (${r.warnings.join("; ")})` : "") : `  ${r.failures.join("; ")}`;
  return head + tail;
}
