import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * The front door: a vertical feed of real dialect clips.
 *
 * The app used to open on a dashboard — greeting, goal ring, task rows. That
 * is a good answer to "what does today look like" and a poor answer to "why
 * would I open this out of habit", so the dashboard moved to /today and the
 * content took the front door.
 *
 * What these tests hold in place is that the feed stays a feed: content
 * first, the tools applied to that content rather than listed somewhere else,
 * and — the failure mode that would actually sink this format — an empty
 * state that still gives the learner somewhere to go.
 */

function seedFeed(db: MemoryDb, backend: SupabaseBackend, count = 2) {
  const videos = Array.from({ length: count }, (_, i) =>
    aDiscoverVideo({
      id: videoId(i),
      title: i === 0 ? "Morning coffee with my grandfather" : `Clip ${i}`,
      title_arabic: i === 0 ? "قهوة الصباح مع جدي" : null,
      duration_seconds: 192,
    }),
  );
  db.seed("discover_videos", videos);
  backend.stubFunction("discover-feed", {
    items: videos.map((v) => ({
      video_id: v.id,
      score: 1,
      comprehension: 0.8,
      reason: "match",
      bucket: "match",
    })),
    cold_start: false,
    seed: 1,
    active_dialect: "Gulf",
    cefr: null,
  });
}

test.describe("the feed", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("opens on the Arabic, with the English underneath", async ({ page, db, backend }) => {
    seedFeed(db, backend);

    await page.goto("/");

    // The Arabic is the material. The English rides along as the gloss — the
    // same contract every transcript surface in the app uses, and the mirror
    // of Ingleezy, where the studied language is the other one.
    await expect(page.getByText("قهوة الصباح مع جدي")).toBeVisible();
    await expect(page.getByText("Morning coffee with my grandfather")).toBeVisible();
  });

  test("puts the tools on the clip rather than in a menu", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");

    // This rail is the whole reason three hub screens could go away: "ask"
    // stopped being a destination you navigate to and then have to feed with
    // content, and became a control on the content itself. Save is a button —
    // it opens the player in place, which is where a word gets saved — and Ask
    // is the rail's one genuine link.
    await expect(page.getByRole("link", { name: "Ask" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();

    // Transcript and Replay are gone. Both did nothing but open the player,
    // which is a whole screen carrying its own transcript and its own
    // scrubber — two labels promising a third and a fourth thing that turned
    // out to be the same thing, on a rail that is only worth having while
    // every item on it means something different.
    await expect(page.getByRole("button", { name: "Transcript" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
  });

  test("puts your picture on the rail and the mark in the corner", async ({
    page,
    db,
    backend,
    signInAs,
  }) => {
    await signInAs("free", { profile: { avatar_url: "/avatars/sadu-rose.png" } });
    seedFeed(db, backend, 1);

    await page.goto("/");

    // The two used to fight over the same corner, and the avatar won by
    // arriving second. They are separated now: the mark keeps the corner it
    // had, and your face moved to the rail on the right.
    const mark = page.getByRole("img", { name: "Hakiya" }).first();
    const face = page.getByRole("link", { name: /Your account/ }).first();
    await expect(mark).toBeVisible();
    await expect(face.locator("img")).toHaveAttribute("src", "/avatars/sadu-rose.png");

    const markBox = (await mark.boundingBox())!;
    const faceBox = (await face.boundingBox())!;
    expect(markBox.x).toBeLessThan(faceBox.x);
  });

  test("carries the dialect choice on the feed itself", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");

    // Hakiya's one deliberate divergence from Ingleezy's feed header: there is
    // no For-you/Following pair, because the choice that actually filters this
    // feed is the dialect. Three dialects, three chips, on the content they
    // switch.
    const dialects = page.getByRole("group", { name: "Dialect" });
    await expect(dialects.getByRole("button", { name: "Gulf" })).toBeVisible();
    await expect(dialects.getByRole("button", { name: "Egyptian" })).toBeVisible();
    await expect(dialects.getByRole("button", { name: "Yemeni" })).toBeVisible();
  });

  test("offers a way out when there is nothing to watch", async ({ page, backend }) => {
    backend.stubFunction("discover-feed", {
      items: [],
      cold_start: true,
      seed: 1,
      active_dialect: "Gulf",
      cefr: null,
    });

    await page.goto("/");

    // The real risk of betting the home screen on a feed: a video app with no
    // videos is worse than a list. An empty feed must still hand over the two
    // things that work with no library behind them.
    await expect(page.getByText("No new clips right now")).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload a clip" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pick a skill" })).toBeVisible();
  });

  test("plays a clip in place instead of navigating to it", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");
    await page.getByRole("button", { name: /^Play / }).click();

    // The full player — the same component /discover/:id serves, badges,
    // transcript machinery and all — over the feed, with the URL unmoved.
    // No route change is the entire feature: the gap between tap and playing
    // is one render, not a navigation plus a chunk load plus a refetch.
    const player = page.getByRole("dialog", { name: "Video player" });
    await expect(player.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(player.getByText("Gulf", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("the player's Back closes the clip, back to the feed", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");
    await page.getByRole("button", { name: /^Play / }).click();
    await page.getByRole("dialog", { name: "Video player" }).getByRole("button", { name: "Back" }).click();

    // Same feed, same scroll position, no reload — the overlay just leaves.
    await expect(page.getByRole("dialog", { name: "Video player" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Play / })).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("the browser's back button closes the clip, not the app", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");
    await page.getByRole("button", { name: /^Play / }).click();
    await expect(page.getByRole("dialog", { name: "Video player" })).toBeVisible();

    await page.goBack();

    // Back means "close the clip" in every video app this audience uses.
    // Losing the whole feed to the previous page instead would make the
    // overlay feel like a trap.
    await expect(page.getByRole("dialog", { name: "Video player" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Play / })).toBeVisible();
  });

  test("sends the streak chip to the day it counts", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/");
    await page.locator('a[href="/today"]').first().click();

    // Tapping a number to find out where that number came from is the only
    // thing that chip can mean, and /today is the page that answers it.
    await expect(page).toHaveURL(/\/today$/);
  });
});
