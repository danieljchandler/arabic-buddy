import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId } from "../src/test/support/factories";

/**
 * `/admin/videos` — the library an admin edits, drafts included.
 *
 * The thumbnail backfill lives here because this is the only screen that sees
 * every video at once. It exists for a narrow set: a YouTube still is derived
 * from the row's own URL when the page renders, so a row with an empty
 * `thumbnail_url` usually shows a picture anyway and has nothing to fetch.
 * What is left is TikTok, whose stills are signed CDN URLs that have to be
 * asked for, and Instagram, which has no public oEmbed at all.
 */

/** A 1x1 transparent GIF, inline, so a thumbnail needs no network at all. */
const TRANSPARENT_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const aTikTokVideo = (over: Record<string, unknown> = {}) =>
  aDiscoverVideo({
    platform: "tiktok",
    source_url: "https://www.tiktok.com/@creator/video/7451234567890123456",
    embed_url: "https://www.tiktok.com/player/v1/7451234567890123456",
    thumbnail_url: null,
    ...over,
  });

const backfillButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /missing thumbnail/i });

test.beforeEach(async ({ signInAs }) => {
  await signInAs("admin");
});

test.describe("the thumbnail backfill", () => {
  test("is not offered when every video already shows a still", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({ id: videoId(0), thumbnail_url: TRANSPARENT_GIF }),
      // No stored thumbnail, but the URL is a real YouTube one, so a still is
      // derived on render and there is nothing to go and fetch.
      aDiscoverVideo({
        id: videoId(1),
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        thumbnail_url: null,
      }),
    ]);

    await page.goto("/admin/videos");
    await expect(page.getByRole("heading", { name: "Manage Videos" })).toBeVisible();

    // A control reading "Find 0 missing thumbnails" is a control that lies.
    await expect(backfillButton(page)).toHaveCount(0);
  });

  test("counts the videos no still can be worked out for", async ({ page, db }) => {
    db.seed("discover_videos", [
      aTikTokVideo({ id: videoId(0), title: "A meme" }),
      aDiscoverVideo({ id: videoId(1), thumbnail_url: TRANSPARENT_GIF }),
    ]);

    await page.goto("/admin/videos");
    await expect(backfillButton(page)).toHaveText(/Find 1 missing thumbnail$/);
  });

  test("fetches a TikTok still and saves it", async ({ page, db, allowExternalHosts }) => {
    // TikTok's oEmbed is public and CORS-open, which is why this can run from
    // the admin's own browser rather than needing an edge function.
    // The CDN host too: the saved still is rendered straight back into the
    // list, which is the proof it actually landed on the row.
    allowExternalHosts(["tiktok.com", "tiktokcdn.test"]);
    await page.route("**/www.tiktok.com/oembed**", (route) =>
      route.fulfill({ json: { thumbnail_url: "https://p16.tiktokcdn.test/obj/still.jpg" } }),
    );

    db.seed("discover_videos", [aTikTokVideo({ id: videoId(0), title: "A meme" })]);

    await page.goto("/admin/videos");
    await backfillButton(page).click();

    await expect(page.getByText("Found 1 thumbnail")).toBeVisible();
    expect(db.lastWriteTo("discover_videos")?.payload[0]).toMatchObject({
      thumbnail_url: "https://p16.tiktokcdn.test/obj/still.jpg",
    });
  });

  test("says which videos still need a human", async ({ page, db }) => {
    // Instagram's oEmbed needs a Facebook app token, so the only way to a
    // still is uploading the video and capturing a frame from it.
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: videoId(0),
        platform: "instagram",
        source_url: "https://www.instagram.com/reel/CxYzAbCdEfG/",
        embed_url: "https://www.instagram.com/p/CxYzAbCdEfG/embed",
        thumbnail_url: null,
      }),
    ]);

    await page.goto("/admin/videos");
    await backfillButton(page).click();

    await expect(page.getByText("No thumbnails could be found")).toBeVisible();
    await expect(page.getByText(/1 still need a frame captured/)).toBeVisible();
  });
});
