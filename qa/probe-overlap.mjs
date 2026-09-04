// Usage: node qa/probe-overlap.mjs /route "button name regex" — reports what elementFromPoint finds over each matching control.
import { chromium } from "@playwright/test";
const [route, pattern] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--no-sandbox"], proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort("blockedbyclient"));
await page.route(/supabase\.co/, async (route) => {
  const req = route.request(); const headers = {};
  for (const [k, v] of Object.entries(await req.allHeaders())) { if (/^(host|content-length|connection|accept-encoding|:.*)$/i.test(k)) continue; headers[k] = v; }
  try { const res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined, redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer()); const h = {}; res.headers.forEach((v, k) => { if (!/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)) h[k] = v; });
    await route.fulfill({ status: res.status, headers: h, body: buf }); } catch { await route.abort("failed"); }
});
await page.goto("http://127.0.0.1:4173" + route, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const re = new RegExp(pattern, "i");
const report = await page.evaluate((src) => {
  const re = new RegExp(src, "i");
  const out = [];
  for (const el of document.querySelectorAll("button, [role='button']")) {
    const label = el.getAttribute("aria-label") || el.textContent?.trim() || "";
    if (!re.test(label)) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const inside = hit && (el === hit || el.contains(hit));
    const describe = (n) => n ? `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}.${String(n.className).split(" ").slice(0, 3).join(".")}` : "null";
    out.push({ label: label.slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inViewport: r.top >= 0 && r.bottom <= innerHeight, covered: !inside, coveredBy: inside ? "" : describe(hit), pointerEvents: getComputedStyle(el).pointerEvents });
  }
  return out;
}, pattern);
console.log(route, JSON.stringify(report, null, 0));
await browser.close();
