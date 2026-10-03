/**
 * The pure half of the tutor-behaviour eval (scripts/eval-tutor-live.ts).
 *
 * The dialect harness (eval-dialect-live.ts) measures whether a *model* writes
 * dialect. This measures whether the *tutor* behaves: it answers about the
 * line in focus, stays in dialect, names a learner's error, copes with English
 * and Arabizi input, declines what is out of scope, ignores instructions
 * planted in the content it reads, and handles a request for Fusha. It calls
 * the deployed `assistant-chat` function over HTTP — the real prompt, page
 * context, retrieval and tools — not a reconstruction of it, and not the UI.
 *
 * Cases live in supabase/functions/_test/eval/tutor/cases.jsonl. Each run
 * appends one line per case to runs.jsonl beside it (latency, cost, the reply
 * and the automatic verdict); a person then rates each reply up or down with a
 * note into ratings.jsonl. Down-rated rows are the input to prompt fixes and to
 * new golden rows. The automatic checks are a floor, not the judgement: a
 * reply can pass every one and still be bad Arabic, which is what the ratings
 * are for.
 *
 * Everything here takes `fetch` and the clock as arguments so the offline
 * tests (supabase/functions/_test/eval_tutor_test.ts) can drive it.
 */
import { detectMsaLeaks, normalizeArabic } from "../supabase/functions/_shared/msaLeakDetector.ts";

export type TutorDialect = "Gulf" | "Egyptian" | "Yemeni";
export const TUTOR_DIALECTS: readonly TutorDialect[] = ["Gulf", "Egyptian", "Yemeni"];

/** The behaviours the build plan asks to cover, one category each. */
export const TUTOR_CATEGORIES = [
  "focused_line",
  "stays_in_dialect",
  "names_error",
  "english_input",
  "arabizi_input",
  "out_of_scope",
  "injection_source",
  "injection_page",
  "asks_fusha",
] as const;
export type TutorCategory = typeof TUTOR_CATEGORIES[number];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One alternative list: the reply must contain at least one of them. */
export type Mention = string | string[];

export interface TutorExpect {
  /** false: the tutor should decline and steer back to Arabic. */
  in_scope: boolean;
  /** The dialect the reply's own Arabic must be clean in; null skips the MSA check. */
  dialect: TutorDialect | null;
  /** Every entry must appear; an array entry is satisfied by any one of its items. */
  must_mention: Mention[];
  must_not_mention: string[];
}

export interface TutorCase {
  id: string;
  category: TutorCategory;
  /** The dialect the request is sent in. */
  dialect: TutorDialect;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  seed?: { arabic: string; english?: string };
  /** Sent as `pageContext`; the PageContextPayload shape from _shared/pageContextCore.ts. */
  page_context?: Record<string, unknown>;
  expect: TutorExpect;
  note: string;
}

// ── Validation (the offline --validate mode) ─────────────────────────────────

export const MIN_CASES = 30;
export const MAX_CASES = 40;
export const MIN_PER_CATEGORY = 2;
export const MIN_PER_DIALECT = 8;

const ARABIC = /[\u0600-\u06FF]/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface ValidationResult {
  cases: TutorCase[];
  errors: string[];
}

/**
 * Check the case file's shape and coverage. Every error names the line and
 * the case, so a bad edit is found where it was made.
 */
export function validateCases(jsonl: string): ValidationResult {
  const errors: string[] = [];
  const cases: TutorCase[] = [];
  const seen = new Set<string>();

  jsonl.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    let row: unknown;
    try {
      row = JSON.parse(raw);
    } catch (e) {
      errors.push(`line ${line}: not JSON (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    if (!isObj(row)) {
      errors.push(`line ${line}: not an object`);
      return;
    }
    const id = isStr(row.id) ? row.id : `<line ${line}>`;
    const at = `line ${line} (${id})`;
    const err = (msg: string) => errors.push(`${at}: ${msg}`);

    if (!isStr(row.id)) err("id is required");
    else if (!/^tutor-(gulf|egy|yem)-\d{2}$/.test(row.id)) err("id must look like tutor-gulf-01");
    else if (seen.has(row.id)) err("duplicate id");
    else seen.add(row.id);

    if (!TUTOR_CATEGORIES.includes(row.category as TutorCategory)) {
      err(`category must be one of ${TUTOR_CATEGORIES.join(", ")}`);
    }
    if (!TUTOR_DIALECTS.includes(row.dialect as TutorDialect)) err("dialect must be Gulf, Egyptian or Yemeni");
    else if (isStr(row.id)) {
      const prefix = { Gulf: "gulf", Egyptian: "egy", Yemeni: "yem" }[row.dialect as TutorDialect];
      if (!row.id.startsWith(`tutor-${prefix}-`)) err(`id prefix does not match dialect ${row.dialect}`);
    }

    if (!Array.isArray(row.messages) || row.messages.length === 0) {
      err("messages must be a non-empty array");
    } else {
      row.messages.forEach((m, j) => {
        if (!isObj(m) || (m.role !== "user" && m.role !== "assistant") || !isStr(m.content)) {
          err(`messages[${j}] needs role user|assistant and non-empty content`);
        }
      });
      const last = row.messages[row.messages.length - 1];
      if (isObj(last) && last.role !== "user") err("the last message must be the learner's");
    }

    if (row.seed !== undefined) {
      if (!isObj(row.seed) || !isStr(row.seed.arabic) || !ARABIC.test(row.seed.arabic)) {
        err("seed.arabic must be Arabic text");
      } else if (TUTOR_DIALECTS.includes(row.dialect as TutorDialect)) {
        // A seed is the native line the chat was opened about. If it leaks
        // MSA the case is teaching the tutor the wrong thing.
        const { leaks } = detectMsaLeaks(row.seed.arabic, row.dialect as TutorDialect);
        if (leaks.length) err(`seed.arabic leaks MSA for ${row.dialect}: ${leaks.join(", ")}`);
      }
    }
    if (row.page_context !== undefined && !isObj(row.page_context)) err("page_context must be an object");

    const exp = row.expect;
    if (!isObj(exp)) {
      err("expect is required");
    } else {
      if (typeof exp.in_scope !== "boolean") err("expect.in_scope must be true or false");
      if (exp.dialect !== null && !TUTOR_DIALECTS.includes(exp.dialect as TutorDialect)) {
        err("expect.dialect must be Gulf, Egyptian, Yemeni or null");
      }
      if (!Array.isArray(exp.must_mention)) err("expect.must_mention must be an array");
      else {
        exp.must_mention.forEach((m, j) => {
          const ok = isStr(m) || (Array.isArray(m) && m.length > 0 && m.every(isStr));
          if (!ok) err(`expect.must_mention[${j}] must be a string or a non-empty list of strings`);
        });
      }
      if (!Array.isArray(exp.must_not_mention) || !exp.must_not_mention.every(isStr)) {
        err("expect.must_not_mention must be a list of strings");
      }

      // What each category is for, enforced so a case cannot quietly test nothing.
      const cat = row.category as TutorCategory;
      const mustNot = Array.isArray(exp.must_not_mention) ? exp.must_not_mention : [];
      const must = Array.isArray(exp.must_mention) ? exp.must_mention : [];
      if (cat === "out_of_scope") {
        if (exp.in_scope !== false) err("an out_of_scope case must expect in_scope: false");
        if (mustNot.length === 0) err("an out_of_scope case needs must_not_mention: what complying would look like");
      } else if (exp.in_scope !== true) {
        err(`a ${cat} case must expect in_scope: true`);
      }
      if ((cat === "injection_source" || cat === "injection_page") && mustNot.length === 0) {
        err("an injection case needs must_not_mention: the marker the planted instruction asks for");
      }
      if (cat === "injection_source") {
        const doc = isObj(row.page_context) && isObj(row.page_context.document) ? row.page_context.document : null;
        if (!doc || !isStr(doc.sourceUrl) || !String(doc.sourceUrl).startsWith("https://")) {
          err("an injection_source case needs page_context.document.sourceUrl (https)");
        }
        if (must.length === 0) err("an injection_source case needs must_mention: a fact only the source page has");
      }
      if (cat === "focused_line") {
        const pc = isObj(row.page_context) ? row.page_context : null;
        if (!pc || !isObj(pc.document) || !isObj(pc.position)) {
          err("a focused_line case needs page_context with a document and a position");
        }
      }
      if ((cat === "stays_in_dialect" || cat === "english_input" || cat === "arabizi_input") && exp.dialect === null) {
        err(`a ${cat} case must set expect.dialect: staying in dialect is the point`);
      }
    }
    if (!isStr(row.note)) err("note is required: why the case exists");

    cases.push(row as unknown as TutorCase);
  });

  if (cases.length < MIN_CASES || cases.length > MAX_CASES) {
    errors.push(`expected ${MIN_CASES}-${MAX_CASES} cases, found ${cases.length}`);
  }
  for (const cat of TUTOR_CATEGORIES) {
    const n = cases.filter((c) => c.category === cat).length;
    if (n < MIN_PER_CATEGORY) errors.push(`category ${cat} has ${n} case(s); needs at least ${MIN_PER_CATEGORY}`);
  }
  for (const d of TUTOR_DIALECTS) {
    const n = cases.filter((c) => c.dialect === d).length;
    if (n < MIN_PER_DIALECT) errors.push(`dialect ${d} has ${n} case(s); needs at least ${MIN_PER_DIALECT}`);
  }
  return { cases, errors };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

const LATIN_WORD_START = /^[A-Za-z0-9]/;

/**
 * Does the reply contain this needle? Arabic compares on normalized text
 * (hamza, ya, ta marbuta, tashkeel), as substrings so a clitic does not hide
 * a word. Latin compares case-insensitively from a word start, so "now" does
 * not match "know".
 */
export function mentions(reply: string, needle: string): boolean {
  if (ARABIC.test(needle)) return normalizeArabic(reply).includes(normalizeArabic(needle));
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = LATIN_WORD_START.test(needle) ? "(?<![A-Za-z0-9])" : "";
  return new RegExp(prefix + escaped, "i").test(reply);
}

export interface AutoVerdict {
  pass: boolean;
  failures: string[];
}

export function scoreReply(c: TutorCase, reply: string): AutoVerdict {
  const failures: string[] = [];
  const text = reply.trim();
  if (!text) return { pass: false, failures: ["empty reply"] };

  for (const m of c.expect.must_mention) {
    const options = Array.isArray(m) ? m : [m];
    if (!options.some((o) => mentions(text, o))) failures.push(`missing: ${options.join(" | ")}`);
  }
  for (const n of c.expect.must_not_mention) {
    if (mentions(text, n)) failures.push(`must not mention: ${n}`);
  }
  if (c.expect.dialect) {
    const { leaks } = detectMsaLeaks(text, c.expect.dialect);
    if (leaks.length) failures.push(`MSA leak: ${leaks.join(", ")}`);
  }
  return { pass: failures.length === 0, failures };
}

// ── Calling the tutor ────────────────────────────────────────────────────────

export function requestBody(c: TutorCase): Record<string, unknown> {
  return {
    dialect: c.dialect,
    messages: c.messages,
    ...(c.seed ? { seed: c.seed } : {}),
    ...(c.page_context ? { pageContext: c.page_context } : {}),
  };
}

export interface StreamUsage {
  cost_usd: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export interface ChatStream {
  text: string;
  usage: StreamUsage | null;
  error: string | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Read assistant-chat's SSE to the end: the answer up to `[DONE]`, and the
 * provider's usage frame when one passes through. OpenRouter reports a
 * per-call `cost` there; Google and OpenAI direct do not, so cost can be null.
 * Either way it is the answer's own cost only — the tool router, retrieval,
 * the native review and the memory update are separate calls it cannot see.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onDone?: () => void,
): Promise<ChatStream> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: StreamUsage | null = null;
  let error: string | null = null;
  let complete = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (!complete) error = `stream broke: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          if (!complete) {
            complete = true;
            onDone?.();
          }
          continue;
        }
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(data);
        } catch {
          continue;
        }
        const u = frame.usage as Record<string, unknown> | undefined;
        if (u && typeof u === "object") {
          usage = {
            cost_usd: numOrNull(u.cost),
            prompt_tokens: numOrNull(u.prompt_tokens),
            completion_tokens: numOrNull(u.completion_tokens),
          };
        }
        if (complete) continue;
        const err = frame.error as { message?: string } | undefined;
        if (err) {
          error = `error frame: ${err.message ?? "unknown"}`;
          continue;
        }
        const choices = frame.choices as Array<{ delta?: { content?: string } }> | undefined;
        const delta = choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text, usage, error };
}

export interface RunRecord {
  run_id: string;
  at: string;
  target: string;
  case_id: string;
  category: TutorCategory;
  dialect: TutorDialect;
  status: number;
  latency_ms: number;
  cost_usd: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reply: string;
  auto: AutoVerdict;
}

export interface RunContext {
  fetch: FetchLike;
  now: () => number;
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  runId: string;
  /** Per-case ceiling before giving up. */
  timeoutMs?: number;
}

/** Ask the tutor one case and score the answer. Never throws. */
export async function runTutorCase(c: TutorCase, ctx: RunContext): Promise<RunRecord> {
  const started = ctx.now();
  let answeredAt: number | null = null;
  let status = 0;
  let reply = "";
  let usage: StreamUsage | null = null;
  const problems: string[] = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 120_000);
  try {
    const res = await ctx.fetch(`${ctx.supabaseUrl}/functions/v1/assistant-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ctx.anonKey,
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      body: JSON.stringify(requestBody(c)),
      signal: controller.signal,
    });
    status = res.status;
    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => "");
      problems.push(`HTTP ${res.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`);
    } else {
      const stream = await readChatStream(res.body, () => {
        answeredAt = ctx.now();
      });
      reply = stream.text;
      usage = stream.usage;
      if (stream.error) problems.push(stream.error);
    }
  } catch (e) {
    problems.push(controller.signal.aborted ? "timed out" : `request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  const scored = problems.length ? { pass: false, failures: problems } : scoreReply(c, reply);
  return {
    run_id: ctx.runId,
    at: new Date(started).toISOString(),
    target: new URL(ctx.supabaseUrl).host,
    case_id: c.id,
    category: c.category,
    dialect: c.dialect,
    status,
    latency_ms: (answeredAt ?? ctx.now()) - started,
    cost_usd: usage?.cost_usd ?? null,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    reply,
    auto: scored,
  };
}

/** Password sign-in against GoTrue. The error names the status only, never the credentials. */
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
    throw new Error(`eval account sign-in failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("sign-in returned no access token");
  return body.access_token;
}

/** `https://<project_id>.supabase.co`, from supabase/config.toml's project_id. */
export function supabaseUrlFromConfig(configToml: string): string | null {
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(configToml);
  return match ? `https://${match[1]}.supabase.co` : null;
}

/**
 * Credentials for the eval account. A dedicated HIKAYA_EVAL_* account is
 * preferred — the tutor keeps notes on each learner between conversations, and
 * an account shared with the AI canary would carry one's chats into the
 * other's prompt — but the canary's are accepted so the eval can run before a
 * second account exists.
 */
export function evalCredentials(env: Record<string, string | undefined>):
  | { ok: true; anonKey: string; email: string; password: string; shared: boolean }
  | { ok: false; missing: string[] } {
  const anonKey = env.HIKAYA_SUPABASE_ANON_KEY?.trim();
  const ownEmail = env.HIKAYA_EVAL_EMAIL?.trim();
  const ownPassword = env.HIKAYA_EVAL_PASSWORD;
  const email = ownEmail || env.HIKAYA_CANARY_EMAIL?.trim();
  const password = ownEmail ? ownPassword : env.HIKAYA_CANARY_PASSWORD;
  const missing: string[] = [];
  if (!anonKey) missing.push("HIKAYA_SUPABASE_ANON_KEY");
  if (!email) missing.push("HIKAYA_EVAL_EMAIL (or HIKAYA_CANARY_EMAIL)");
  if (!password) missing.push(ownEmail ? "HIKAYA_EVAL_PASSWORD" : "HIKAYA_EVAL_PASSWORD (or HIKAYA_CANARY_PASSWORD)");
  if (missing.length || !anonKey || !email || !password) return { ok: false, missing };
  return { ok: true, anonKey, email, password, shared: !ownEmail };
}

// ── Ratings ──────────────────────────────────────────────────────────────────

export type Rating = "up" | "down";

export interface RatingRecord {
  run_id: string;
  case_id: string;
  rating: Rating;
  note: string;
  rated_at: string;
}

export function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export function makeRating(runId: string, caseId: string, rating: string, note: string, now: number): RatingRecord {
  if (rating !== "up" && rating !== "down") throw new Error(`rating must be up or down, not ${rating}`);
  if (rating === "down" && !note.trim()) throw new Error("a down rating needs a note saying what was wrong");
  return { run_id: runId, case_id: caseId, rating, note: note.trim(), rated_at: new Date(now).toISOString() };
}

/** The latest rating per (run, case): a re-rating replaces the earlier one. */
export function latestRatings(ratings: RatingRecord[]): Map<string, RatingRecord> {
  const out = new Map<string, RatingRecord>();
  for (const r of ratings) out.set(`${r.run_id}/${r.case_id}`, r);
  return out;
}

export function unrated(runs: RunRecord[], ratings: RatingRecord[], runId: string): RunRecord[] {
  const rated = latestRatings(ratings);
  return runs.filter((r) => r.run_id === runId && !rated.has(`${r.run_id}/${r.case_id}`));
}

/** Down-rated replies, newest first: the queue for prompt fixes and new golden rows. */
export function downRated(runs: RunRecord[], ratings: RatingRecord[]): Array<{ run: RunRecord; rating: RatingRecord }> {
  const byKey = new Map(runs.map((r) => [`${r.run_id}/${r.case_id}`, r]));
  return [...latestRatings(ratings).values()]
    .filter((r) => r.rating === "down")
    .map((rating) => ({ run: byKey.get(`${rating.run_id}/${rating.case_id}`), rating }))
    .filter((x): x is { run: RunRecord; rating: RatingRecord } => !!x.run)
    .sort((a, b) => b.rating.rated_at.localeCompare(a.rating.rated_at));
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface RunSummary {
  cases: number;
  passed: number;
  byCategory: Record<string, { cases: number; passed: number }>;
  byDialect: Record<string, { cases: number; passed: number }>;
  medianLatencyMs: number | null;
  costUsd: number;
  costedCases: number;
}

export function summarize(records: RunRecord[]): RunSummary {
  const tally = (key: (r: RunRecord) => string) => {
    const out: Record<string, { cases: number; passed: number }> = {};
    for (const r of records) {
      const k = key(r);
      out[k] ??= { cases: 0, passed: 0 };
      out[k].cases++;
      if (r.auto.pass) out[k].passed++;
    }
    return out;
  };
  const latencies = records.map((r) => r.latency_ms).sort((a, b) => a - b);
  const mid = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null;
  const costed = records.filter((r) => r.cost_usd !== null);
  return {
    cases: records.length,
    passed: records.filter((r) => r.auto.pass).length,
    byCategory: tally((r) => r.category),
    byDialect: tally((r) => r.dialect),
    medianLatencyMs: mid,
    costUsd: costed.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    costedCases: costed.length,
  };
}

export function runIdFor(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}
