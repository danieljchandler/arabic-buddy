#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * Live half of the dialect eval harness (audit item B2) — measures a model
 * against the frozen golden set BEFORE a swap ships, instead of discovering
 * regressions in production.
 *
 * For every golden prompt (supabase/functions/_test/eval/golden/*.jsonl) it
 * asks the model under test for a reply in the dialect, then scores the reply
 * with the same hardcoded MSA-leak detector CI pins the golden set against
 * (supabase/functions/_test/eval_golden_test.ts is the offline half). Output:
 * leak rate per dialect and every offending reply, so two runs — current
 * model vs candidate — give a side-by-side answer to "did dialect fidelity
 * move?".
 *
 * Usage:
 *   OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-net \
 *     scripts/eval-dialect-live.ts --model anthropic/claude-sonnet-5 [--dialect Gulf] [--limit 10]
 *
 * The provider follows from the model id, exactly as it does in production:
 * `google/*` needs GEMINI_API_KEY, `openai/*` needs OPENAI_API_KEY, everything
 * else needs OPENROUTER_API_KEY — which also covers the first two when their
 * own key is absent. Routing the eval any differently from the pipeline would
 * measure a model the pipeline never calls.
 *
 * Deliberately does NOT go through askBrain: the Brain adds repair passes and
 * validators, which would measure the pipeline, not the model. This measures
 * the raw model under the same dialect prompt the Brain builds — identity,
 * rulebook and worked examples — so a leak here is a leak the repair pass would
 * have had to clean up, not an artefact of a different prompt.
 *
 * Two comparisons it exists to answer:
 *
 *   --compare <model>   Run a second model over the same golden set and print
 *                       the per-dialect delta. This is the check to run before
 *                       a registry bump ships: "did dialect fidelity move?"
 *
 *   --no-demos          Drop the worked examples from the prompt. Running with
 *                       and without is the measurement of whether the
 *                       demonstrations earn their tokens on *this* golden set,
 *                       rather than on the paper's.
 */
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector.ts";
import { chatFetch, hasAnyProvider, providerForModel } from "../supabase/functions/_shared/aiGateway.ts";
import { getDialectDemonstrations } from "../supabase/functions/_shared/dialectHelpers.ts";
import {
  getDialectIdentity,
  getDialectVocabRules,
  type Dialect,
} from "../supabase/functions/_shared/dialectHelpers.ts";

interface GoldenRow {
  id: string;
  prompt: string;
  good: string;
  bad: string;
}

const args = Deno.args;
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const modelArg = opt("model");
if (!modelArg) {
  console.error(
    "Usage: eval-dialect-live.ts --model <id> [--compare <id>] [--no-demos]\n" +
      "                           [--dialect Gulf|Egyptian|Yemeni] [--limit N]",
  );
  Deno.exit(2);
}
const dialectFilter = opt("dialect");
const limit = Number(opt("limit")) || Infinity;
const compareModel = opt("compare");
const withDemos = !args.includes("--no-demos");

if (!hasAnyProvider()) {
  console.error("No provider key set. Export GEMINI_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY.");
  Deno.exit(2);
}
// Narrowed once, after the usage check above, so the rest of the file has a
// plain string rather than re-proving it is not null at every use.
const model: string = modelArg;
console.error(`Routing ${model} via ${providerForModel(model)}.`);

const GOLDEN: Array<{ file: string; dialect: Dialect }> = [
  { file: "gulf.jsonl", dialect: "Gulf" },
  { file: "egyptian.jsonl", dialect: "Egyptian" },
  { file: "yemeni.jsonl", dialect: "Yemeni" },
];

function loadGolden(file: string): GoldenRow[] {
  const path = new URL(`../supabase/functions/_test/eval/golden/${file}`, import.meta.url);
  return Deno.readTextFileSync(path)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenRow);
}

async function generate(model: string, dialect: Dialect, prompt: string): Promise<string> {
  // The same stable prefix the Brain prepends — identity, rulebook, and (unless
  // --no-demos) the worked examples. Leaving any of it out would measure a
  // prompt production never sends.
  const shown = withDemos ? `\n\n${getDialectDemonstrations(dialect)}` : "";
  const system = `${getDialectIdentity(dialect)}\n\n${getDialectVocabRules(dialect)}${shown}\n\nReply with ONE natural spoken sentence in the dialect. No commentary, no transliteration.`;
  const res = await chatFetch(model, {
    max_tokens: 200,
    temperature: 0.7,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  }, { label: "eval-dialect-live" });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

interface DialectScore {
  dialect: Dialect;
  runs: number;
  leaky: number;
}

interface RunResult {
  model: string;
  perDialect: DialectScore[];
  runs: number;
  leaky: number;
  failures: Array<{ id: string; dialect: string; reply: string; leaks: string[] }>;
}

async function runEval(target: string): Promise<RunResult> {
  const perDialect: DialectScore[] = [];
  const failures: RunResult["failures"] = [];
  let runs = 0;
  let leaky = 0;

  for (const { file, dialect } of GOLDEN) {
    if (dialectFilter && dialect !== dialectFilter) continue;
    const rows = loadGolden(file).slice(0, limit);
    let dialectRuns = 0;
    let dialectLeaky = 0;
    for (const row of rows) {
      let reply = "";
      try {
        reply = await generate(target, dialect, row.prompt);
      } catch (e) {
        // Counted nowhere: a generation that never happened is not evidence
        // about leak rate in either direction.
        console.error(`  ${row.id}: generation failed — ${e instanceof Error ? e.message : e}`);
        continue;
      }
      runs++;
      dialectRuns++;
      const { leaks } = detectMsaLeaks(reply, dialect);
      if (leaks.length > 0) {
        leaky++;
        dialectLeaky++;
        failures.push({ id: row.id, dialect, reply: reply.slice(0, 160), leaks });
      }
    }
    perDialect.push({ dialect, runs: dialectRuns, leaky: dialectLeaky });
    console.log(
      `  ${dialect}: ${dialectRuns - dialectLeaky}/${dialectRuns} clean (${dialectLeaky} leaked)`,
    );
  }

  return { model: target, perDialect, runs, leaky, failures };
}

const pct = (leaky: number, runs: number) => (runs ? (leaky / runs) * 100 : 0);
const fmt = (leaky: number, runs: number) => `${pct(leaky, runs).toFixed(1)}%`;

console.log(`\n${model}${withDemos ? "" : "  (worked examples OFF)"}`);
const base = await runEval(model);

if (!compareModel) {
  if (base.failures.length) {
    console.log("\nLeaky replies:");
    for (const f of base.failures) {
      console.log(`  ${f.id} [${f.leaks.join(", ")}]: ${f.reply}`);
    }
  }
  console.log(`\n${model}: ${base.leaky}/${base.runs} replies leaked (${fmt(base.leaky, base.runs)}).`);
} else {
  console.error(`Routing ${compareModel} via ${providerForModel(compareModel)}.`);
  console.log(`\n${compareModel}${withDemos ? "" : "  (worked examples OFF)"}`);
  const other = await runEval(compareModel);

  // Percentage points, not a ratio: on a golden set this size a ratio makes a
  // one-reply difference look like a landslide.
  console.log(`\n${"dialect".padEnd(12)} ${model.padEnd(30)} ${compareModel.padEnd(30)} delta`);
  for (const a of base.perDialect) {
    const b = other.perDialect.find((d) => d.dialect === a.dialect);
    if (!b) continue;
    const delta = pct(b.leaky, b.runs) - pct(a.leaky, a.runs);
    const arrow = delta < 0 ? "better" : delta > 0 ? "worse" : "same";
    console.log(
      `${a.dialect.padEnd(12)} ${fmt(a.leaky, a.runs).padEnd(30)} ${fmt(b.leaky, b.runs).padEnd(30)} ` +
        `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp ${arrow}`,
    );
  }
  const delta = pct(other.leaky, other.runs) - pct(base.leaky, base.runs);
  console.log(
    `${"TOTAL".padEnd(12)} ${fmt(base.leaky, base.runs).padEnd(30)} ` +
      `${fmt(other.leaky, other.runs).padEnd(30)} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp`,
  );
  console.log(
    `\nLeak rate is one axis. A model can score clean here and still read as ` +
      `stilted to a native speaker — the detector only knows the tokens it was told about.`,
  );
}
