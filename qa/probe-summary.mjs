// Usage: node qa/probe-summary.mjs /route [waitMs] — loads one route through the relay and prints request counts grouped by endpoint.
import { chromium } from "@playwright/test";
const url = process.argv[2]; const waitMs = Number(process.argv[3] ?? 15000);
const browser = await chromium.launch({ args: ["--no-sandbox"], proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } });
const page = await browser.newPage();
await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort("blockedbyclient"));
await page.route(/supabase\.co/, async (route) => {
  const req = route.request(); const headers = {};
  for (const [k, v] of Object.entries(await req.allHeaders())) { if (/^(host|content-length|connection|accept-encoding|:.*)$/i.test(k)) continue; headers[k] = v; }
  try { const res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined, redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer()); const h = {}; res.headers.forEach((v, k) => { if (!/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)) h[k] = v; });
    await route.fulfill({ status: res.status, headers: h, body: buf }); } catch (e) { await route.abort("failed"); }
});
const counts = new Map(); const statuses = new Map();
page.on("request", (r) => { let u; try { u = new URL(r.url()); } catch { return; } const key = r.method() + " " + u.host + u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\/vi\/[^/]+\//, "/vi/:id/") + (u.host.includes("supabase") && u.search ? "?" + u.search.slice(1, 60) : ""); counts.set(key, (counts.get(key) ?? 0) + 1); });
page.on("response", (r) => { if (!r.url().includes("supabase.co")) return; const k = new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id") + " " + r.status(); statuses.set(k, (statuses.get(k) ?? 0) + 1); });
await page.goto("http://127.0.0.1:4173" + url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);
console.log("== requests by endpoint (top 25) ==");
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(5), k.slice(0, 150));
console.log("== supabase statuses ==");
for (const [k, v] of [...statuses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(v).padStart(5), k.slice(0, 120));
console.log("total requests:", [...counts.values()].reduce((a, b) => a + b, 0));
await browser.close();
