import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROUTES, concreteUrl, type RouteSpec } from "../src/test/support/routes/manifest";
import {
  ANON_KEY,
  OUT,
  PAID_CONTROL,
  SUPABASE_URL,
  UNSAFE_CONTROL,
  attachMonitors,
  injectSession,
  installBackendRelay,
  readState,
  settle,
  slug,
  writeJson,
  type PageState,
} from "./support";

/**
 * Route crawl against the live backend. One test per route so a hang on one
 * page never hides the rest. Writes qa/output/routes/<slug>.json per route and
 * a screenshot per distinct state; qa/report.mjs merges them.
 */

const QA_EMAIL = process.env.QA_EMAIL;
const QA_PASSWORD = process.env.QA_PASSWORD;
const ONLY = process.env.QA_ROUTES?.split(",").map((s) => s.trim()).filter(Boolean);
const MAX_CONTROLS = 40;

interface LiveIds {
  youtubeVideo?: string;
  tiktokVideo?: string;
  story?: string;
  authenticStory?: string;
  lesson?: string;
  stage?: string;
}

let liveIdsPromise: Promise<LiveIds> | null = null;
async function getLiveIds(): Promise<LiveIds> {
  if (!liveIdsPromise) {
    liveIdsPromise = (async () => {
      const ids: LiveIds = {};
      const q = async (path: string): Promise<Array<Record<string, string>>> => {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
          });
          return r.ok ? ((await r.json()) as Array<Record<string, string>>) : [];
        } catch {
          return [];
        }
      };
      ids.youtubeVideo = (await q("discover_videos?select=id&platform=eq.youtube&published=eq.true&limit=1"))[0]?.id;
      ids.tiktokVideo = (await q("discover_videos?select=id&platform=eq.tiktok&published=eq.true&limit=1"))[0]?.id;
      ids.story = (await q("interactive_stories?select=id&status=eq.published&limit=1"))[0]?.id;
      ids.authenticStory = (await q("authentic_stories?select=id&status=eq.published&limit=1"))[0]?.id;
      ids.lesson = (await q("lessons?select=id&limit=1"))[0]?.id;
      ids.stage = (await q("curriculum_stages?select=id&limit=1"))[0]?.id;
      return ids;
    })();
  }
  return liveIdsPromise;
}

/** Concrete URLs to crawl for a manifest route, substituting live ids where we have them. */
async function urlsFor(route: RouteSpec): Promise<Array<{ url: string; label: string }>> {
  if (route.path === "*") return [{ url: "/a-path-that-does-not-exist", label: "*" }];
  const ids = await getLiveIds();
  const sub = (params: Record<string, string>) => concreteUrl({ ...route, params: { ...route.params, ...params } });
  switch (route.path) {
    case "/discover/:videoId": {
      const out: Array<{ url: string; label: string }> = [];
      if (ids.youtubeVideo) out.push({ url: sub({ videoId: ids.youtubeVideo }), label: "/discover/:videoId (youtube)" });
      if (ids.tiktokVideo) out.push({ url: sub({ videoId: ids.tiktokVideo }), label: "/discover/:videoId (tiktok)" });
      out.push({ url: concreteUrl(route), label: "/discover/:videoId (unknown id)" });
      return out;
    }
    case "/stories/:storyId":
      return [{ url: ids.story ? sub({ storyId: ids.story }) : concreteUrl(route), label: route.path }];
    case "/reading-library/:id":
      return [{ url: ids.authenticStory ? sub({ id: ids.authenticStory }) : concreteUrl(route), label: route.path }];
    case "/learn/:lessonId":
    case "/quiz/:lessonId":
      return [{ url: ids.lesson ? sub({ lessonId: ids.lesson }) : concreteUrl(route), label: route.path + (ids.lesson ? "" : " (no lessons exist)") }];
    default:
      return [{ url: concreteUrl(route), label: route.path }];
  }
}

interface ControlResult {
  index: number;
  label: string;
  kind: string;
  action: "clicked" | "skipped-unsafe" | "needs-live-api-test" | "click-failed";
  outcome?: "navigated" | "dialog" | "dom-changed" | "network" | "no-op";
  navigatedTo?: string;
  mutations?: number;
  requests?: number;
  newFailures?: number;
  error?: string;
}

async function tagControls(page: Page): Promise<Array<{ index: number; label: string; kind: string }>> {
  return page.evaluate(() => {
    const sel = "button, [role='button'], [role='tab'], [role='switch'], [role='menuitem'], summary, input[type='checkbox'], input[type='radio']";
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const out: Array<{ index: number; label: string; kind: string }> = [];
    let i = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").replace(/\s+/g, " ").trim() ||
        el.getAttribute("data-testid") ||
        (el.querySelector("svg")?.getAttribute("class") ?? "").split(" ").find((c) => c.startsWith("lucide-")) ||
        "(unlabeled)";
      el.setAttribute("data-qa-idx", String(i));
      out.push({ index: i, label: label.slice(0, 60), kind: el.tagName.toLowerCase() + (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : "") });
      i++;
    }
    return out;
  });
}

async function ensureObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __qaMut?: number; __qaObs?: MutationObserver };
    if (w.__qaObs) return;
    w.__qaMut = 0;
    w.__qaObs = new MutationObserver((list) => {
      w.__qaMut = (w.__qaMut ?? 0) + list.length;
    });
    w.__qaObs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

async function snapshot(page: Page): Promise<{ mut: number; dialogs: number; path: string }> {
  return page.evaluate(() => ({
    mut: (window as unknown as { __qaMut?: number }).__qaMut ?? 0,
    dialogs: document.querySelectorAll("[role='dialog'], [role='alertdialog'], [data-state='open'][role='menu'], [data-radix-popper-content-wrapper], [role='listbox']").length,
    path: location.pathname,
  }));
}

async function clickSweep(page: Page, monitors: ReturnType<typeof attachMonitors>, homeUrl: string): Promise<ControlResult[]> {
  const results: ControlResult[] = [];
  let controls = await tagControls(page);
  const total = controls.length;
  controls = controls.slice(0, MAX_CONTROLS);
  for (const c of controls) {
    if (UNSAFE_CONTROL.test(c.label)) {
      results.push({ ...c, action: "skipped-unsafe" });
      continue;
    }
    if (PAID_CONTROL.test(c.label)) {
      results.push({ ...c, action: "needs-live-api-test" });
      continue;
    }
    await ensureObserver(page);
    const before = await snapshot(page);
    const reqBefore = monitors.requests;
    const failBefore = monitors.failures.length;
    const el = page.locator(`[data-qa-idx="${c.index}"]`).first();
    try {
      // 8s, not 3: the first run's click-failed list turned out to be page
      // transitions and TTS-triggered re-renders, not covered controls
      // (qa/probe-overlap.mjs found nothing over any of them).
      await el.click({ timeout: 8000, noWaitAfter: true });
    } catch (e) {
      results.push({ ...c, action: "click-failed", error: String((e as Error).message).split("\n")[0].slice(0, 120) });
      continue;
    }
    await page.waitForTimeout(700);
    let after: { mut: number; dialogs: number; path: string };
    try {
      after = await snapshot(page);
    } catch {
      after = { mut: before.mut + 1, dialogs: 0, path: new URL(page.url()).pathname };
    }
    const r: ControlResult = {
      ...c,
      action: "clicked",
      mutations: after.mut - before.mut,
      requests: monitors.requests - reqBefore,
      newFailures: monitors.failures.length - failBefore,
    };
    if (after.path !== before.path) {
      r.outcome = "navigated";
      r.navigatedTo = after.path;
      await page.goto(homeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await settle(page, 8000);
      await tagControls(page);
    } else if (after.dialogs > before.dialogs) {
      r.outcome = "dialog";
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(300);
      const still = await snapshot(page).catch(() => before);
      if (still.dialogs > before.dialogs) {
        await page.mouse.click(2, 2).catch(() => undefined);
        await page.waitForTimeout(200);
      }
    } else if (r.mutations && r.mutations > 0) {
      r.outcome = "dom-changed";
    } else if (r.requests && r.requests > 0) {
      r.outcome = "network";
    } else {
      r.outcome = "no-op";
    }
    results.push(r);
  }
  if (total > MAX_CONTROLS) results.push({ index: -1, label: `(${total - MAX_CONTROLS} more controls not exercised)`, kind: "note", action: "skipped-unsafe" });
  return results;
}

mkdirSync(join(OUT, "screens"), { recursive: true });

const selected = ROUTES.filter((r) => !ONLY || ONLY.includes(r.path));

for (const route of selected) {
  test(`crawl ${route.path}`, async ({ page }) => {
    const targets = await urlsFor(route);
    let authed: { userId: string } | null = null;
    if (QA_EMAIL && QA_PASSWORD) authed = await injectSession(page, QA_EMAIL, QA_PASSWORD);
    await installBackendRelay(page);
    const monitors = attachMonitors(page);

    for (const t of targets) {
      monitors.reset();
      const startedAt = Date.now();
      let navError: string | undefined;
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e) => {
        navError = String((e as Error).message).split("\n")[0];
      });
      await settle(page);
      let state: PageState = await readState(page);
      let infiniteLoader = false;
      if (state.spinnerVisible) {
        await page.waitForTimeout(10_000);
        const again = await readState(page);
        infiniteLoader = again.spinnerVisible && again.bodyChars - state.bodyChars < 40;
        state = again;
      }
      const loadMs = Date.now() - startedAt;
      const shot = join(OUT, "screens", slug(t.label) + (authed ? ".auth" : ".anon") + ".png");
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);

      const links: string[] = await page.evaluate(() =>
        Array.from(new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/")))),
      );
      const inventory = await page.evaluate(() => ({
        buttons: document.querySelectorAll("button, [role='button']").length,
        links: document.querySelectorAll("a[href]").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
        tabs: document.querySelectorAll("[role='tab']").length,
        forms: document.querySelectorAll("form").length,
        media: document.querySelectorAll("video, audio, iframe").length,
      }));

      const loadFailures = [...monitors.failures];
      const loadConsole = [...monitors.consoleErrors];
      const loadPageErrors = [...monitors.pageErrors];
      const loadSupabaseRequests = monitors.supabaseRequests;

      let controls: ControlResult[] = [];
      const expectedRedirect = route.redirectsTo && state.path === route.redirectsTo;
      if (!state.is404 && !state.isBlank && !state.redirectedToAuth && !navError && !expectedRedirect) {
        controls = await clickSweep(page, monitors, t.url);
      }

      writeJson("routes", slug(t.label) + (authed ? ".auth" : ".anon"), {
        route: route.path,
        label: t.label,
        gate: route.gate,
        url: t.url,
        authed: Boolean(authed),
        navError,
        loadMs,
        state,
        infiniteLoader,
        expectedRedirect: route.redirectsTo ?? null,
        screenshot: shot,
        inventory,
        links,
        load: { failures: loadFailures, consoleErrors: loadConsole, pageErrors: loadPageErrors, supabaseRequests: loadSupabaseRequests },
        interaction: {
          controls,
          failures: monitors.failures.slice(loadFailures.length),
          consoleErrors: monitors.consoleErrors.slice(loadConsole.length),
          pageErrors: monitors.pageErrors.slice(loadPageErrors.length),
        },
      });
    }
  });
}
