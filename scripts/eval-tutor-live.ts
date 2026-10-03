#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
/**
 * Tutor-behaviour eval (build plan L2): ask the deployed Ask AI tutor the
 * cases in supabase/functions/_test/eval/tutor/cases.jsonl, score each reply,
 * log it, and rate it by hand.
 *
 * The sibling of eval-dialect-live.ts. That one measures whether a model
 * writes dialect; this one measures whether the tutor *behaves* — focused
 * line, dialect, naming errors, English and Arabizi input, scope, planted
 * instructions, requests for Fusha. It calls `assistant-chat` over HTTP as a
 * signed-in learner, so it exercises the real prompt, page context, retrieval
 * and tools. It is a local, manual tool like its sibling: it needs a real
 * account and costs a few cents a run, so it is not a CI gate. The offline
 * half (`--validate`) is, through supabase/functions/_test/eval_tutor_test.ts.
 *
 *   --validate                 Check the case file offline. No network, no credentials.
 *   (no mode)                  Run the cases. [--dialect Gulf] [--category names_error]
 *                              [--id tutor-gulf-01,tutor-egy-04] [--limit N]
 *   --rate [--run RUN_ID]      Rate a run's replies up or down with a note (latest run by default).
 *   --rate-one RUN_ID CASE_ID up|down [note...]
 *   --down                     List down-rated replies: the queue for prompt fixes and golden rows.
 *   --summary [--run RUN_ID]   Pass rates, median latency and cost for a past run.
 *
 * Credentials, exported in your own shell (never pasted anywhere):
 *   HIKAYA_SUPABASE_ANON_KEY, and HIKAYA_EVAL_EMAIL / HIKAYA_EVAL_PASSWORD
 *   (falls back to the AI canary's HIKAYA_CANARY_EMAIL / _PASSWORD).
 *   HIKAYA_SUPABASE_URL overrides the project in supabase/config.toml, e.g. to
 *   point at `supabase functions serve` on 127.0.0.1:54321.
 *
 *   deno run --allow-env --allow-read --allow-write --allow-net scripts/eval-tutor-live.ts --dialect Yemeni
 */
import {
  downRated,
  evalCredentials,
  makeRating,
  parseJsonl,
  type RatingRecord,
  type RunRecord,
  runIdFor,
  runTutorCase,
  signIn,
  summarize,
  supabaseUrlFromConfig,
  type TutorCase,
  unrated,
  validateCases,
} from "./eval-tutor-core.ts";

const args = Deno.args;
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const has = (name: string) => args.includes(`--${name}`);

const root = new URL("../", import.meta.url);
const DIR = new URL("supabase/functions/_test/eval/tutor/", root);
const CASES = new URL("cases.jsonl", DIR);
const RUNS = new URL("runs.jsonl", DIR);
const RATINGS = new URL("ratings.jsonl", DIR);

const readIf = (url: URL): string => {
  try {
    return Deno.readTextFileSync(url);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
};
const append = (url: URL, rows: unknown[]) => {
  if (rows.length) Deno.writeTextFileSync(url, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { append: true });
};

function loadCases(): TutorCase[] {
  const { cases, errors } = validateCases(Deno.readTextFileSync(CASES));
  if (errors.length) {
    console.error(`cases.jsonl has ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    Deno.exit(1);
  }
  return cases;
}

const latestRunId = (runs: RunRecord[]): string | null => runs.length ? runs[runs.length - 1].run_id : null;

function printSummary(records: RunRecord[]) {
  const s = summarize(records);
  console.log(`\n${s.passed}/${s.cases} passed the automatic checks.`);
  const rows = (o: Record<string, { cases: number; passed: number }>) =>
    Object.entries(o).map(([k, v]) => `  ${k.padEnd(18)} ${v.passed}/${v.cases}`).join("\n");
  console.log(`By category:\n${rows(s.byCategory)}`);
  console.log(`By dialect:\n${rows(s.byDialect)}`);
  if (s.medianLatencyMs !== null) console.log(`Median latency: ${(s.medianLatencyMs / 1000).toFixed(1)}s`);
  console.log(
    s.costedCases
      ? `Answer cost: $${s.costUsd.toFixed(4)} over ${s.costedCases} of ${s.cases} replies that reported one ` +
        `(the answer only; routing, retrieval, review and memory calls are not in it).`
      : "No reply reported a cost (served by a provider that does not stream one).",
  );
}

// ── --validate ───────────────────────────────────────────────────────────────
if (has("validate")) {
  const { cases, errors } = validateCases(Deno.readTextFileSync(CASES));
  if (errors.length) {
    console.error(`cases.jsonl: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  ${e}`);
    Deno.exit(1);
  }
  console.log(`cases.jsonl: ${cases.length} cases, valid.`);
  Deno.exit(0);
}

// ── --rate-one ───────────────────────────────────────────────────────────────
if (has("rate-one")) {
  const i = args.indexOf("--rate-one");
  const [runId, caseId, rating, ...noteParts] = args.slice(i + 1);
  if (!runId || !caseId || !rating) {
    console.error("Usage: --rate-one RUN_ID CASE_ID up|down [note...]");
    Deno.exit(2);
  }
  const runs = parseJsonl<RunRecord>(readIf(RUNS));
  if (!runs.some((r) => r.run_id === runId && r.case_id === caseId)) {
    console.error(`No reply for ${caseId} in run ${runId}.`);
    Deno.exit(1);
  }
  try {
    append(RATINGS, [makeRating(runId, caseId, rating, noteParts.join(" "), Date.now())]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(2);
  }
  console.log(`Rated ${caseId} in ${runId}: ${rating}.`);
  Deno.exit(0);
}

// ── --rate ───────────────────────────────────────────────────────────────────
if (has("rate")) {
  const runs = parseJsonl<RunRecord>(readIf(RUNS));
  const runId = opt("run") ?? latestRunId(runs);
  if (!runId) {
    console.error("No runs to rate yet.");
    Deno.exit(1);
  }
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const todo = unrated(runs, parseJsonl<RatingRecord>(readIf(RATINGS)), runId);
  console.log(`Run ${runId}: ${todo.length} reply(ies) to rate. u = up, d = down (needs a note), s = skip, q = quit.\n`);
  for (const r of todo) {
    const c = cases.get(r.case_id);
    console.log("─".repeat(72));
    console.log(`${r.case_id}  [${r.category}, ${r.dialect}]  auto: ${r.auto.pass ? "pass" : `FAIL — ${r.auto.failures.join("; ")}`}`);
    if (c) {
      console.log(`Learner: ${c.messages[c.messages.length - 1].content}`);
      console.log(`Why: ${c.note}`);
    }
    console.log(`\n${r.reply}\n`);
    const answer = (prompt("Rating (u/d/s/q) and an optional note:") ?? "").trim();
    const [key, ...rest] = answer.split(/\s+/);
    if (key === "q") break;
    if (key !== "u" && key !== "d") continue;
    let note = rest.join(" ");
    if (key === "d" && !note) note = (prompt("What was wrong?") ?? "").trim();
    try {
      append(RATINGS, [makeRating(runId, r.case_id, key === "u" ? "up" : "down", note, Date.now())]);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  }
  Deno.exit(0);
}

// ── --down ───────────────────────────────────────────────────────────────────
if (has("down")) {
  const rows = downRated(parseJsonl<RunRecord>(readIf(RUNS)), parseJsonl<RatingRecord>(readIf(RATINGS)));
  if (!rows.length) console.log("Nothing rated down.");
  for (const { run, rating } of rows) {
    console.log(`${run.case_id}  ${run.run_id}  [${run.category}, ${run.dialect}]`);
    console.log(`  note: ${rating.note}`);
    console.log(`  reply: ${run.reply.replace(/\s+/g, " ").slice(0, 300)}\n`);
  }
  Deno.exit(0);
}

// ── --summary ────────────────────────────────────────────────────────────────
if (has("summary")) {
  const runs = parseJsonl<RunRecord>(readIf(RUNS));
  const runId = opt("run") ?? latestRunId(runs);
  if (!runId) {
    console.error("No runs yet.");
    Deno.exit(1);
  }
  console.log(`Run ${runId}`);
  printSummary(runs.filter((r) => r.run_id === runId));
  Deno.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const env = Deno.env.toObject();
const creds = evalCredentials(env);
if (!creds.ok) {
  console.error(`eval not configured: missing ${creds.missing.join(", ")}`);
  Deno.exit(1);
}
if (creds.shared) {
  console.error(
    "Using the AI canary's account. The tutor keeps notes on each learner between chats, so the two " +
      "share a memory; set HIKAYA_EVAL_EMAIL / HIKAYA_EVAL_PASSWORD for a clean one.",
  );
}
const supabaseUrl =
  env.HIKAYA_SUPABASE_URL?.trim() || supabaseUrlFromConfig(Deno.readTextFileSync(new URL("supabase/config.toml", root)));
if (!supabaseUrl) {
  console.error("No project_id in supabase/config.toml and no HIKAYA_SUPABASE_URL.");
  Deno.exit(1);
}

let cases = loadCases();
const dialect = opt("dialect");
const category = opt("category");
const ids = opt("id")?.split(",").map((s) => s.trim()).filter(Boolean);
if (dialect) cases = cases.filter((c) => c.dialect === dialect);
if (category) cases = cases.filter((c) => c.category === category);
if (ids?.length) cases = cases.filter((c) => ids.includes(c.id));
const limit = Number(opt("limit")) || Infinity;
cases = cases.slice(0, limit);
if (!cases.length) {
  console.error("No cases match those filters.");
  Deno.exit(2);
}

const accessToken = await signIn(fetch, supabaseUrl, creds.anonKey, creds.email, creds.password);
const runId = runIdFor(Date.now());
console.log(`Run ${runId}: ${cases.length} case(s) against ${new URL(supabaseUrl).host}\n`);

const records: RunRecord[] = [];
for (const c of cases) {
  // One at a time: the cases are a conversation's first turn each, and the
  // tutor's per-learner memory is written after every answer. Parallel turns
  // would race on it.
  const r = await runTutorCase(c, { fetch, now: () => Date.now(), supabaseUrl, anonKey: creds.anonKey, accessToken, runId });
  records.push(r);
  append(RUNS, [r]);
  console.log(
    `${r.auto.pass ? "pass" : "FAIL"}  ${r.case_id.padEnd(15)} ${String(r.status).padStart(3)} ` +
      `${(r.latency_ms / 1000).toFixed(1).padStart(5)}s` +
      `${r.cost_usd !== null ? `  $${r.cost_usd.toFixed(4)}` : ""}` +
      `${r.auto.pass ? "" : `  ${r.auto.failures.join("; ")}`}`,
  );
}

printSummary(records);
console.log(`\nAppended to supabase/functions/_test/eval/tutor/runs.jsonl. Rate it: --rate --run ${runId}`);
