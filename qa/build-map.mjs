#!/usr/bin/env node
/**
 * Generates QA_MAP.md — every route, the page that serves it, every Supabase
 * dependency reached from that page (tables, RPCs, edge functions, buckets)
 * with the RLS / auth facts that decide whether the call can silently return
 * nothing, and (when a crawl has run) the interactive inventory per screen.
 *
 * Inputs
 *   src/App.tsx + src/test/support/routes/manifest.ts   routes and gates
 *   src/**                                              transitive .from()/.rpc()/invoke()/storage.from() walk
 *   supabase/config.toml, supabase/functions/**         verify_jwt and guard classification
 *   qa/output/schema/*.txt                              replayed-schema RLS dump + live probes (see docs in qa/README.md)
 *   qa/output/routes/*.json                             crawl inventory (optional)
 *
 * Run:  node qa/build-map.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SRC = join(ROOT, "src");
const SCHEMA = join(here, "output", "schema");
const ROUTES_OUT = join(here, "output", "routes");

// ── 1. Static dependency walk ────────────────────────────────────────────────
const cache = new Map();
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
function analyze(file) {
  if (cache.has(file)) return cache.get(file);
  const src = readFileSync(file, "utf8");
  const info = { tables: new Set(), rpcs: new Set(), fns: new Set(), buckets: new Set(), auth: new Set(), realtime: false, imports: [] };
  for (const m of src.matchAll(/storage\s*\.from\(\s*["'`]([^"'`]+)["'`]/g)) info.buckets.add(m[1]);
  for (const m of src.matchAll(/(?<!storage\s*)\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) info.tables.add(m[1]);
  for (const m of src.matchAll(/\.rpc(?:<[^>]*>)?\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) info.rpcs.add(m[1]);
  for (const m of src.matchAll(/invoke(?:<[^>]*>)?\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) info.fns.add(m[1]);
  for (const m of src.matchAll(/functions\/v1\/([a-zA-Z0-9_-]+)/g)) info.fns.add(m[1]);
  for (const m of src.matchAll(/supabase\.auth\.([a-zA-Z]+)\(/g)) info.auth.add(m[1]);
  if (/supabase\.channel\(|["']postgres_changes["']/.test(src)) info.realtime = true;
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const r = resolveImport(file, m[1] ?? m[2]);
    if (r && r.startsWith(SRC)) info.imports.push(r);
  }
  cache.set(file, info);
  return info;
}
function walk(entry, skipPages = false) {
  const seen = new Set();
  const stack = [entry];
  const agg = { tables: new Set(), rpcs: new Set(), fns: new Set(), buckets: new Set(), auth: new Set(), realtime: false, via: [] };
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if ((skipPages && f !== entry && f.includes("/pages/")) || f.includes("/components/ui/") || f.endsWith("/integrations/supabase/client.ts") || f.endsWith("/integrations/supabase/types.ts")) continue;
    const i = analyze(f);
    if (i.tables.size || i.rpcs.size || i.fns.size || i.buckets.size || i.auth.size || i.realtime) agg.via.push(f.slice(SRC.length + 1));
    for (const k of ["tables", "rpcs", "fns", "buckets", "auth"]) for (const v of i[k]) agg[k].add(v);
    agg.realtime ||= i.realtime;
    for (const d of i.imports) stack.push(d);
  }
  return Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v]));
}

const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const compFile = {};
for (const m of app.matchAll(/const (\w+) = lazyPage\(\(\) => import\("\.\/(pages\/[^"]+)"\)\)/g)) compFile[m[1]] = m[2];
const routes = [];
let adminBlock = false;
for (const m of app.matchAll(/<Route\s+(?:index|path="([^"]*)")([\s\S]*?)(?=<Route\b|<\/Route>)/g)) {
  let path = m[1] ?? "(index)";
  const body = m[2];
  if (path === "/admin" && /AdminLayout/.test(body)) adminBlock = true;
  const nav = body.match(/<Navigate to=\{?["'`]([^"'`]+)/);
  const comps = [...body.matchAll(/<([A-Z]\w+)/g)].map((x) => x[1]).filter((c) => compFile[c]);
  if (adminBlock && !path.startsWith("/")) path = path === "(index)" ? "/admin" : "/admin/" + path;
  routes.push({ path, component: comps[0] ?? null, file: comps[0] ? compFile[comps[0]] : null, redirect: nav?.[1] ?? null, protectedRoute: /ProtectedRoute/.test(body) });
}
const manifestSrc = readFileSync(join(SRC, "test", "support", "routes", "manifest.ts"), "utf8");
const gates = new Map([...manifestSrc.matchAll(/\{\s*path:\s*"([^"]+)"[\s\S]*?gate:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
const shell = walk(join(SRC, "App.tsx"), true);

// ── 2. Schema facts ──────────────────────────────────────────────────────────
const readLines = (name) => (existsSync(join(SCHEMA, name)) ? readFileSync(join(SCHEMA, name), "utf8").split("\n").filter(Boolean) : []);
const policies = new Map(); // table -> [{name, cmd, roles, qual}]
for (const l of readLines("rls-policies.txt")) {
  const [tbl, name, cmd, roles, qual] = l.split("|");
  const t = tbl.replace(/^public\./, "");
  if (!policies.has(t)) policies.set(t, []);
  policies.get(t).push({ name, cmd, roles, qual: (qual ?? "").replace(/::text/g, "").replace(/\s+/g, " ") });
}
const rlsOff = new Set(readLines("rls-tables.txt").filter((l) => l.split("|")[1] === "f").map((l) => l.split("|")[0]));
const anonProbe = new Map(readLines("anon-table-probe.txt").map((l) => {
  const [t, code, range] = l.split("|");
  return [t, { code, rows: (range ?? "").split("/")[1] ?? "?" }];
}));
const buckets = new Map(readLines("buckets.txt").map((l) => l.split("|")));
const fnGuards = new Map(readLines("fn-guards.txt").map((l) => {
  const [n, vj, g] = l.split("|");
  return [n, { verifyJwt: vj, guards: g }];
}));
const fnDeploy = new Map(readLines("fn-preflight.txt").map((l) => [l.split("|")[0], l.split("|")[1]]));
const existingFns = new Set(readdirSync(join(ROOT, "supabase", "functions")).filter((d) => !d.startsWith("_")));

function selectSummary(table) {
  if (rlsOff.has(table)) return "RLS OFF";
  const ps = (policies.get(table) ?? []).filter((p) => p.cmd === "SELECT" || p.cmd === "ALL");
  if (ps.length === 0) return policies.has(table) ? "no SELECT policy → always empty for clients" : "no policy found in replay (table may live outside migrations)";
  return ps
    .map((p) => {
      const q = p.qual === "true" ? "everyone" : p.qual.length > 70 ? p.qual.slice(0, 67) + "…" : p.qual;
      return `${p.cmd === "ALL" ? "ALL" : "SELECT"}[${p.roles}] ${q}`;
    })
    .join("; ");
}
function tableCell(t) {
  const probe = anonProbe.get(t);
  const live = probe ? (probe.code === "200" || probe.code === "206" ? `anon sees ${probe.rows} rows` : `anon → HTTP ${probe.code}`) : "not probed";
  return `\`${t}\` — ${selectSummary(t)} — live: ${live}`;
}
function fnCell(f) {
  const g = fnGuards.get(f);
  const dep = fnDeploy.get(f);
  const flags = [];
  if (!existingFns.has(f)) flags.push("NO SOURCE DIR");
  if (dep && dep !== "200") flags.push(`NOT DEPLOYED (${dep})`);
  if (g) {
    flags.push(`verify_jwt=${g.verifyJwt}`);
    const guard = /user|cap|sub|admin|internal/.test(g.guards) ? "guarded" : "UNGUARDED";
    flags.push(guard);
    if (/LLM|SPEECH|STRIPE/.test(g.guards)) flags.push("paid: " + g.guards.split(" ").filter((x) => /LLM|SPEECH|STRIPE/.test(x)).join("/"));
  }
  return `\`${f}\` (${flags.join(", ")})`;
}
function bucketCell(b) {
  const pub = buckets.get(b);
  return `\`${b}\` (${pub === undefined ? "NOT CREATED BY MIGRATIONS" : pub === "t" ? "public" : "PRIVATE — reads need a storage.objects SELECT policy"})`;
}

// ── 3. Crawl inventory ───────────────────────────────────────────────────────
const crawl = new Map();
if (existsSync(ROUTES_OUT)) {
  for (const f of readdirSync(ROUTES_OUT)) {
    const j = JSON.parse(readFileSync(join(ROUTES_OUT, f), "utf8"));
    if (!crawl.has(j.route)) crawl.set(j.route, []);
    crawl.get(j.route).push(j);
  }
}

// ── 4. Render ────────────────────────────────────────────────────────────────
const out = [];
const md = (s = "") => out.push(s);
md("# QA map — Hakiya");
md();
md(`Generated by \`node qa/build-map.mjs\` on ${new Date().toISOString().slice(0, 10)}. Regenerate after adding routes, tables, functions or buckets; hand-edit only the **Flows** section.`);
md();
md("Legend: *live* = what the anon role gets from the production project right now (HTTP status and row count from `qa/output/schema/anon-table-probe.txt`); *SELECT[...]* = the policy that decides visibility, from replaying every migration on stock Postgres (`qa/output/schema/rls-policies.txt`). A table with a permissive policy and 0 live rows is **empty**, not blocked. A table whose only SELECT policy names `authenticated` is invisible to signed-out visitors even on a public route.");
md();
md(readFileSync(join(here, "flows.md"), "utf8").trim());
md();
md("## App shell (every page)");
md();
md(`Providers and global UI mounted by \`src/App.tsx\` touch these on every route (via ${shell.via.join(", ")}):`);
md();
md("- Tables: " + shell.tables.map(tableCell).join("; "));
md("- Edge functions: " + shell.fns.map(fnCell).join("; "));
md("- Auth calls: " + shell.auth.join(", "));
md();
md("## Routes");
md();
for (const r of routes) {
  const gate = gates.get(r.path) ?? (r.path.startsWith("/admin") ? "admin*" : "?");
  md(`### \`${r.path}\``);
  md();
  if (r.redirect) {
    md(`Redirects to \`${r.redirect}\`.`);
    md();
    continue;
  }
  if (!r.file) {
    md("(no page component resolved)");
    md();
    continue;
  }
  const deps = walk(join(SRC, r.file + ".tsx"));
  md(`Page \`src/${r.file}.tsx\` · gate **${gate}**${r.protectedRoute ? " (ProtectedRoute)" : ""}`);
  md();
  const own = (k) => deps[k].filter((x) => !shell[k].includes(x));
  const tables = own("tables");
  const fns = own("fns");
  if (tables.length) md("- **Tables:** " + tables.map(tableCell).join("; "));
  if (deps.rpcs.length) md("- **RPCs:** " + deps.rpcs.map((x) => `\`${x}\``).join(", "));
  if (fns.length) md("- **Edge functions:** " + fns.map(fnCell).join("; "));
  if (deps.buckets.length) md("- **Buckets:** " + deps.buckets.map(bucketCell).join("; "));
  if (deps.realtime) md("- **Realtime:** subscribes to postgres_changes / channels");
  if (deps.auth.filter((a) => !shell.auth.includes(a)).length) md("- **Auth:** " + deps.auth.filter((a) => !shell.auth.includes(a)).join(", "));
  const cr = crawl.get(r.path) ?? [];
  for (const c of cr) {
    const inv = c.inventory;
    const controls = c.interaction.controls.filter((x) => x.action !== "skipped-unsafe" || x.index >= 0).map((x) => x.label).filter((l, i, a) => a.indexOf(l) === i);
    md(`- **Crawled (${c.authed ? "learner" : "anon"}${c.label !== r.path ? ", " + c.label : ""}):** headline "${c.state.headline}", ${inv.buttons} buttons, ${inv.links} links, ${inv.inputs} inputs, ${inv.tabs} tabs, ${inv.media} media. Links: ${c.links.slice(0, 20).map((l) => `\`${l}\``).join(" ")}${c.links.length > 20 ? " …" : ""}`);
    if (controls.length) md(`  - Controls: ${controls.slice(0, 40).map((l) => `"${l}"`).join(", ")}${controls.length > 40 ? " …" : ""}`);
  }
  md();
}

// ── 5. Reverse indexes ───────────────────────────────────────────────────────
md("## Reverse index — table → routes");
md();
const t2r = new Map();
const f2r = new Map();
for (const r of routes) {
  if (!r.file) continue;
  const deps = walk(join(SRC, r.file + ".tsx"));
  for (const t of deps.tables) (t2r.get(t) ?? t2r.set(t, new Set()).get(t)).add(r.path);
  for (const f of deps.fns) (f2r.get(f) ?? f2r.set(f, new Set()).get(f)).add(r.path);
}
for (const [t, rs] of [...t2r.entries()].sort()) md(`- ${tableCell(t)} → ${[...rs].length > 12 ? `${[...rs].length} routes` : [...rs].map((p) => `\`${p}\``).join(" ")}`);
md();
md("## Reverse index — edge function → routes");
md();
for (const [f, rs] of [...f2r.entries()].sort()) md(`- ${fnCell(f)} → ${[...rs].length > 12 ? `${[...rs].length} routes` : [...rs].map((p) => `\`${p}\``).join(" ")}`);
md();
md("## Edge functions never invoked from the client");
md();
md([...existingFns].filter((f) => !f2r.has(f)).map((f) => `\`${f}\``).join(", ") + " — reached only server-to-server, by cron, or dead. Check `fn-guards.txt` for which.");
md();
md("## Storage buckets");
md();
for (const [b, pub] of buckets) md(`- \`${b}\` — ${pub === "t" ? "public" : "private"}; policies: ${(policies.get("storage.objects") ?? []).filter((p) => p.qual.includes(`'${b}'`) || p.name.toLowerCase().includes(b.split("-")[0])).map((p) => `${p.cmd}[${p.roles}] ${p.name}`).join("; ") || "none matched by name"}`);

writeFileSync(join(ROOT, "QA_MAP.md"), out.join("\n") + "\n");
console.log(`wrote QA_MAP.md — ${routes.length} routes, ${t2r.size} tables, ${f2r.size} client-invoked functions`);
