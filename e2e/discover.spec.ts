import { expect, test, type Page } from "./support/fixtures";
import { aDiscoverVideo, aProfile, videoId, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";
import {
  installFakeTikTokPlayer,
  readFakePlayer,
  reportedStates,
  stallFakePlayer,
  tapFakePlayer,
} from "./support/fakeTikTokPlayer";

/**
 * Discover — the video library and the personalised feed.
 *
 * Two independent surfaces behind one page. Browse is a plain filtered query,
 * and every filter it applies is a `.eq`/`.in`/`.ilike` the backend has to
 * honour for the result to mean anything — a filter that silently does nothing
 * shows a learner the whole catalogue and looks like it worked. The For You tab
 * is an edge function that returns ranked ids, which the page then hydrates from
 * the table; an id the hydration cannot resolve has to be dropped rather than
 * rendered as a blank card.
 *
 * Feed items are hidden behind a tab that is only enabled when signed in, and
 * Browse defaults its difficulty filter from the learner's placement level —
 * both of which decide what the page shows before the learner touches anything.
 */

/** `count` published videos, all Gulf/Beginner unless overridden. */
function seedVideos(
  db: MemoryDb,
  rows: Array<Record<string, unknown>>,
) {
  db.seed(
    "discover_videos",
    rows.map((row, index) => aDiscoverVideo({ id: videoId(index), ...row })),
  );
}

/** Answer the feed function with ranked ids. */
function stubFeed(
  backend: SupabaseBackend,
  items: Array<{ video_id: string; reason?: string; comprehension?: number }>,
  coldStart = false,
) {
  backend.stubFunction("discover-feed", {
    items: items.map((item, index) => ({
      video_id: item.video_id,
      score: 1 - index * 0.1,
      comprehension: item.comprehension ?? 0.8,
      reason: item.reason ?? "Matches your level",
      bucket: "match",
    })),
    cold_start: coldStart,
    seed: 1,
  });
}

/** Switch to the Browse tab. */
const browse = (page: Page) => page.getByRole("tab", { name: "Browse" }).click();

/**
 * Switch to the For You tab.
 *
 * Needed explicitly because the page does not open on it — see "opens on
 * Browse even for a signed-in learner" below.
 */
const forYou = (page: Page) => page.getByRole("tab", { name: /For You/ }).click();

test.describe("browsing the library", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    // No placement, so Browse defaults to "All" and the filters under test are
    // the only thing narrowing the list.
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);
    stubFeed(backend, []);
  });

  test("lists published videos", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }, { title: "Market talk" }]);

    await page.goto("/discover");
    await browse(page);

    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Market talk/ })).toBeVisible();
  });

  test("hides an unpublished video", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Live one", published: true },
      { title: "Draft one", published: false },
    ]);

    await page.goto("/discover");
    await browse(page);

    // Unpublished means unfinished — usually a video still being transcribed.
    await expect(page.getByRole("button", { name: /Live one/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Draft one/ })).toHaveCount(0);
  });

  test("narrows to a dialect", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Gulf clip", dialect: "Gulf" },
      { title: "Egyptian clip", dialect: "Egyptian" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian", exact: true }).click();

    await expect(page.getByRole("button", { name: /Egyptian clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Gulf clip/ })).toHaveCount(0);
  });

  test("narrows to a difficulty", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Advanced", exact: true }).click();

    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Easy clip/ })).toHaveCount(0);
  });

  test("searches titles case-insensitively and by substring", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }, { title: "Market talk" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByLabel("Search videos").fill("coffee");

    // `ilike %term%` — a search that only matched a prefix, or matched case
    // exactly, would find nothing for most of what a learner types.
    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Market talk/ })).toHaveCount(0);
  });

  test("combines a search with a filter rather than replacing it", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Coffee in Kuwait", dialect: "Gulf" },
      { title: "Coffee in Cairo", dialect: "Egyptian" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian", exact: true }).click();
    await page.getByLabel("Search videos").fill("coffee");

    await expect(page.getByRole("button", { name: /Coffee in Cairo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toHaveCount(0);
  });

  test("says so when nothing matches", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByLabel("Search videos").fill("nothing like this");

    await expect(page.getByText("No videos found")).toBeVisible();
  });

  test("does not claim an empty library when the query failed", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);
    db.failAlways("discover_videos", 500);

    await page.goto("/discover");
    await browse(page);

    // "Check back later for new content" after a failed request tells the
    // learner the catalogue is empty when it is full.
    await expect(page.getByText("No videos found")).toHaveCount(0);
  });

  test("opens a video", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("button", { name: /Coffee in Kuwait/ }).click();

    await expect(page).toHaveURL(new RegExp(`/discover/${videoId(0)}$`));
  });

  test("labels each card with what it is, for a screen reader", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait", dialect: "Gulf", difficulty: "Beginner" }]);

    await page.goto("/discover");
    await browse(page);

    // A grid of thumbnails is unusable without this — the accessible name is
    // the only thing distinguishing one card from the next.
    await expect(
      page.getByRole("button", { name: "Video: Coffee in Kuwait — Gulf, Beginner" }),
    ).toBeVisible();
  });
});

test.describe("the difficulty a learner starts on", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubFeed(backend, []);
  });

  test("defaults to the placement level once it resolves", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level_gulf: "C1" })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);

    // The filter cannot be set in a useState initialiser — the profile query
    // has not resolved on first render, so an initialiser locks to "All" and
    // hands a C1 learner the beginner catalogue. The default is applied once
    // by effect when placement lands. (A previous version of this test pinned
    // the initialiser bug in place; the effect is the fix it was waiting for.)
    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Easy clip/ })).toHaveCount(0);
  });

  test("shows everything to a learner who has not placed", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);

    await expect(page.getByRole("button", { name: /Easy clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
  });

  test("narrows once the learner picks a level themselves", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level_gulf: "C1" })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Advanced", exact: true }).click();

    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Easy clip/ })).toHaveCount(0);
  });
});

test.describe("the personalised feed", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("opens on Browse even for a signed-in learner", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }]);

    await page.goto("/discover");

    // Recording current behaviour, and the same mistake as the difficulty
    // default above. `useState(user ? "feed" : "browse")` runs on the first
    // render, when useAuth has not resolved and `user` is null, so the tab
    // locks to Browse and nothing revises it. The personalised feed the page
    // is built around is never what a learner lands on.
    //
    // This test fails once the tab is derived from the resolved session.
    await expect(page.getByRole("tab", { name: "Browse" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("hydrates each ranked id from the table", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "First pick" }, { title: "Second pick" }]);
    stubFeed(backend, [{ video_id: videoId(1) }, { video_id: videoId(0) }]);

    await page.goto("/discover");
    await forYou(page);

    // The function returns ids and scores only; the titles, thumbnails and
    // badges all come from the table.
    await expect(page.getByRole("button", { name: /First pick/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Second pick/ })).toBeVisible();
  });

  test("shows the reason a video was picked", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0), reason: "Because you saved قهوة" }]);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText("Because you saved قهوة")).toBeVisible();
  });

  test("drops a ranked id the table cannot resolve", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Real clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }, { video_id: videoId(7) }]);

    await page.goto("/discover");
    await forYou(page);

    // A deleted or unpublished video still in the ranking must vanish, not
    // render as a card with no title that goes nowhere.
    await expect(page.getByRole("button", { name: /Real clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Video: —/ })).toHaveCount(0);
  });

  test("explains a cold start rather than looking broken", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Trending clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }], true);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText(/take the placement quiz to personalize/i)).toBeVisible();
  });

  test("re-ranks with a new seed when shuffled", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }]);

    await page.goto("/discover");
    await forYou(page);
    await expect(page.getByRole("button", { name: /Ranked clip/ })).toBeVisible();

    await page.getByRole("button", { name: /shuffle/i }).click();

    await expect.poll(() => backend.callsTo("discover-feed").length).toBe(2);
    const calls = backend.callsTo("discover-feed");
    const seeds = calls.map((call) => (call.body as { seed: number }).seed);
    // A shuffle that reused the seed would return the identical ranking and
    // read as a dead button.
    expect(seeds[1]).not.toBe(seeds[0]);
  });

  test("says so when there is nothing to recommend yet", async ({ page, backend, db }) => {
    seedVideos(db, []);
    stubFeed(backend, []);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText("No personalized picks yet")).toBeVisible();
  });

  test("is not offered to a signed-out visitor", async ({ page, signInAs, backend, db }) => {
    await signInAs("anonymous");
    seedVideos(db, [{ title: "Public clip" }]);

    await page.goto("/discover");

    // The feed is per-learner, so there is nothing to rank. Browse still works.
    await expect(page.getByRole("tab", { name: /For You/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Public clip/ })).toBeVisible();
    expect(backend.callsTo("discover-feed")).toHaveLength(0);
  });
});

test.describe("requesting content", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
    db.seed("content_requests", []);
    stubFeed(backend, []);
    seedVideos(db, []);
  });

  /**
   * Submitted with Enter rather than the send control, which is an icon-only
   * button with no accessible name — one of the unlabelled buttons the a11y
   * baseline already counts. Enter is a path the component supports on purpose.
   */
  /** The request input, distinguished from the Browse search box beside it. */
  const requestBox = (page: Page) => page.getByPlaceholder(/describe a video|creator|topic/i);

  async function submitRequest(page: Page, text: string) {
    await page.getByRole("button", { name: /request content/i }).click();
    await requestBox(page).fill(text);
    await requestBox(page).press("Enter");
  }

  test("records what the learner asked for", async ({ page, db }) => {
    await page.goto("/discover");
    await submitRequest(page, "More Kuwaiti cooking shows please");

    await expect(page.getByText(/request submitted/i)).toBeVisible();

    const request = db.rows("content_requests")[0];
    expect(request.user_id).toBe(TEST_USER_ID);
    expect(request.body).toBe("More Kuwaiti cooking shows please");
    expect(request.request_type).toBe("video");
  });

  test("records which kind of thing was asked for", async ({ page, db }) => {
    await page.goto("/discover");
    await page.getByRole("button", { name: /request content/i }).click();
    await page.getByRole("button", { name: /^creator$/i }).click();
    await requestBox(page).fill("Anything by this creator");
    await requestBox(page).press("Enter");

    await expect(page.getByText(/request submitted/i)).toBeVisible();
    // The type is what routes the request to the right admin queue; defaulting
    // everything to "video" would bury creator and topic asks.
    expect(db.rows("content_requests")[0].request_type).toBe("creator");
  });

  test("caps the request at the length the column accepts", async ({ page, db }) => {
    await page.goto("/discover");
    await submitRequest(page, "x".repeat(600));

    await expect(page.getByText(/request submitted/i)).toBeVisible();
    // The input carries maxLength=500, so the over-length text is truncated
    // before it reaches the handler and the handler's own "too long" guard
    // never fires. Belt and braces rather than dead code — the guard still
    // covers a paste that bypasses the attribute — but what a learner actually
    // experiences is a silent truncation.
    expect(String(db.rows("content_requests")[0].body)).toHaveLength(500);
  });

  test("keeps the text when the submission fails", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/Request error/]);

    await page.goto("/discover");
    db.failWrites("content_requests", 500);
    await submitRequest(page, "More Kuwaiti cooking shows please");

    await expect(page.getByText(/failed to submit request/i)).toBeVisible();
    // Clearing the box on failure would make the learner retype it.
    await expect(requestBox(page)).toHaveValue("More Kuwaiti cooking shows please");
  });
});

test.describe("slowing a video down", () => {
  const transcript = [
    { id: "l1", arabic: "مرحبا", translation: "Hello", startMs: 0, endMs: 1500 },
    { id: "l2", arabic: "شلونك", translation: "How are you", startMs: 1500, endMs: 3000 },
  ];

  /** A TikTok row whose extracted audio is already staged in `video-audio`. */
  function seedTikTok(db: MemoryDb, backend: SupabaseBackend) {
    backend.stageObject(`video-audio/${videoId(0)}.wav`);
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: videoId(0),
        platform: "tiktok",
        source_url: "https://www.tiktok.com/@someone/video/7300000000000000000",
        embed_url: "https://www.tiktok.com/embed/v2/7300000000000000000",
        transcript_lines: transcript,
      }),
    ]);
  }

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
  });

  test("YouTube keeps the synced speed control", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({ id: videoId(0), transcript_lines: transcript }),
    ]);

    await page.goto(`/discover/${videoId(0)}`);

    // The IFrame API slows picture and sound together, so this one is safe.
    await expect(page.getByRole("button", { name: "1x" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Slow/ })).toHaveCount(0);
  });

  test("TikTok trades it for a separate, listen-only phrase control", async ({
    page,
    db,
    backend,
    allowExternalHosts,
    expectConsoleErrors,
  }) => {
    // The embed iframe still points at TikTok; blocked, but expected — and
    // the aborted frame logs a cross-origin localStorage complaint.
    allowExternalHosts(["tiktok.com"]);
    expectConsoleErrors([/Failed to read the 'localStorage' property/]);
    seedTikTok(db, backend);

    await page.goto(`/discover/${videoId(0)}`);

    // No synced speed menu: the TikTok frame accepts no rate command, so
    // slowing only the hidden audio dragged the picture out of sync. What
    // replaces it slows one phrase at a time, decoupled from the video.
    await expect(page.getByRole("button", { name: "Slow 0.75x" })).toBeVisible();
    await expect(page.getByRole("button", { name: "1x" })).toHaveCount(0);

    // The marker that it is separate — without it the control reads as the
    // old speed menu and the learner expects the video to slow with it.
    await page.getByRole("button", { name: "About slow listening" }).click();
    await expect(page.getByText(/the video won't follow along/)).toBeVisible();
  });

  test("slow listen replays one phrase and leaves the video parked", async ({
    page,
    db,
    backend,
    allowExternalHosts,
    expectConsoleErrors,
  }) => {
    allowExternalHosts(["tiktok.com"]);
    expectConsoleErrors([/Failed to read the 'localStorage' property/]);
    seedTikTok(db, backend);

    await page.goto(`/discover/${videoId(0)}`);

    // Enabled only once the staged audio's metadata has loaded — the same
    // gate as the synced play button.
    const slow = page.getByRole("button", { name: "Slow 0.75x" });
    await expect(slow).toBeEnabled();
    await slow.click();

    // Playing, on its own element: the synced player still offers Play.
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

    // It stops itself at the end of the phrase instead of running on.
    await expect(page.getByRole("button", { name: "Slow 0.75x" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("a clip that cannot be loaded", () => {
  test("offers a way out instead of a bare dead end", async ({ page, signInAs }) => {
    await signInAs("free");

    // Nothing seeded: the player's .single() lookup fails, which is also what
    // a deleted or unreachable clip looks like from the page's point of view.
    await page.goto(`/discover/${videoId(7)}`);

    await expect(page.getByText("This clip didn't load")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // The escape hatch is the point — this page used to render only the text.
    await page.getByRole("button", { name: "Browse clips" }).click();
    await expect(page).toHaveURL(/\/discover$/);
  });
});

test.describe("keeping the TikTok frame on the audio clock", () => {
  /**
   * The player treats TikTok's frame as a muted picture and plays our own
   * audio copy as the clock. The real frame is cross-origin and blocked here,
   * so these run the page against a stand-in that speaks the documented embed
   * protocol (e2e/support/fakeTikTokPlayer.ts) — the first coverage this
   * handshake has had outside production, where every regression in it has
   * been found so far.
   */
  const transcript = [
    { id: "l1", arabic: "مرحبا", translation: "Hello", startMs: 0, endMs: 3000 },
    { id: "l2", arabic: "شلونك", translation: "How are you", startMs: 3000, endMs: 9000 },
  ];

  function seedClip(db: MemoryDb, backend: SupabaseBackend, durationMs: number) {
    backend.stageObject(`video-audio/${videoId(0)}.wav`, { durationMs });
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: videoId(0),
        platform: "tiktok",
        source_url: "https://www.tiktok.com/@someone/video/7300000000000000000",
        embed_url: "https://www.tiktok.com/embed/v2/7300000000000000000",
        transcript_lines: transcript,
      }),
    ]);
  }

  /** The hidden audio's clock, in seconds. */
  const audioSeconds = (page: Page) =>
    page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1);

  /** Frame minus audio, in seconds: negative when the picture is behind. */
  async function drift(page: Page): Promise<number> {
    const frame = await readFakePlayer(page);
    if (!frame) throw new Error("fake player frame not mounted");
    return frame.time - (await audioSeconds(page));
  }

  test.beforeEach(async ({ signInAs, db, allowExternalHosts }) => {
    // The frame's own URL is tiktok.com even though the fake answers it.
    allowExternalHosts(["tiktok.com"]);
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
  });

  test("sings the learner a song once, when they get through the clip", async ({ page, db, backend }) => {
    // Three seconds of video against four of audio: the page counts a video as
    // watched at 85%, which a three-second clock reaches at its third second.
    backend.stageObject(`video-audio/${videoId(0)}.wav`, { durationMs: 4000 });
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: videoId(0),
        platform: "tiktok",
        source_url: "https://www.tiktok.com/@someone/video/7300000000000000000",
        embed_url: "https://www.tiktok.com/embed/v2/7300000000000000000",
        transcript_lines: transcript,
        duration_seconds: 3,
      }),
    ]);
    await installFakeTikTokPlayer(page);
    await page.goto(`/discover/${videoId(0)}`);

    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeEnabled();
    await play.click();

    await expect.poll(() => backend.callsTo("generate-celebration-song").length, { timeout: 15_000 }).toBe(1);
    expect(backend.lastCallTo("generate-celebration-song")?.body).toMatchObject({
      name: "Test Learner",
      achievement: { kind: "video_complete" },
    });
  });

  test("parks the muted autoplay, starts in step, stops with the clip and drives a phrase jump", async ({
    page,
    db,
    backend,
  }) => {
    seedClip(db, backend, 4000);
    await installFakeTikTokPlayer(page);
    await page.goto(`/discover/${videoId(0)}`);

    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeEnabled();

    // Priming: autoplay=1 starts the muted frame on its own, and the page parks
    // it at zero before the learner has pressed anything.
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(2);
    const primed = (await readFakePlayer(page))!;
    expect(primed.cmds.some((c) => c.type === "seekTo" && Number(c.value) === 0)).toBe(true);
    expect(primed.time).toBeLessThan(0.5);

    // Play: the frame is told where the audio is and started, and runs with it.
    await play.click();
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(1);
    await expect.poll(() => audioSeconds(page)).toBeGreaterThan(0.8);
    expect(Math.abs(await drift(page))).toBeLessThan(0.4);

    // The clip ends; the frame is paused with it rather than left running.
    await expect.poll(async () => (await readFakePlayer(page))?.state, { timeout: 8000 }).toBe(2);
    await expect(play).toBeVisible();

    // A phrase jump drives the frame to the line start first, then the audio.
    await page.getByRole("button", { name: "Previous line" }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(1);
    const jumped = (await readFakePlayer(page))!;
    const seeks = jumped.cmds.filter((c) => c.type === "seekTo").map((c) => Number(c.value));
    expect(seeks.at(-1)).toBeLessThan(0.5);
    expect(Math.abs(await drift(page))).toBeLessThan(0.4);
  });

  test("catches a frame that stalled to buffer and fell behind the audio", async ({ page, db, backend }) => {
    seedClip(db, backend, 12_000);
    await installFakeTikTokPlayer(page);
    await page.goto(`/discover/${videoId(0)}`);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(2);

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(1);
    await page.waitForTimeout(800);
    expect(Math.abs(await drift(page))).toBeLessThan(0.4);
    const seeks = (snapshot: Awaited<ReturnType<typeof readFakePlayer>>) =>
      (snapshot?.cmds ?? []).filter((c) => c.type === "seekTo");
    const seeksBefore = seeks(await readFakePlayer(page)).length;

    // The picture buffers for a second while the audio keeps going, then
    // reports playing again from where it stopped. Without a correction it
    // stayed a second behind for the rest of the clip — this was the "audio
    // and video are unsynced" report.
    await stallFakePlayer(page, 1000);
    await expect
      .poll(async () => reportedStates((await readFakePlayer(page))!).slice(-2).join(","), { timeout: 4000 })
      .toBe("3,1");

    // One corrective seek, once the player's own clock has disagreed with the
    // audio on consecutive reports — not a seek per tick, and not during the
    // buffering itself.
    await expect.poll(async () => seeks(await readFakePlayer(page)).length, { timeout: 5000 }).toBe(seeksBefore + 1);
    const correction = seeks(await readFakePlayer(page)).at(-1)!;
    // The frame really was behind when it was told where the audio is.
    expect(Number(correction.value) - correction.frameTime).toBeGreaterThan(0.8);

    await page.waitForTimeout(1500);
    expect(seeks(await readFakePlayer(page)).length).toBe(seeksBefore + 1);
    expect(Math.abs(await drift(page))).toBeLessThan(0.4);
  });

  test("asks for a tap at once when the player refuses to autoplay", async ({ page, db, backend }) => {
    seedClip(db, backend, 12_000);
    await installFakeTikTokPlayer(page, { autoplayRefused: true });
    await page.goto(`/discover/${videoId(0)}`);
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeEnabled();

    // No autoplay, no priming: the player reports the refusal and sits at its
    // own poster.
    await expect
      .poll(async () => (await readFakePlayer(page))?.sent.some((m) => m.type === "onPlayerError") ?? false)
      .toBe(true);
    expect((await readFakePlayer(page))!.state).toBe(-1);

    // Our play cannot start it either; the player said so, and the page passes
    // that on right away instead of after its four-second retry budget.
    await play.click();
    await expect(page.getByText("Tap the video to start it")).toBeVisible({ timeout: 1500 });

    // The tap inside the frame starts the picture; the page aligns it and the
    // hint goes away.
    await tapFakePlayer(page);
    await expect.poll(async () => (await readFakePlayer(page))?.state).toBe(1);
    await expect(page.getByText("Tap the video to start it")).toHaveCount(0);
    expect(Math.abs(await drift(page))).toBeLessThan(0.4);
  });

  test("slow listen survives an expired audio URL by asking for a fresh one", async ({ page, db, backend }) => {
    seedClip(db, backend, 12_000);
    await installFakeTikTokPlayer(page);
    await page.goto(`/discover/${videoId(0)}`);
    const slow = page.getByRole("button", { name: "Slow 0.75x" });
    await expect(slow).toBeEnabled();
    const callsBefore = backend.callsTo("discover-video-audio").length;

    // Time passes: every URL the page holds is now expired at the bucket.
    backend.expireSignedStorageUrls();

    // The first attempt fails at the bucket; the page fetches a fresh URL and
    // plays rather than toasting "Audio playback failed".
    await slow.click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page.getByText("Audio playback failed")).toHaveCount(0);
    expect(backend.callsTo("discover-video-audio").length).toBe(callsBefore + 1);
  });
});
