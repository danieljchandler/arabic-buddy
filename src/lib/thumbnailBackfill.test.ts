import { describe, expect, it, vi } from "vitest";
import {
  backfillThumbnails,
  needsThumbnail,
  resolveThumbnail,
  type BackfillableVideo,
} from "./thumbnailBackfill";

/**
 * Filling in the videos with no thumbnail — and the ones whose thumbnail is
 * about to stop working, which turned out to be the bigger set.
 *
 * Most of the library needs nothing written to it: a YouTube still is a pure
 * function of the video id, which every row already carries, so those rows are
 * fixed at render time. This covers what is left. TikTok stills have to be
 * asked for, and what comes back is a *signed* URL good for about forty-eight
 * hours, so a row that stored one has a picture for two days — which is what
 * "the thumbnails keep dropping out" was. Asking again is not a fix, only a
 * postponement, so the asking happens server-side where a copy can be kept.
 */

const SIGNED_TIKTOK =
  "https://p16-common-sign.tiktokcdn-us.com/tos/still.image?x-expires=1788613200&x-signature=abc";
const MIRRORED =
  "https://abc.supabase.co/storage/v1/object/public/flashcard-images/video-stills/v1.jpg";

const aVideo = (over: Partial<BackfillableVideo> = {}): BackfillableVideo => ({
  id: "v1",
  title: "Ordering coffee in Doha",
  platform: "youtube",
  source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  embed_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  thumbnail_url: null,
  ...over,
});

const aTikTok = (over: Partial<BackfillableVideo> = {}): BackfillableVideo =>
  aVideo({
    platform: "tiktok",
    source_url: "https://www.tiktok.com/@creator/video/7451234567890123456",
    embed_url: "https://www.tiktok.com/player/v1/7451234567890123456",
    ...over,
  });

/** A server that always finds one, so the client half is what is under test. */
const serverFinds = (thumbnailUrl = MIRRORED) => vi.fn().mockResolvedValue({ thumbnailUrl });

describe("deciding which videos are on the list", () => {
  it("leaves alone a video showing a still that will keep working", () => {
    expect(needsThumbnail(aVideo({ thumbnail_url: MIRRORED }))).toBe(false);
    // Nothing stored, but a YouTube still is derived on render.
    expect(needsThumbnail(aVideo())).toBe(false);
  });

  it("lists a video with nothing to show", () => {
    expect(needsThumbnail(aTikTok())).toBe(true);
  });

  it("lists a video whose still expires, even though it renders today", () => {
    // The regression this whole change exists for: a row like this looks
    // healthy on the day it was added and is blank by the weekend, so leaving
    // it off the list is how it stayed broken.
    expect(needsThumbnail(aTikTok({ thumbnail_url: SIGNED_TIKTOK }))).toBe(true);
  });
});

describe("resolving one video's thumbnail", () => {
  it("leaves a video that already has a lasting one alone", async () => {
    const refresh = serverFinds();
    const outcome = await resolveThumbnail(aVideo({ thumbnail_url: MIRRORED }), { refresh });

    expect(outcome).toEqual({ status: "present" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("treats a still that expires as one the row does not have", async () => {
    const refresh = serverFinds();
    const outcome = await resolveThumbnail(aTikTok({ thumbnail_url: SIGNED_TIKTOK }), { refresh });

    expect(outcome).toEqual({ status: "refreshed", thumbnailUrl: MIRRORED });
    expect(refresh).toHaveBeenCalledWith("v1");
  });

  it("derives a YouTube still from the row rather than asking anyone", async () => {
    const refresh = serverFinds();
    const outcome = await resolveThumbnail(aVideo(), { refresh });

    expect(outcome).toEqual({
      status: "derived",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("has the server fetch one it cannot derive", async () => {
    // Not the browser: the platform CDNs answer without CORS headers, so a
    // page can show those bytes and cannot copy them — and copying them is
    // the only thing that makes the still outlive its signature.
    const refresh = serverFinds();
    const outcome = await resolveThumbnail(aTikTok(), { refresh });

    expect(outcome).toEqual({ status: "refreshed", thumbnailUrl: MIRRORED });
  });

  it("reports what the server said when it could not find one", async () => {
    const outcome = await resolveThumbnail(aTikTok(), {
      refresh: async () => ({ error: "the video may be private or deleted" }),
    });

    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("private"));
  });

  it("says what a human has to do for Instagram", async () => {
    // There is no public Instagram oEmbed without a Facebook app token, so the
    // honest answer is the upload-and-capture path the video form already has.
    const outcome = await resolveThumbnail(
      aVideo({
        platform: "instagram",
        source_url: "https://www.instagram.com/reel/CxYzAbCdEfG/",
        embed_url: "https://www.instagram.com/p/CxYzAbCdEfG/embed",
      }),
      {
        refresh: async () => ({
          error: "Instagram has no public thumbnail — upload the video file and capture a frame.",
        }),
      },
    );

    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("capture a frame"));
  });

  it("gives up on a row with no URL at all without troubling the server", async () => {
    const refresh = serverFinds();
    const outcome = await resolveThumbnail(
      aVideo({ platform: null, source_url: null, embed_url: null }),
      { refresh },
    );

    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("backfilling a library", () => {
  it("saves every still it derives", async () => {
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails(
      [aVideo({ id: "a" }), aVideo({ id: "b", source_url: "https://youtu.be/kJQP7kiw5Fk" })],
      { save, refresh: serverFinds() },
    );

    expect(report.filled).toBe(2);
    expect(save).toHaveBeenCalledWith("a", "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(save).toHaveBeenCalledWith("b", "https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg");
  });

  it("does not write again over what the server already stored", async () => {
    // `persist-video-thumbnail` writes the row itself — it has to, since it is
    // the thing that made the copy. A second write from here would be a round
    // trip to say what the row already says.
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails([aTikTok()], { save, refresh: serverFinds() });

    expect(report.filled).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing for a video that already has one", async () => {
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails([aVideo({ thumbnail_url: MIRRORED })], {
      save,
      refresh: serverFinds(),
    });

    expect(report).toMatchObject({ filled: 0, alreadyHad: 1 });
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps going past a video it cannot resolve", async () => {
    // One private TikTok in the middle of the library must not cost the run.
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails(
      [aTikTok({ id: "dead" }), aVideo({ id: "fine" })],
      { save, refresh: async () => ({ error: "the video may be private or deleted" }) },
    );

    expect(report.filled).toBe(1);
    expect(report.unresolved).toEqual([
      { id: "dead", title: "Ordering coffee in Doha", reason: "the video may be private or deleted" },
    ]);
  });

  it("keeps going past a write that was refused", async () => {
    // RLS, or a row deleted underneath the list — either way, report it.
    const save = vi
      .fn()
      .mockResolvedValueOnce({ error: "permission denied" })
      .mockResolvedValue({ error: null });
    const report = await backfillThumbnails([aVideo({ id: "a" }), aVideo({ id: "b" })], {
      save,
      refresh: serverFinds(),
    });

    expect(report.filled).toBe(1);
    expect(report.failedToSave).toEqual([
      { id: "a", title: "Ordering coffee in Doha", reason: "permission denied" },
    ]);
  });

  it("survives a save that throws rather than returning an error", async () => {
    const report = await backfillThumbnails([aVideo()], {
      refresh: serverFinds(),
      save: async () => {
        throw new Error("network down");
      },
    });

    expect(report.failedToSave).toEqual([
      { id: "v1", title: "Ordering coffee in Doha", reason: "network down" },
    ]);
  });

  it("reports progress so a long run is not a frozen button", async () => {
    const onProgress = vi.fn();
    await backfillThumbnails([aVideo({ id: "a" }), aVideo({ id: "b" })], {
      save: async () => ({ error: null }),
      refresh: serverFinds(),
      onProgress,
    });

    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("asks the platforms one at a time", async () => {
    // Each refresh is a platform call the server makes on our behalf, over the
    // whole library. A burst of them is the shape of traffic that gets
    // rate-limited.
    let inFlight = 0;
    let peak = 0;
    const refresh = async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { thumbnailUrl: MIRRORED };
    };

    await backfillThumbnails(
      [aTikTok({ id: "a" }), aTikTok({ id: "b" }), aTikTok({ id: "c" })],
      { save: async () => ({ error: null }), refresh },
    );

    expect(peak).toBe(1);
  });
});
