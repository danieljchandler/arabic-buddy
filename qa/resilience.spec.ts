import { test, type Page, type Route } from "@playwright/test";
import { join } from "node:path";
import { OUT, attachMonitors, injectSession, installBackendRelay, readState, relayFetch, slug, writeJson } from "./support";

/**
 * Phase 4.10 — what does the UI do when Supabase is slow, down, or unreachable?
 *
 * Three modes per route:
 *   backend-500   every REST/functions/storage call answers 500
 *   network-drop  every Supabase call fails at the network layer
 *   slow-4s       every Supabase call is delayed 4s (is there a loading state? does content arrive?)
 *
 * Verdicts: error-shown | infinite-spinner | silent-empty | looks-normal | blank | no-loading-indicator
 */

const QA_EMAIL = process.env.QA_EMAIL;
const QA_PASSWORD = process.env.QA_PASSWORD;

const PUBLIC_ROUTES = ["/", "/today", "/choose", "/discover", "/curriculum", "/stories", "/set-phrases", "/leaderboard", "/pricing", "/daily-challenge", "/alphabet"];
const AUTH_ROUTES = ["/review", "/me", "/my-words", "/settings", "/listen", "/friends"];
const routes = QA_EMAIL && QA_PASSWORD ? [...PUBLIC_ROUTES, ...AUTH_ROUTES] : PUBLIC_ROUTES;


function verdict(s: Awaited<ReturnType<typeof readState>>): string {
  if (s.isBlank) return "blank";
  if (s.errorBoundary || s.errorTextVisible) return "error-shown";
  if (s.spinnerVisible) return "infinite-spinner";
  if (s.emptyStateText) return "silent-empty";
  return "looks-normal";
}

async function run(page: Page, path: string, mode: string, handler: (r: Route) => Promise<void>) {
  if (QA_EMAIL && QA_PASSWORD) await injectSession(page, QA_EMAIL, QA_PASSWORD);
  const monitors = attachMonitors(page);
  // Let auth endpoints through (relayed) so the session, if any, still resolves; break data only.
  await installBackendRelay(page, async (r) => {
    if (r.request().url().includes("/auth/v1/")) return false;
    await handler(r);
    return true;
  });
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  let early: Awaited<ReturnType<typeof readState>> | null = null;
  if (mode === "slow-4s") {
    await page.waitForTimeout(1500);
    early = await readState(page);
  }
  await page.waitForTimeout(mode === "slow-4s" ? 12_000 : 10_000);
  const state = await readState(page);
  const shot = join(OUT, "screens", `resilience_${mode}_${slug(path)}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);
  let v = verdict(state);
  if (mode === "slow-4s" && early && !early.spinnerVisible && early.bodyChars < 80) v = "no-loading-indicator";
  writeJson("resilience", `${mode}_${slug(path)}`, {
    path,
    mode,
    verdict: v,
    early,
    state,
    screenshot: shot,
    consoleErrors: monitors.consoleErrors.slice(0, 10),
    pageErrors: monitors.pageErrors.slice(0, 10),
    failures: monitors.failures.length,
  });
}

for (const path of routes) {
  test(`backend-500 ${path}`, async ({ page }) => {
    await run(page, path, "backend-500", (r) =>
      r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "qa injected outage" }) }),
    );
  });
  test(`network-drop ${path}`, async ({ page }) => {
    await run(page, path, "network-drop", (r) => r.abort("failed"));
  });
  test(`slow-4s ${path}`, async ({ page }) => {
    await run(page, path, "slow-4s", async (r) => {
      await new Promise((res) => setTimeout(res, 4000));
      await relayFetch(r);
    });
  });
}
