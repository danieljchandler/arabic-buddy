#!/usr/bin/env node
/**
 * Merges qa/output/{routes,resilience,media}/*.json into qa/output/crawl-report.md
 * and qa/output/crawl-report.json. Pure aggregation — run after the specs.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "output");
const load = (dir) => {
  const d = join(OUT, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(d, f), "utf8")));
};

// Route patterns from the manifest, for dead-link detection.
const manifestSrc = readFileSync(join(here, "..", "src", "test", "support", "routes", "manifest.ts"), "utf8");
const patterns = [...manifestSrc.matchAll(/path:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*")
  .map((p) => new RegExp("^" + p.replace(/:[A-Za-z0-9_]+/g, "[^/]+") + "/?$"));
const isRouted = (href) => {
  const path = href.split(/[?#]/)[0];
  return patterns.some((re) => re.test(path));
};

const routes = load("routes").sort((a, b) => a.label.localeCompare(b.label));
// Font CSS is deliberately blocked by the harness (egress policy); never a finding.
const isNoise = (f) => f.error === "net::ERR_BLOCKED_BY_CLIENT" || /fonts\.g(oogleapis|static)\.com/.test(f.url);
for (const r of routes) {
  r.load.failures = r.load.failures.filter((f) => !isNoise(f));
  r.interaction.failures = r.interaction.failures.filter((f) => !isNoise(f));
  const dropFont = (e) => !/net::ERR_BLOCKED_BY_CLIENT|fonts\.g(oogleapis|static)/.test(e);
  r.load.consoleErrors = r.load.consoleErrors.filter(dropFont);
  r.interaction.consoleErrors = r.interaction.consoleErrors.filter(dropFont);
}
const resilience = load("resilience");
const media = load("media");

const lines = [];
const md = (s = "") => lines.push(s);

md("# Live crawl report");
md();
md(`Generated ${new Date().toISOString()} — ${routes.length} route instances, ${resilience.length} resilience runs, ${media.length} media checks.`);
md();

// ── Route table ─────────────────────────────────────────────────────────────
md("## Routes");
md();
md("| Route | Auth | Result | Load | Console err | Supabase failures | Controls (clicked / no-op / paid / unsafe) |");
md("|---|---|---|---|---|---|---|");
const problems = [];
for (const r of routes) {
  const s = r.state;
  let result = "ok";
  if (r.navError) result = "NAV ERROR";
  else if (r.expectedRedirect && s.path === r.expectedRedirect) result = `redirect → ${s.path}`;
  else if (s.redirectedToAuth && (r.route === "/auth" || r.route === "/admin/login" || r.route === "/login/id")) result = "ok (auth page)";
  else if (s.redirectedToAuth) result = r.gate === "public" ? "REDIRECTED TO AUTH (public route!)" : r.gate === "in-page" ? "→ auth (in-page gate)" : "→ auth (gated)";
  else if (s.is404) result = r.route === "*" ? "404 (expected)" : "404";
  else if (s.notFoundText) result = "not-found state (handled)";
  else if (s.isBlank && s.bodyChars > 10) result = "near-blank (see screenshot)";
  else if (s.isBlank) result = "BLANK";
  else if (r.infiniteLoader) result = "INFINITE LOADER";
  else if (s.errorBoundary) result = "ERROR BOUNDARY";
  else if (s.emptyStateText) result = `empty state ("${s.emptyStateText}")`;
  const sbFail = r.load.failures.filter((f) => ["rest", "storage", "functions", "auth"].includes(f.layer));
  const ctl = r.interaction.controls;
  const clicked = ctl.filter((c) => c.action === "clicked").length;
  const noop = ctl.filter((c) => c.outcome === "no-op").length;
  const paid = ctl.filter((c) => c.action === "needs-live-api-test").length;
  const unsafe = ctl.filter((c) => c.action === "skipped-unsafe").length;
  md(`| \`${r.label}\` | ${r.authed ? "learner" : "anon"} | ${result} | ${r.loadMs}ms | ${r.load.consoleErrors.length + r.load.pageErrors.length} | ${sbFail.length} | ${clicked} / ${noop} / ${paid} / ${unsafe} |`);
  if (/NAV ERROR|REDIRECTED TO AUTH|^404$|BLANK|INFINITE|ERROR BOUNDARY/.test(result)) problems.push({ label: r.label, result, r });
}
md();

// ── Page-level problems ─────────────────────────────────────────────────────
md("## Page-level problems");
md();
if (problems.length === 0) md("None.");
for (const p of problems) {
  md(`- **${p.label}** — ${p.result} (final url \`${p.r.state.path}\`, headline "${p.r.state.headline}")`);
  for (const e of p.r.load.pageErrors.slice(0, 3)) md(`  - pageerror: \`${e.slice(0, 200)}\``);
  for (const e of p.r.load.consoleErrors.slice(0, 3)) md(`  - console: \`${e.slice(0, 200)}\``);
}
md();

// ── Supabase failures aggregated ────────────────────────────────────────────
md("## Supabase failures (aggregated across load + interaction)");
md();
const agg = new Map();
// Storage object paths carry ids; fold them to bucket + extension so one bug is one row.
const foldTarget = (f) => (f.layer === "storage" ? f.target.replace(/^(object\/(?:sign|public|list|authenticated)?\/?[^/]+)\/.*?(\.[a-z0-9]+)?$/i, "$1/*$2") : f.target);
for (const r of routes) {
  for (const [phase, list] of [["load", r.load.failures], ["interaction", r.interaction.failures]]) for (const f of list) {
    if (!["rest", "storage", "functions", "auth", "realtime"].includes(f.layer)) continue;
    const target = foldTarget(f);
    const key = `${phase}|${f.layer}|${f.method}|${target}|${f.status ?? "NETFAIL"}`;
    const e = agg.get(key) ?? { phase, layer: f.layer, method: f.method, target, status: f.status ?? "NETFAIL", body: f.body ?? f.error ?? "", pages: new Set(), count: 0 };
    e.pages.add(r.label);
    e.count++;
    agg.set(key, e);
  }
}
md("Phase = whether the failure happened while the page loaded (a bug the user hits by arriving) or during the click sweep (which also navigates away and back, so ERR_ABORTED there is usually the harness cancelling in-flight queries).");
md();
md("| Phase | Layer | Method | Target | Status | Count | Pages | Body |");
md("|---|---|---|---|---|---|---|---|");
for (const e of [...agg.values()].sort((a, b) => (a.phase === b.phase ? b.count - a.count : a.phase === "load" ? -1 : 1))) {
  md(`| ${e.phase} | ${e.layer} | ${e.method} | \`${e.target}\` | ${e.status} | ${e.count} | ${[...e.pages].slice(0, 6).join(", ")}${e.pages.size > 6 ? ` +${e.pages.size - 6}` : ""} | ${String(e.body).replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 120)} |`);
}
md();

// ── External failures (youtube/tiktok/other) ────────────────────────────────
md("## External / asset failures");
md();
const ext = new Map();
for (const r of routes) for (const f of [...r.load.failures, ...r.interaction.failures]) {
  if (["rest", "storage", "functions", "auth", "realtime"].includes(f.layer)) continue;
  const key = `${f.layer}|${f.status ?? "NETFAIL"}|${f.target}`;
  const e = ext.get(key) ?? { ...f, pages: new Set(), count: 0 };
  e.pages.add(r.label);
  e.count++;
  ext.set(key, e);
}
for (const e of [...ext.values()].sort((a, b) => b.count - a.count).slice(0, 40)) md(`- ${e.layer} ${e.status ?? "NETFAIL"} \`${e.url.slice(0, 110)}\` ×${e.count} (${[...e.pages].slice(0, 4).join(", ")})`);
md();

// ── Console error signatures ────────────────────────────────────────────────
md("## Console / page error signatures");
md();
const sig = new Map();
for (const r of routes) {
  for (const e of [...r.load.consoleErrors, ...r.load.pageErrors, ...r.interaction.consoleErrors, ...r.interaction.pageErrors]) {
    const k = e.replace(/https?:\/\/\S+/g, "<url>").replace(/[0-9a-f-]{20,}/g, "<id>").slice(0, 140);
    const v = sig.get(k) ?? { pages: new Set(), count: 0 };
    v.pages.add(r.label);
    v.count++;
    sig.set(k, v);
  }
}
for (const [k, v] of [...sig.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 60)) md(`- ×${v.count} (${v.pages.size} pages) \`${k}\``);
md();

// ── No-op controls ──────────────────────────────────────────────────────────
md("## Controls that did nothing when clicked (no navigation, no DOM change, no request)");
md();
for (const r of routes) {
  const noops = r.interaction.controls.filter((c) => c.outcome === "no-op");
  if (noops.length) md(`- \`${r.label}\`: ${noops.map((c) => `"${c.label}"`).join(", ")}`);
}
md();
md("## Controls that could not be clicked");
md();
for (const r of routes) {
  const bad = r.interaction.controls.filter((c) => c.action === "click-failed");
  if (bad.length) md(`- \`${r.label}\`: ${bad.map((c) => `"${c.label}" (${c.error})`).join("; ")}`);
}
md();
md("## Paid-pipeline controls (not exercised — needs live API test)");
md();
const paidSet = new Map();
for (const r of routes) for (const c of r.interaction.controls.filter((c) => c.action === "needs-live-api-test")) {
  const v = paidSet.get(c.label) ?? new Set();
  v.add(r.label);
  paidSet.set(c.label, v);
}
for (const [l, pages] of paidSet) md(`- "${l}" on ${[...pages].slice(0, 5).join(", ")}${pages.size > 5 ? ` +${pages.size - 5}` : ""}`);
md();

// ── Navigation targets and dead links ───────────────────────────────────────
md("## Links to unrouted paths (possible dead links)");
md();
const dead = new Map();
for (const r of routes) for (const h of r.links) if (!isRouted(h)) {
  const v = dead.get(h) ?? new Set();
  v.add(r.label);
  dead.set(h, v);
}
for (const c of routes.flatMap((r) => r.interaction.controls.filter((c) => c.navigatedTo && !isRouted(c.navigatedTo)).map((c) => ({ ...c, page: r.label })))) {
  const v = dead.get(c.navigatedTo) ?? new Set();
  v.add(`${c.page} via "${c.label}"`);
  dead.set(c.navigatedTo, v);
}
if (dead.size === 0) md("None.");
for (const [h, pages] of dead) md(`- \`${h}\` from ${[...pages].slice(0, 5).join(", ")}`);
md();

// ── Resilience ──────────────────────────────────────────────────────────────
md("## Resilience (Supabase slow / down)");
md();
md("| Route | backend-500 | network-drop | slow-4s |");
md("|---|---|---|---|");
const byPath = new Map();
for (const x of resilience) {
  const v = byPath.get(x.path) ?? {};
  v[x.mode] = x.verdict;
  byPath.set(x.path, v);
}
for (const [p, v] of [...byPath.entries()].sort()) md(`| \`${p}\` | ${v["backend-500"] ?? "-"} | ${v["network-drop"] ?? "-"} | ${v["slow-4s"] ?? "-"} |`);
md();

// ── Media ───────────────────────────────────────────────────────────────────
md("## Media");
md();
for (const m of media) md("```json\n" + JSON.stringify(m, null, 1).slice(0, 3500) + "\n```");

writeFileSync(join(OUT, "crawl-report.md"), lines.join("\n"));
writeFileSync(join(OUT, "crawl-report.json"), JSON.stringify({ routes, resilience, media }, null, 1));
console.log(`wrote ${join(OUT, "crawl-report.md")} (${routes.length} routes, ${problems.length} page-level problems, ${agg.size} supabase failure signatures)`);
