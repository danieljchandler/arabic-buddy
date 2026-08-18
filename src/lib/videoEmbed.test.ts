import { describe, expect, it } from "vitest";
import {
  extractTikTokVideoId,
  getThumbnailCandidates,
  getTikTokEmbedUrl,
  getYouTubeIdFromThumbnailUrl,
  getYouTubeThumbnail,
  parseVideoUrl,
} from "./videoEmbed";

describe("TikTok URL helpers", () => {
  it("normalizes full TikTok URL to player embed", () => {
    const url = "https://www.tiktok.com/@creator/video/7451234567890123456";
    expect(getTikTokEmbedUrl(url)).toBe("https://www.tiktok.com/player/v1/7451234567890123456");
  });

  it("extracts video ID from player URL", () => {
    const url = "https://www.tiktok.com/player/v1/7451234567890123456?autoplay=1";
    expect(extractTikTokVideoId(url)).toBe("7451234567890123456");
  });

  it("extracts video ID from item_id query params", () => {
    const url = "https://www.tiktok.com/share/video/?item_id=7451234567890123456";
    expect(extractTikTokVideoId(url)).toBe("7451234567890123456");
  });

  it("parses TikTok full URLs as player embed", () => {
    const parsed = parseVideoUrl("https://www.tiktok.com/@creator/video/7451234567890123456");
    expect(parsed).toEqual({
      platform: "tiktok",
      videoId: "7451234567890123456",
      embedUrl: "https://www.tiktok.com/player/v1/7451234567890123456",
    });
  });
});

/**
 * Thumbnails are the whole first impression of Discover and the feed, and for
 * years every YouTube card rendered `hqdefault` — 480x360, the widescreen
 * frame letterboxed into 4:3 — scaled up to fill a card several times wider.
 * These helpers exist to ask for the real still instead, and to keep working
 * for the videos YouTube never generated one for.
 */
describe("YouTube thumbnails", () => {
  const ID = "dQw4w9WgXcQ";

  it("asks for the full-resolution still by default", () => {
    expect(getYouTubeThumbnail(ID)).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  });

  it("can be pinned to a smaller size", () => {
    expect(getYouTubeThumbnail(ID, "hqdefault")).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it("points at i.ytimg.com, the host img.youtube.com only redirects to", () => {
    // One fewer round trip per card, and the grid is nothing but cards.
    expect(getYouTubeThumbnail(ID)).not.toContain("img.youtube.com");
  });

  describe("recognising a stored still", () => {
    it.each([
      ["the redirecting host", `https://img.youtube.com/vi/${ID}/hqdefault.jpg`],
      ["the CDN host", `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`],
      ["a numbered CDN shard", `https://i9.ytimg.com/vi/${ID}/mqdefault.jpg`],
      ["the webp variant", `https://i.ytimg.com/vi_webp/${ID}/sddefault.webp`],
      // What the YouTube Data API hands back for a trending candidate.
      ["signing and crop params", `https://i.ytimg.com/vi/${ID}/hqdefault.jpg?sqp=-oaymwE&rs=AOn4`],
    ])("reads the video id off %s", (_case, url) => {
      expect(getYouTubeIdFromThumbnailUrl(url)).toBe(ID);
    });

    it("does not claim a TikTok still", () => {
      expect(getYouTubeIdFromThumbnailUrl("https://p16-sign.tiktokcdn.com/obj/abc~tplv.jpeg")).toBeNull();
    });
  });

  describe("the ladder a card walks", () => {
    it("upgrades a stored hqdefault URL without a backfill", () => {
      // Rows written before this change hold `hqdefault`; re-deriving from the
      // video id at render time is what makes the existing library sharp too.
      expect(getThumbnailCandidates(`https://img.youtube.com/vi/${ID}/hqdefault.jpg`)).toEqual([
        `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${ID}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
      ]);
    });

    it("ends on hqdefault, the one size every video is guaranteed", () => {
      const candidates = getThumbnailCandidates(getYouTubeThumbnail(ID));
      expect(candidates[candidates.length - 1]).toContain("hqdefault");
    });

    it("leaves a still it cannot rewrite alone", () => {
      // TikTok and Instagram stills are signed CDN URLs; guessing at a bigger
      // one produces a 403, not a bigger picture.
      const tiktok = "https://p16-sign.tiktokcdn.com/obj/abc~tplv.jpeg";
      expect(getThumbnailCandidates(tiktok)).toEqual([tiktok]);
    });

    it("has nothing to try when the row has no still", () => {
      expect(getThumbnailCandidates(null)).toEqual([]);
      expect(getThumbnailCandidates("")).toEqual([]);
    });
  });
});
