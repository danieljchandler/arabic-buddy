#!/usr/bin/env node
/**
 * Builds qa/output/gallery.html — every crawl screenshot as an inline JPEG
 * thumbnail with its route, result and failure counts, so the visual record can
 * be reviewed (or published) as one self-contained page. Uses the Playwright
 * browser to downscale, since the container has no image library.
 *
 * Run after the specs and qa/report.mjs:  node qa/gallery.mjs
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "output");
const SCREENS = join(OUT, "screens");
const WIDTH = 420;

const report = existsSync(join(OUT, "crawl-report.json")) ? JSON.parse(readFileSync(join(OUT, "crawl-report.json"), "utf8")) : { routes: [], resilience: [], media: [] };
const byShot = new Map();
for (const r of report.routes) byShot.set(basename(r.screenshot), { kind: "route", r });
for (const x of report.resilience) byShot.set(basename(x.screenshot), { kind: "resilience", x });
for (const m of report.media) if (m.screenshot) byShot.set(basename(m.screenshot), { kind: "media", m });

const files = readdirSync(SCREENS).filter((f) => f.endsWith(".png")).sort();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const thumbs = [];
for (const f of files) {
  const dataUrl = "data:image/png;base64," + readFileSync(join(SCREENS, f)).toString("base64");
  const jpeg = await page.evaluate(
    async ({ src, width }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = width / img.naturalWidth;
      const h = Math.min(Math.round(img.naturalHeight * scale), 900);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, width, Math.round(img.naturalHeight * scale));
      return c.toDataURL("image/jpeg", 0.62);
    },
    { src: dataUrl, width: WIDTH },
  );
  thumbs.push({ file: f, jpeg });
}
await browser.close();

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function caption(f) {
  const hit = byShot.get(f);
  if (!hit) return { title: f, sub: "", flag: "" };
  if (hit.kind === "route") {
    const r = hit.r;
    const s = r.state;
    const flags = [s.is404 ? "404" : "", s.isBlank ? "blank" : "", r.infiniteLoader ? "infinite loader" : "", s.errorBoundary ? "error boundary" : "", s.redirectedToAuth ? "→ auth" : "", s.emptyStateText ? `empty: ${s.emptyStateText}` : ""].filter(Boolean);
    const sb = r.load.failures.filter((x) => ["rest", "storage", "functions", "auth"].includes(x.layer)).length;
    const noop = r.interaction.controls.filter((c) => c.outcome === "no-op").length;
    return { title: `${r.label} (${r.authed ? "learner" : "anon"})`, sub: `${s.headline || s.title} · ${r.loadMs}ms · ${sb} supabase failures · ${noop} no-op controls`, flag: flags.join(", ") };
  }
  if (hit.kind === "resilience") return { title: `${hit.x.path} — ${hit.x.mode}`, sub: `verdict: ${hit.x.verdict}`, flag: hit.x.verdict };
  return { title: `media — ${hit.m.video?.platform ?? f}`, sub: hit.m.state?.headline ?? "", flag: "" };
}

const cards = thumbs
  .map(({ file, jpeg }) => {
    const c = caption(file);
    return `<figure><a href="${jpeg}" target="_blank"><img src="${jpeg}" loading="lazy" alt="${esc(c.title)}"></a><figcaption><b>${esc(c.title)}</b><br><span>${esc(c.sub)}</span>${c.flag ? `<br><em>${esc(c.flag)}</em>` : ""}</figcaption></figure>`;
  })
  .join("\n");

writeFileSync(
  join(OUT, "gallery.html"),
  `<title>Hakiya QA Screens</title>
<style>
:root{--bg:#faf7f2;--fg:#222;--card:#fff;--line:#ddd;--flag:#a33}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#181614;--fg:#eee;--card:#221f1c;--line:#3a3532;--flag:#f88}}
:root[data-theme="dark"]{--bg:#181614;--fg:#eee;--card:#221f1c;--line:#3a3532;--flag:#f88}
body{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;margin:0;padding:20px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;opacity:.8}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${WIDTH}px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{display:block;width:100%;height:auto;max-height:420px;object-fit:cover;object-position:top}
figcaption{padding:8px 10px;font-size:12px;line-height:1.4}figcaption em{color:var(--flag);font-style:normal}
</style>
<h1>Hakiya live crawl — screenshots</h1>
<p>${thumbs.length} states captured ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Click a thumbnail for the full-size image. Route pages are full-page captures; resilience captures are the viewport after the injected outage.</p>
<div class="grid">${cards}</div>
`,
);
console.log(`wrote ${join(OUT, "gallery.html")} with ${thumbs.length} thumbnails`);
