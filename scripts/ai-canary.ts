#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * Daily AI canary: are the learner-facing AI features answering, in dialect,
 * in reasonable time, and is spend where it should be?
 *
 * Run by .github/workflows/ai-canary.yml every morning and on demand. Exits 1
 * on any failure, so a red run is GitHub's failure email; exits 1 too when it
 * is not configured, naming the missing secrets, because a canary that skips
 * quietly is the failure it exists to catch.
 *
 * Usage:
 *   HIKAYA_SUPABASE_ANON_KEY=... HIKAYA_CANARY_EMAIL=... HIKAYA_CANARY_PASSWORD=... \
 *   HIKAYA_AI_CANARY_SECRET=... \
 *     deno run --allow-env --allow-read --allow-net scripts/ai-canary.ts [--only translate-text,souq-news]
 *
 * Each run costs a few cents of model calls (about 16 of them) and one
 * Firecrawl search set. It signs in as a dedicated canary account marked
 * subscriber, so it never touches a learner's daily cap.
 *
 * All the deciding is in ai-canary-core.ts, which the Vitest suite covers
 * (src/test/aiCanary.test.ts). This file reads the environment and prints.
 */
import {
  buildCases,
  CANARY_DIALECTS,
  CANARY_FUNCTIONS,
  type CanaryDialect,
  type CanaryFunction,
  type CaseResult,
  fetchSpend,
  formatCaseLine,
  GOLDEN_FILES,
  type GoldenRow,
  judgeSpend,
  missingConfig,
  notConfiguredMessage,
  parseGolden,
  pickGolden,
  runCases,
  signIn,
  spendThresholdsFromEnv,
  supabaseUrlFromConfig,
} from "./ai-canary-core.ts";

const env = Deno.env.toObject();
const inActions = env.GITHUB_ACTIONS === "true";

const annotate = (level: "error" | "warning", message: string) => {
  if (inActions) console.log(`::${level}::${message.replace(/\r?\n/g, " ")}`);
  else console.error(`${level}: ${message}`);
};

const missing = missingConfig(env);
if (missing.length > 0) {
  annotate("error", notConfiguredMessage(missing));
  Deno.exit(1);
}

const root = new URL("../", import.meta.url);
const supabaseUrl =
  env.HIKAYA_SUPABASE_URL?.trim() ||
  supabaseUrlFromConfig(Deno.readTextFileSync(new URL("supabase/config.toml", root)));
if (!supabaseUrl) {
  annotate("error", "canary not configured: no project_id in supabase/config.toml and no HIKAYA_SUPABASE_URL");
  Deno.exit(1);
}

const onlyArg = (() => {
  const i = Deno.args.indexOf("--only");
  const raw = i >= 0 ? Deno.args[i + 1] : env.CANARY_ONLY;
  if (!raw?.trim()) return undefined;
  const names = raw.split(/[\s,]+/).filter(Boolean);
  const unknown = names.filter((n) => !CANARY_FUNCTIONS.includes(n as CanaryFunction));
  if (unknown.length) {
    annotate("error", `unknown function(s) for --only: ${unknown.join(", ")}`);
    Deno.exit(2);
  }
  return names as CanaryFunction[];
})();

const golden = {} as Record<CanaryDialect, GoldenRow>;
for (const dialect of CANARY_DIALECTS) {
  const path = new URL(`supabase/functions/_test/eval/golden/${GOLDEN_FILES[dialect]}`, root);
  golden[dialect] = pickGolden(parseGolden(Deno.readTextFileSync(path)), dialect);
}

const anonKey = env.HIKAYA_SUPABASE_ANON_KEY!.trim();
const printAmounts = env.CANARY_PRINT_AMOUNTS === "1";
const failures: string[] = [];

// ── Features ────────────────────────────────────────────────────────────────
let results: CaseResult[] = [];
try {
  const accessToken = await signIn(
    fetch,
    supabaseUrl,
    anonKey,
    env.HIKAYA_CANARY_EMAIL!.trim(),
    env.HIKAYA_CANARY_PASSWORD!,
  );
  const cases = buildCases(golden, { nowMs: Date.now(), env, only: onlyArg });
  console.log(`AI canary: ${cases.length} checks against ${new URL(supabaseUrl).host}\n`);
  results = await runCases(cases, { fetch, now: () => Date.now(), supabaseUrl, anonKey, accessToken });
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
}

for (const r of results) {
  console.log(formatCaseLine(r));
  if (!r.ok) {
    failures.push(`${r.id}: ${r.failures.join("; ")}`);
    if (r.excerpt) console.log(`        ${r.excerpt.replace(/\s+/g, " ").slice(0, 240)}`);
  }
}

// ── Spend ───────────────────────────────────────────────────────────────────
console.log("");
const spend = await fetchSpend(fetch, supabaseUrl, anonKey, env.HIKAYA_AI_CANARY_SECRET!.trim());
let spendOk = false;
if (!spend.ok) {
  console.log(`FAIL  spend  ${spend.failure}`);
  failures.push(spend.failure);
} else {
  const verdict = judgeSpend(spend.report, spendThresholdsFromEnv(env), printAmounts);
  console.log(verdict.ok ? "PASS  spend  within thresholds" : `FAIL  spend  ${verdict.failures.join("; ")}`);
  for (const note of verdict.notes) annotate("warning", note);
  failures.push(...verdict.failures);
  spendOk = verdict.ok;
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const summary = `${passed}/${results.length} feature checks passed; spend ${spendOk ? "ok" : "flagged"}`;
console.log(`\n${summary}`);

if (env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## AI canary",
    "",
    summary,
    "",
    "| check | result | HTTP | seconds | detail |",
    "| --- | --- | --- | --- | --- |",
    ...results.map((r) =>
      `| ${r.id} | ${r.ok ? "pass" : "**fail**"} | ${r.status} | ${(r.latencyMs / 1000).toFixed(1)} | ${(r.ok ? r.warnings : r.failures).join("; ").replace(/\|/g, "/")} |`
    ),
    "",
    ...failures.map((f) => `- ${f}`),
    "",
  ];
  Deno.writeTextFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n"), { append: true });
}

if (failures.length > 0) {
  for (const f of failures) annotate("error", f);
  Deno.exit(1);
}
