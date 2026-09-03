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
 *
 * "Asked for" is the whole difficulty. What TikTok answers with expires in
 * about forty-eight hours, so a row that stored the answer showed a picture
 * for two days and a broken image afterwards — which is why thumbnails kept
 * "dropping out" days after an admin added them. The asking therefore happens
 * in `persist-video-thumbnail`, which keeps a copy in our own bucket; the
 * browser cannot do that part, the CDNs sending no CORS headers.
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

  test("counts a video whose still is about to expire", async ({ page, db, allowExternalHosts }) => {
    // The row renders its (doomed) still, so the CDN host has to be declared
    // even though nothing there answers.
    allowExternalHosts(["tiktokcdn.test"]);
    // The row that made this a bug rather than a gap: it has a thumbnail, it
    // renders today, and TikTok's signature on it runs out on Friday. Left off
    // the list, it silently goes blank and nobody is told.
    db.seed("discover_videos", [
      aTikTokVideo({
        id: videoId(0),
        title: "A meme",
        thumbnail_url:
          "https://p16.tiktokcdn.test/obj/still.image?x-expires=1788613200&x-signature=abc",
      }),
    ]);

    await page.goto("/admin/videos");
    await expect(backfillButton(page)).toHaveText(/Find 1 missing thumbnail$/);
  });

  test("stores a still that outlives TikTok's signature", async ({ page, db }) => {
    db.seed("discover_videos", [aTikTokVideo({ id: videoId(0), title: "A meme" })]);

    await page.goto("/admin/videos");
    await backfillButton(page).click();

    await expect(page.getByText("Found 1 thumbnail")).toBeVisible();

    // What lands on the row is a copy of ours, not the signed URL the platform
    // handed out — the difference between a thumbnail and a two-day loan.
    const stored = db.rows("discover_videos")[0].thumbnail_url as string;
    expect(stored).toContain("/storage/v1/object/public/flashcard-images/video-stills/");
    expect(stored).not.toContain("x-expires");
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

test.describe("re-reading the text on a video's screen", () => {
  /**
   * The first read happens in the admin's browser at upload time, off the file
   * they still have in hand. This is the way back for everything that misses:
   * videos added before the vision pass existed, and passes that came back
   * empty because a caption was low-contrast or fell between two sampled
   * frames. By then nobody has the file, so the work happens server-side.
   */
  const rereadButton = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /re-read the text/i });

  test("reports what the re-read found", async ({ page, db, backend }) => {
    backend.stubFunction("reextract-on-screen-text", {
      success: true,
      readFrom: "video",
      onScreenTextCount: 3,
      removedTranscriptLines: 0,
    });
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "A meme" })]);

    await page.goto("/admin/videos");
    await rereadButton(page).click();

    await expect(page.getByText("Read 3 lines of on-screen text")).toBeVisible();
  });

  test("says when the captions came out of the transcript", async ({ page, db, backend }) => {
    backend.stubFunction("reextract-on-screen-text", {
      success: true,
      readFrom: "video",
      onScreenTextCount: 2,
      removedTranscriptLines: 2,
    });
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "A meme" })]);

    await page.goto("/admin/videos");
    await rereadButton(page).click();

    // The whole point of the re-read on an older video: the overlays stop being
    // lines somebody supposedly said.
    await expect(page.getByText(/moved 2 captions out of the spoken transcript/)).toBeVisible();
  });

  test("does not claim to have found text when there was none", async ({ page, db, backend }) => {
    backend.stubFunction("reextract-on-screen-text", {
      success: true,
      readFrom: "video",
      onScreenTextCount: 0,
      removedTranscriptLines: 0,
    });
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "A lesson clip" })]);

    await page.goto("/admin/videos");
    await rereadButton(page).click();

    await expect(page.getByText("No on-screen text found")).toBeVisible();
  });

  test("surfaces the reason a re-read could not run", async ({ page, db, backend }) => {
    backend.stubFunctionFailure("reextract-on-screen-text", 500, {
      error: "Only the audio track could be retrieved from this source.",
    });
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "A meme" })]);

    await page.goto("/admin/videos");
    await rereadButton(page).click();

    // An admin who is told only "failed" has no idea whether to re-upload the
    // file, wait, or give up on the source.
    await expect(page.getByText("Could not re-read the video")).toBeVisible();
    // The reason, not "non-2xx status code": an admin told only "failed" cannot
    // tell "re-upload the file" from "wait and try again".
    await expect(page.getByText("Only the audio track could be retrieved from this source.")).toBeVisible();
  });
});
