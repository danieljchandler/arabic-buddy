import { test } from "@playwright/test";
import { join } from "node:path";
import { ANON_KEY, OUT, SUPABASE_URL, attachMonitors, injectSession, installBackendRelay, readState, settle, writeJson } from "./support";

/**
 * Phase 4.9 — do videos and audio actually load and play from the live backend?
 *
 * Paid pipelines (TTS, ASR) are not exercised unless QA_ALLOW_PAID=1; they are
 * recorded as "needs live API test" with the control that would trigger them.
 */

const QA_EMAIL = process.env.QA_EMAIL;
const QA_PASSWORD = process.env.QA_PASSWORD;
const ALLOW_PAID = process.env.QA_ALLOW_PAID === "1";

interface VideoRow {
  id: string;
  platform: string;
  source_url: string | null;
  embed_url: string | null;
  thumbnail_url: string | null;
  transcript_lines: Array<{ startMs?: number; endMs?: number; start_ms?: number; end_ms?: number; words?: Array<{ startMs?: number; start_ms?: number }> }> | null;
}

async function rest<T>(path: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
  return r.ok ? ((await r.json()) as T[]) : [];
}

function timingStats(lines: VideoRow["transcript_lines"]) {
  const arr = lines ?? [];
  const withLine = arr.filter((l) => (l.startMs ?? l.start_ms) !== undefined && (l.endMs ?? l.end_ms) !== undefined).length;
  const withWords = arr.filter((l) => Array.isArray(l.words) && l.words.some((w) => (w.startMs ?? w.start_ms) !== undefined)).length;
  let monotonic = true;
  let prev = -1;
  for (const l of arr) {
    const s = l.startMs ?? l.start_ms;
    if (s === undefined) continue;
    if (s < prev) monotonic = false;
    prev = s;
  }
  return { lines: arr.length, withLineTiming: withLine, withWordTiming: withWords, monotonic };
}

for (const platform of ["youtube", "tiktok"]) {
  test(`video playback ${platform}`, async ({ page }) => {
    const rows = await rest<VideoRow>(`discover_videos?select=id,platform,source_url,embed_url,thumbnail_url,transcript_lines&platform=eq.${platform}&published=eq.true&limit=1`);
    test.skip(rows.length === 0, `no published ${platform} video`);
    const video = rows[0];
    if (QA_EMAIL && QA_PASSWORD) await injectSession(page, QA_EMAIL, QA_PASSWORD);
    await installBackendRelay(page);
    const monitors = attachMonitors(page);
    await page.goto(`/discover/${video.id}`, { waitUntil: "domcontentloaded" });
    await settle(page, 20_000);
    await page.waitForTimeout(3000);
    const state = await readState(page);

    const media = await page.evaluate(() => ({
      iframes: Array.from(document.querySelectorAll("iframe")).map((f) => ({ src: (f.src || "").slice(0, 120), w: f.clientWidth, h: f.clientHeight })),
      videos: Array.from(document.querySelectorAll("video")).map((v) => ({ src: (v.currentSrc || v.src || "").slice(0, 120), readyState: v.readyState, networkState: v.networkState, error: v.error?.code ?? null, paused: v.paused })),
      audios: Array.from(document.querySelectorAll("audio")).map((a) => ({ src: (a.currentSrc || a.src || "").slice(0, 120), readyState: a.readyState, networkState: a.networkState, error: a.error?.code ?? null })),
      transcriptLinesRendered: document.querySelectorAll("[data-line-id], [data-testid*='transcript'], [class*='transcript'] [dir='rtl']").length,
      rtlBlocks: document.querySelectorAll("[dir='rtl']").length,
      playControls: Array.from(document.querySelectorAll("button"))
        .map((b) => b.getAttribute("aria-label") || b.textContent?.trim() || "")
        .filter((t) => /play|pause|listen|speak|slow|shadow|repeat/i.test(t))
        .slice(0, 15),
    }));

    // Try the first play-ish control once (video playback itself is not a paid call).
    let playAttempt: Record<string, unknown> | null = null;
    const playBtn = page.getByRole("button", { name: /^play$|play video|play\b/i }).first();
    if (await playBtn.isVisible().catch(() => false)) {
      const reqBefore = monitors.requests;
      await playBtn.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(4000);
      playAttempt = {
        newRequests: monitors.requests - reqBefore,
        videos: await page.evaluate(() => Array.from(document.querySelectorAll("video")).map((v) => ({ paused: v.paused, currentTime: v.currentTime, readyState: v.readyState, error: v.error?.code ?? null }))),
        youtubeRequests: monitors.failures.filter((f) => f.layer === "youtube").length,
      };
    }

    // TTS / audio pipelines: flag, do not spend.
    const ttsControl = page.getByRole("button", { name: /listen|speak|pronounce|hear|read aloud/i }).first();
    let tts: Record<string, unknown> = { status: "needs live API test", control: null };
    if (await ttsControl.isVisible().catch(() => false)) {
      tts.control = await ttsControl.getAttribute("aria-label").catch(() => null);
      if (ALLOW_PAID) {
        const before = monitors.requests;
        await ttsControl.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(10_000);
        tts = {
          status: "exercised once",
          control: tts.control,
          newRequests: monitors.requests - before,
          functionFailures: monitors.failures.filter((f) => f.layer === "functions"),
          audioPlaying: await page.evaluate(() => Array.from(document.querySelectorAll("audio")).some((a) => !a.paused && a.currentTime > 0)),
        };
      }
    }

    const shot = join(OUT, "screens", `media_${platform}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    writeJson("media", `video_${platform}`, {
      video: { id: video.id, platform, source_url: video.source_url, thumbnail_url: video.thumbnail_url },
      timing: timingStats(video.transcript_lines),
      state,
      media,
      playAttempt,
      tts,
      storageFailures: monitors.failures.filter((f) => f.layer === "storage"),
      functionFailures: monitors.failures.filter((f) => f.layer === "functions"),
      restFailures: monitors.failures.filter((f) => f.layer === "rest"),
      externalFailures: monitors.failures.filter((f) => f.layer === "youtube" || f.layer === "tiktok" || f.layer === "other"),
      consoleErrors: monitors.consoleErrors.slice(0, 15),
      pageErrors: monitors.pageErrors,
      screenshot: shot,
    });
  });
}

test("listen episode audio (auth only)", async ({ page }) => {
  test.skip(!QA_EMAIL || !QA_PASSWORD, "needs a signed-in learner");
  await injectSession(page, QA_EMAIL!, QA_PASSWORD!);
  await installBackendRelay(page);
  const monitors = attachMonitors(page);
  await page.goto("/listen", { waitUntil: "domcontentloaded" });
  await settle(page, 20_000);
  const first = page.locator("a[href^='/listen/']").first();
  const href = await first.getAttribute("href").catch(() => null);
  if (href) {
    await page.goto(href, { waitUntil: "domcontentloaded" });
    await settle(page, 20_000);
  }
  const audios = await page.evaluate(() => Array.from(document.querySelectorAll("audio")).map((a) => ({ src: (a.currentSrc || a.src || "").slice(0, 160), readyState: a.readyState, error: a.error?.code ?? null })));
  const heads: Array<{ src: string; status: number }> = [];
  for (const a of audios) {
    if (!a.src.startsWith("http")) continue;
    const r = await fetch(a.src, { method: "HEAD" }).catch(() => null);
    heads.push({ src: a.src, status: r?.status ?? 0 });
  }
  writeJson("media", "listen_episode", { href, audios, heads, storageFailures: monitors.failures.filter((f) => f.layer === "storage"), consoleErrors: monitors.consoleErrors.slice(0, 10) });
});
