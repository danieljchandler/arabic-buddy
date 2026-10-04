import type { Frame, Page } from "@playwright/test";

/**
 * A stand-in for TikTok's `player/v1` iframe that speaks the documented
 * embed protocol (developers.tiktok.com/doc/embed-player): every message is
 * `{ "x-tiktok-player": true, type, value }`, the host sends `play`, `pause`,
 * `seekTo` (seconds) and `mute`, and the player answers with `onPlayerReady`,
 * `onStateChange` (-1 init, 0 ended, 1 playing, 2 paused, 3 buffering) and
 * `onCurrentTime` ({ currentTime, duration }).
 *
 * The real frame is cross-origin and blocked in the hermetic suite, so until
 * this existed the whole audio-to-frame sync in DiscoverVideo — priming the
 * muted autoplay, the one-shot alignment, phrase jumps driving the frame first
 * — ran only in production. The fake keeps a clock that advances while
 * "playing", honours `seekTo`, answers `play` after a short latency the way a
 * real player does, and exposes what it received on `window.__fake` so a spec
 * can read it through the frame.
 *
 * `__fake.stall` (ms) is a buffering hiccup: the player reports buffering (3),
 * its clock freezes for that long, then it reports playing (1) again and
 * resumes from where it stopped — behind the audio, which never paused. The
 * real player does exactly this; what the host sees is a 3, a 1, and a frame
 * that is late.
 *
 * With `autoplayRefused`, the fake does what a browser that blocks even muted
 * autoplay makes the real player do: report `onPlayerError` 3002
 * (AUTOPLAY_ERROR) instead of starting, and ignore every `play` command until
 * a gesture inside the frame — `__fake.tap()` stands in for that tap.
 */
export interface FakeTikTokPlayerOptions {
  autoplayRefused?: boolean;
}

export function fakeTikTokPlayerHtml(options: FakeTikTokPlayerOptions = {}): string {
  return FAKE_TIKTOK_PLAYER_HTML.replace("__AUTOPLAY_REFUSED__", options.autoplayRefused ? "true" : "false");
}

const FAKE_TIKTOK_PLAYER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>fake tiktok player</title></head>
<body style="margin:0;background:#000;color:#0f0;font:12px monospace">
<div id="s"></div>
<script>
(() => {
  const params = new URLSearchParams(location.search);
  const autoplay = params.get("autoplay") === "1";
  const AUTOPLAY_REFUSED = __AUTOPLAY_REFUSED__;
  const DURATION = 30;
  let state = -1;
  let time = 0;
  let last = performance.now();
  let gestureNeeded = false;
  const cmds = [];
  const sent = [];
  const fake = {
    cmds,
    sent,
    stall: 0,
    get state() { return state; },
    get time() { return time; },
    tap() { gestureNeeded = false; if (state !== 1) setState(1); },
  };
  window.__fake = fake;
  const send = (type, value) => {
    if (type !== "onCurrentTime") sent.push({ type, value, at: Math.round(performance.now()) });
    parent.postMessage({ "x-tiktok-player": true, type, value }, "*");
  };
  const setState = (s) => { state = s; send("onStateChange", s); };
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || d["x-tiktok-player"] !== true) return;
    cmds.push({ type: d.type, value: d.value, at: Math.round(performance.now()), frameTime: time });
    switch (d.type) {
      case "play":
        if (gestureNeeded) break;
        if (state !== 1) setTimeout(() => { if (state !== 1) setState(1); }, 120);
        break;
      case "pause":
        if (state === 1 || state === 3) setState(2);
        break;
      case "seekTo":
        time = Math.max(0, Number(d.value) || 0);
        break;
      case "mute":
        send("onMute", true);
        break;
      case "unMute":
        send("onMute", false);
        break;
    }
  });
  setInterval(() => {
    const now = performance.now();
    if (fake.stall > 0 && (state === 1 || state === 3)) {
      if (state === 1) setState(3);
      fake.stall -= now - last;
      if (fake.stall <= 0) { fake.stall = 0; setState(1); }
    } else if (state === 1) {
      time += (now - last) / 1000;
      if (time >= DURATION) { time = DURATION; setState(0); }
    }
    last = now;
    document.getElementById("s").textContent = "state " + state + " t " + time.toFixed(2);
  }, 50);
  setInterval(() => { if (state === 1) send("onCurrentTime", { currentTime: time, duration: DURATION }); }, 250);
  setTimeout(() => {
    send("onPlayerReady");
    if (!autoplay) return;
    if (AUTOPLAY_REFUSED) {
      gestureNeeded = true;
      setTimeout(() => send("onPlayerError", { errorCode: 3002, errorType: "AUTOPLAY_ERROR" }), 150);
      return;
    }
    setTimeout(() => setState(1), 150);
  }, 200);
})();
</script>
</body></html>`;

export interface FakePlayerSnapshot {
  state: number;
  time: number;
  /** What the host sent the player, in order, each with the frame's own clock when it arrived. */
  cmds: Array<{ type: string; value?: unknown; at: number; frameTime: number }>;
  /** What the player told the host, in order — `onCurrentTime` ticks left out. */
  sent: Array<{ type: string; value?: unknown; at: number }>;
}

/** Serve the fake in place of every `player/v1` frame the page opens. */
export async function installFakeTikTokPlayer(page: Page, options: FakeTikTokPlayerOptions = {}): Promise<void> {
  const body = fakeTikTokPlayerHtml(options);
  await page.route("https://www.tiktok.com/player/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body }),
  );
}

/** The frame running the fake with the app's full parameter set (the primed one). */
export function fakePlayerFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => /tiktok\.com\/player\/v1\/\d+\?.*autoplay=1/.test(f.url()));
}

export async function readFakePlayer(page: Page): Promise<FakePlayerSnapshot | null> {
  const frame = fakePlayerFrame(page);
  if (!frame) return null;
  try {
    return await frame.evaluate(() => {
      const f = (
        window as unknown as {
          __fake?: { state: number; time: number; cmds: FakePlayerSnapshot["cmds"]; sent: FakePlayerSnapshot["sent"] };
        }
      ).__fake;
      return f ? { state: f.state, time: f.time, cmds: [...f.cmds], sent: [...f.sent] } : null;
    });
  } catch {
    return null;
  }
}

export async function stallFakePlayer(page: Page, ms: number): Promise<void> {
  const frame = fakePlayerFrame(page);
  if (!frame) throw new Error("fake player frame not mounted");
  await frame.evaluate((n) => {
    (window as unknown as { __fake: { stall: number } }).__fake.stall = n;
  }, ms);
}

/** The `onStateChange` values the player has reported, in order. */
export function reportedStates(snapshot: FakePlayerSnapshot): number[] {
  return snapshot.sent.filter((m) => m.type === "onStateChange").map((m) => Number(m.value));
}

/** A tap on the player's own play button — the gesture inside the frame. */
export async function tapFakePlayer(page: Page): Promise<void> {
  const frame = fakePlayerFrame(page);
  if (!frame) throw new Error("fake player frame not mounted");
  await frame.evaluate(() => {
    (window as unknown as { __fake: { tap: () => void } }).__fake.tap();
  });
}
