import { chromium } from "@playwright/test";
const url = process.argv[2]; const waitMs = Number(process.argv[3] ?? 20000);
const browser = await chromium.launch({ args: ["--no-sandbox"], proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } });
const page = await browser.newPage();
await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort("blockedbyclient"));
await page.route(/supabase\.co/, async (route) => {
  const req = route.request(); const headers = {};
  for (const [k, v] of Object.entries(await req.allHeaders())) { if (/^(host|content-length|connection|accept-encoding|:.*)$/i.test(k)) continue; headers[k] = v; }
  try { const res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined, redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer()); const h = {}; res.headers.forEach((v, k) => { if (!/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)) h[k] = v; });
    await route.fulfill({ status: res.status, headers: h, body: buf }); } catch (e) { console.log("RELAY FAIL", req.url().slice(0,100), e.message); await route.abort("failed"); }
});
const t0 = Date.now();
page.on("request", r => { if (r.url().includes("supabase.co")) console.log(`${Date.now()-t0}ms REQ ${r.method()} ${r.url().replace(/^https:\/\/[^/]+/, "").slice(0,160)}`); });
page.on("response", async r => { if (r.url().includes("supabase.co")) { let b=""; try { b=(await r.text()).slice(0,120);} catch{} console.log(`${Date.now()-t0}ms RES ${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, "").slice(0,100)} :: ${b.replace(/\n/g," ")}`);} });
page.on("requestfailed", r => { if (r.url().includes("supabase.co")) console.log(`${Date.now()-t0}ms FAIL ${r.url().slice(0,120)} ${r.failure()?.errorText}`); });
page.on("console", m => { if (m.type()==="error"||m.type()==="warning") console.log(`${Date.now()-t0}ms CONSOLE[${m.type()}] ${m.text().slice(0,200)}`); });
page.on("pageerror", e => console.log(`${Date.now()-t0}ms PAGEERROR ${e.message.slice(0,200)}`));
await page.goto("http://127.0.0.1:4173" + url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").slice(0,300));
console.log("BODY:", text);
console.log("SPINNER:", await page.evaluate(() => !!document.querySelector(".animate-spin")));
await browser.close();
