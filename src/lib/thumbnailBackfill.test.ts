import { describe, expect, it, vi } from "vitest";
import {
  backfillThumbnails,
  resolveThumbnail,
  type BackfillableVideo,
} from "./thumbnailBackfill";

/**
 * Filling in the videos that were never given a thumbnail.
 *
 * Most of the library needs nothing written to it — a YouTube still is a pure
 * function of the video id, which every row already carries, so those rows are
 * fixed at render time. This covers what is left: TikTok stills have to be
 * asked for, Instagram's cannot be had at all without a Facebook app token,
 * and both answers have to come back as a report rather than an exception, or
 * one dead video stops the run.
 */

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

describe("resolving one video's thumbnail", () => {
  it("leaves a video that already has one alone", async () => {
    const outcome = await resolveThumbnail(aVideo({ thumbnail_url: "https://cdn.test/t.jpg" }));
    expect(outcome).toEqual({ status: "present" });
  });

  it("derives a YouTube still from the row rather than asking anyone", async () => {
    const fetchTikTok = vi.fn();
    const outcome = await resolveThumbnail(aVideo(), { fetchTikTok });

    expect(outcome).toEqual({
      status: "derived",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    });
    expect(fetchTikTok).not.toHaveBeenCalled();
  });

  it("asks TikTok for one it cannot derive", async () => {
    const fetchTikTok = vi.fn().mockResolvedValue("https://p16.tiktokcdn.com/obj/abc");
    const outcome = await resolveThumbnail(aTikTok(), { fetchTikTok });

    expect(outcome).toEqual({ status: "fetched", thumbnailUrl: "https://p16.tiktokcdn.com/obj/abc" });
    expect(fetchTikTok).toHaveBeenCalledWith("https://www.tiktok.com/@creator/video/7451234567890123456");
  });

  it("reports a TikTok video that has since gone private or been deleted", async () => {
    const outcome = await resolveThumbnail(aTikTok(), { fetchTikTok: async () => null });

    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("TikTok"));
  });

  it("recognises TikTok by its URL when the platform column is blank", async () => {
    // Rows that predate the column, and shared links that were never parsed.
    const fetchTikTok = vi.fn().mockResolvedValue("https://p16.tiktokcdn.com/obj/abc");
    const outcome = await resolveThumbnail(aTikTok({ platform: null }), { fetchTikTok });

    expect(outcome).toMatchObject({ status: "fetched" });
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
    );

    expect(outcome).toMatchObject({ status: "unavailable" });
    expect(outcome).toHaveProperty("reason", expect.stringContaining("capture a frame"));
  });

  it("gives up on a row with no URL at all", async () => {
    const outcome = await resolveThumbnail(
      aVideo({ platform: null, source_url: null, embed_url: null }),
    );
    expect(outcome).toMatchObject({ status: "unavailable" });
  });
});

describe("backfilling a library", () => {
  it("saves every still it finds", async () => {
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails(
      [aVideo({ id: "a" }), aVideo({ id: "b", source_url: "https://youtu.be/kJQP7kiw5Fk" })],
      { save },
    );

    expect(report.filled).toBe(2);
    expect(save).toHaveBeenCalledWith("a", "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(save).toHaveBeenCalledWith("b", "https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg");
  });

  it("writes nothing for a video that already has one", async () => {
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails([aVideo({ thumbnail_url: "https://cdn.test/t.jpg" })], { save });

    expect(report).toMatchObject({ filled: 0, alreadyHad: 1 });
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps going past a video it cannot resolve", async () => {
    // One private TikTok in the middle of the library must not cost the run.
    const save = vi.fn().mockResolvedValue({ error: null });
    const report = await backfillThumbnails(
      [aTikTok({ id: "dead" }), aVideo({ id: "fine" })],
      { save, fetchTikTok: async () => null },
    );

    expect(report.filled).toBe(1);
    expect(report.unresolved).toEqual([
      { id: "dead", title: "Ordering coffee in Doha", reason: expect.stringContaining("TikTok") },
    ]);
  });

  it("keeps going past a write that was refused", async () => {
    // RLS, or a row deleted underneath the list — either way, report it.
    const save = vi
      .fn()
      .mockResolvedValueOnce({ error: "permission denied" })
      .mockResolvedValue({ error: null });
    const report = await backfillThumbnails([aVideo({ id: "a" }), aVideo({ id: "b" })], { save });

    expect(report.filled).toBe(1);
    expect(report.failedToSave).toEqual([
      { id: "a", title: "Ordering coffee in Doha", reason: "permission denied" },
    ]);
  });

  it("survives a save that throws rather than returning an error", async () => {
    const report = await backfillThumbnails([aVideo()], {
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
      onProgress,
    });

    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("asks the platforms one at a time", async () => {
    // A burst of parallel requests to a public oEmbed endpoint is the shape of
    // traffic that gets rate-limited, and this runs over the whole library.
    let inFlight = 0;
    let peak = 0;
    const fetchTikTok = async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return "https://p16.tiktokcdn.com/obj/abc";
    };

    await backfillThumbnails(
      [aTikTok({ id: "a" }), aTikTok({ id: "b" }), aTikTok({ id: "c" })],
      { save: async () => ({ error: null }), fetchTikTok },
    );

    expect(peak).toBe(1);
  });
});
