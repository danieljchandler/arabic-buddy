import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Request, Response, Route } from "@playwright/test";

export const SUPABASE_HOST = "ovscskaijvclaxelkdyf.supabase.co";
export const SUPABASE_URL = `https://${SUPABASE_HOST}`;
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92c2Nza2FpanZjbGF4ZWxrZHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjM5NzAsImV4cCI6MjA4NDY5OTk3MH0.8fH3gVx8ft5KvHbeD0ngNs1-ZClg2R7a_juQ0_dwMW0";
export const QA_DIR = dirname(fileURLToPath(import.meta.url));
export const OUT = join(QA_DIR, "output");

export type Layer = "rest" | "storage" | "functions" | "auth" | "realtime" | "app" | "youtube" | "tiktok" | "other";

export interface NetFailure {
  url: string;
  method: string;
  status: number | null; // null = request failed at the network layer
  layer: Layer;
  target: string; // table / bucket+path / function name
  body?: string;
  error?: string;
}

export interface Monitors {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failures: NetFailure[];
  requests: number;
  supabaseRequests: number;
  reset(): void;
}

export function classify(url: string): { layer: Layer; target: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { layer: "other", target: url };
  }
  if (u.host === SUPABASE_HOST) {
    if (u.pathname.startsWith("/rest/v1/rpc/")) return { layer: "rest", target: "rpc:" + u.pathname.split("/")[4] };
    if (u.pathname.startsWith("/rest/v1/")) return { layer: "rest", target: u.pathname.split("/")[3] };
    if (u.pathname.startsWith("/storage/v1/")) return { layer: "storage", target: u.pathname.replace("/storage/v1/", "") };
    if (u.pathname.startsWith("/functions/v1/")) return { layer: "functions", target: u.pathname.split("/")[3] };
    if (u.pathname.startsWith("/auth/v1/")) return { layer: "auth", target: u.pathname.replace("/auth/v1/", "") };
    if (u.pathname.startsWith("/realtime/")) return { layer: "realtime", target: u.pathname };
    return { layer: "other", target: u.pathname };
  }
  if (u.host.includes("youtube") || u.host.includes("ytimg") || u.host.includes("googlevideo")) return { layer: "youtube", target: u.host };
  if (u.host.includes("tiktok")) return { layer: "tiktok", target: u.host };
  if (u.host === "127.0.0.1:4173") return { layer: "app", target: u.pathname };
  return { layer: "other", target: u.host + u.pathname };
}

/** Attach console / page-error / network collectors to a page. */
export function attachMonitors(page: Page): Monitors {
  const m: Monitors = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failures: [],
    requests: 0,
    supabaseRequests: 0,
    reset() {
      m.consoleErrors = [];
      m.consoleWarnings = [];
      m.pageErrors = [];
      m.failures = [];
      m.requests = 0;
      m.supabaseRequests = 0;
    },
  };
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") m.consoleErrors.push(msg.text().slice(0, 400));
    else if (t === "warning") m.consoleWarnings.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => m.pageErrors.push(String(err?.message ?? err).slice(0, 400)));
  page.on("request", (req: Request) => {
    m.requests++;
    if (req.url().includes(SUPABASE_HOST)) m.supabaseRequests++;
  });
  page.on("requestfailed", (req: Request) => {
    const { layer, target } = classify(req.url());
    m.failures.push({ url: req.url().slice(0, 300), method: req.method(), status: null, layer, target, error: req.failure()?.errorText });
  });
  page.on("response", async (res: Response) => {
    if (res.status() < 400) return;
    const req = res.request();
    const { layer, target } = classify(res.url());
    let body: string | undefined;
    try {
      if (layer !== "app" && layer !== "youtube" && layer !== "tiktok") body = (await res.text()).slice(0, 300);
    } catch {
      /* body unavailable */
    }
    m.failures.push({ url: res.url().slice(0, 300), method: req.method(), status: res.status(), layer, target, body });
  });
  return m;
}

/**
 * Serve one intercepted browser request from Node instead of Chromium.
 *
 * Sandboxed containers route outbound HTTPS through an egress relay that
 * resets Chromium's tunnels to supabase.co after a few seconds while Node's
 * fetch (which honours the proxy env) gets through. Replaying the request from
 * Node keeps the crawl honest about the backend: status codes, bodies and
 * headers are the real ones, only the socket is different. SSE bodies arrive
 * in one piece and websockets cannot be relayed — noted in the report.
 */
export async function relayFetch(route: Route): Promise<void> {
  const req = route.request();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(await req.allHeaders())) {
    if (/^(host|content-length|connection|accept-encoding|:.*)$/i.test(k)) continue;
    headers[k] = v;
  }
  const body = req.postDataBuffer();
  try {
    const res = await fetch(req.url(), { method: req.method(), headers, body: body ?? undefined, redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer());
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)) return;
      resHeaders[k] = v;
    });
    await route.fulfill({ status: res.status, headers: resHeaders, body: buf });
  } catch (e) {
    console.error("relayFetch failed", req.method(), req.url().slice(0, 120), String((e as Error).message).slice(0, 120));
    await route.abort("failed").catch(() => undefined);
  }
}

/**
 * Route every Supabase request through relayFetch and drop third-party font
 * CSS (blocked by the egress policy; only slows the page down). Call before
 * the first navigation. `override` lets a spec take over specific requests
 * (e.g. to inject an outage) while everything else still relays.
 */
export async function installBackendRelay(page: Page, override?: (route: Route) => Promise<boolean>): Promise<void> {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort("blockedbyclient"));
  await page.route(/supabase\.co/, async (r) => {
    if (override && (await override(r))) return;
    await relayFetch(r);
  });
}

/** Wait until the page has been quiet for `quietMs` of network activity, or `maxMs` elapses. */
export async function settle(page: Page, maxMs = 15_000, quietMs = 1_200): Promise<void> {
  const start = Date.now();
  let last = Date.now();
  const bump = () => {
    last = Date.now();
  };
  page.on("request", bump);
  page.on("response", bump);
  try {
    while (Date.now() - start < maxMs) {
      if (Date.now() - last > quietMs) break;
      await page.waitForTimeout(200);
    }
  } finally {
    page.off("request", bump);
    page.off("response", bump);
  }
}

export interface PageState {
  finalUrl: string;
  path: string;
  title: string;
  bodyChars: number;
  bodyText: string;
  notFoundText: boolean;
  is404: boolean;
  isBlank: boolean;
  spinnerVisible: boolean;
  errorBoundary: boolean;
  errorTextVisible: boolean;
  emptyStateText: string | null;
  redirectedToAuth: boolean;
  headline: string;
}

export async function readState(page: Page): Promise<PageState> {
  const s = await page.evaluate(() => {
    const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const spinner = Array.from(document.querySelectorAll(".animate-spin, [data-loading='true'], [aria-busy='true']")).some(
      (el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      },
    );
    const h = document.querySelector("h1, h2, [role='heading']");
    const emptyRe = /(nothing here yet|no [a-z ]+ yet|no results|empty|start by|get started|come back|coming soon|not available|no videos|no lessons|no stories|no episodes|no words|no phrases)/i;
    const emptyMatch = text.match(emptyRe);
    return {
      title: document.title,
      bodyChars: text.length,
      bodyText: text.slice(0, 160),
      notFoundText: /not found|doesn'?t exist|no longer available/i.test(text),
      is404: /page not found/i.test(document.title) || /\b404\b/.test(text.slice(0, 200)),
      spinnerVisible: spinner,
      errorBoundary: /couldn't reach the server|something went wrong|went wrong on our end|try reloading/i.test(text),
      errorTextVisible: /(try again|retry|couldn'?t|could not|failed|error|offline|unavailable)/i.test(text),
      emptyStateText: emptyMatch ? emptyMatch[0] : null,
      headline: (h?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    };
  });
  const finalUrl = page.url();
  const path = new URL(finalUrl).pathname;
  return {
    finalUrl,
    path,
    ...s,
    isBlank: s.bodyChars < 25 && !s.notFoundText,
    redirectedToAuth: path === "/auth" || path === "/admin/login",
  };
}

export function slug(path: string): string {
  return path.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]+/g, "_") || "root";
}

export function writeJson(dir: string, name: string, data: unknown): string {
  mkdirSync(join(OUT, dir), { recursive: true });
  const file = join(OUT, dir, name + ".json");
  writeFileSync(file, JSON.stringify(data, null, 1));
  return file;
}

/** Sign in via the auth REST API and inject the session the way supabase-js stores it on localhost. */
export async function injectSession(page: Page, email: string, password: string): Promise<{ userId: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    console.error("QA sign-in failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const session = (await res.json()) as { user: { id: string } };
  const key = `sb-${SUPABASE_HOST.split(".")[0]}-auth-token`;
  await page.addInitScript(
    ({ k, v }: { k: string; v: string }) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    { k: key, v: JSON.stringify(session) },
  );
  return { userId: session.user.id };
}

/** Controls never clicked blind: money, destructive, account, or writes with lasting side effects. */
export const UNSAFE_CONTROL =
  /(sign ?out|log ?out|delete|remove|clear|reset|checkout|subscribe|upgrade|\bpay\b|buy|purchase|submit|save|import|upload|publish|approve|reject|\bban\b|revoke|redeem|report|invite|export|download|follow|unfollow|challenge|accept|decline|block)/i;

/** Controls that fire a paid pipeline (TTS, ASR, LLM). Recorded as "needs live API test" instead of clicked. */
export const PAID_CONTROL =
  /(record|start recording|\bmic\b|microphone|\bcall\b|send|generate|regenerate|translate|\bask\b|\bchat\b|speak|listen|pronounce|play audio|hear|read aloud|shadow|analy[sz]e|explain|coach|feedback|score|grade|quiz me|new story|suggest|volume|speaker|audio|headphones|lucide-(volume|mic|speaker|audio|headphones|sparkles|wand))/i;
