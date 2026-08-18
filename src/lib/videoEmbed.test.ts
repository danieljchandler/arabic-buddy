import { describe, expect, it } from "vitest";
import {
  extractTikTokVideoId,
  getThumbnailCandidates,
  getTikTokEmbedUrl,
  getYouTubeVideoId,
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

  /**
   * One id reader for every URL a row carries, because a still has to be
   * derivable from any of them: the stored thumbnail says what size to
   * upgrade, and `source_url`/`embed_url` are what a row with no stored
   * thumbnail at all has to fall back on.
   */
  describe("reading the video id back out of a URL", () => {
    it.each([
      ["a watch URL", `https://www.youtube.com/watch?v=${ID}`],
      ["a shorts URL", `https://www.youtube.com/shorts/${ID}`],
      ["a live URL", `https://www.youtube.com/live/${ID}`],
      ["a short link", `https://youtu.be/${ID}`],
      ["an embed URL", `https://www.youtube.com/embed/${ID}`],
      // What every row's `embed_url` actually holds — the player is pointed at
      // the no-cookie host, so this is the common case, not the exotic one.
      ["a no-cookie embed URL", `https://www.youtube-nocookie.com/embed/${ID}?enablejsapi=1&rel=0`],
      ["the redirecting still host", `https://img.youtube.com/vi/${ID}/hqdefault.jpg`],
      ["the still CDN host", `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`],
      ["a numbered CDN shard", `https://i9.ytimg.com/vi/${ID}/mqdefault.jpg`],
      ["the webp still variant", `https://i.ytimg.com/vi_webp/${ID}/sddefault.webp`],
      // What the YouTube Data API hands back for a trending candidate.
      ["signing and crop params", `https://i.ytimg.com/vi/${ID}/hqdefault.jpg?sqp=-oaymwE&rs=AOn4`],
    ])("reads it off %s", (_case, url) => {
      expect(getYouTubeVideoId(url)).toBe(ID);
    });

    it.each([
      ["a TikTok still", "https://p16-sign.tiktokcdn.com/obj/abc~tplv.jpeg"],
      ["a TikTok video", "https://www.tiktok.com/@creator/video/7451234567890123456"],
      ["an Instagram reel", "https://www.instagram.com/reel/CxYzAbCdEfG/"],
      ["nothing at all", null],
    ])("does not claim %s", (_case, url) => {
      expect(getYouTubeVideoId(url)).toBeNull();
    });

    it("ignores an id of the wrong length", () => {
      // Guards the fixtures the e2e suite seeds (`?v=fixture`): a placeholder
      // must not resolve to a real CDN request in a hermetic test.
      expect(getYouTubeVideoId("https://www.youtube.com/watch?v=fixture")).toBeNull();
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

    it("has nothing to try when the row has no still and no URL to derive one from", () => {
      expect(getThumbnailCandidates(null)).toEqual([]);
      expect(getThumbnailCandidates("")).toEqual([]);
    });

    /**
     * The retroactive half. A YouTube still is a pure function of the video
     * id, and the id is already on the row — so a video whose `thumbnail_url`
     * was never filled in needs no backfill to show a picture.
     */
    describe("a row that never got a thumbnail written to it", () => {
      it("derives one from the source URL", () => {
        expect(
          getThumbnailCandidates(null, { source_url: `https://www.youtube.com/shorts/${ID}` })[0],
        ).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
      });

      it("falls back to the embed URL when the source URL is not YouTube's", () => {
        // Shared links get canonicalised inconsistently; the embed URL is the
        // one the player is built from, so it is the more reliable of the two.
        expect(
          getThumbnailCandidates(null, {
            source_url: "https://some.aggregator/watch/1234",
            embed_url: `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
          })[0],
        ).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
      });

      it("gets the full ladder, not just one guess", () => {
        expect(
          getThumbnailCandidates(null, { source_url: `https://youtu.be/${ID}` }),
        ).toHaveLength(3);
      });

      it("still has nothing for a TikTok or Instagram row", () => {
        // These stills are signed CDN URLs. Nothing about the video's own URL
        // implies one, which is what the admin backfill is for.
        expect(
          getThumbnailCandidates(null, {
            source_url: "https://www.tiktok.com/@creator/video/7451234567890123456",
          }),
        ).toEqual([]);
      });
    });

    it("prefers the stored still for a platform it cannot derive", () => {
      const tiktok = "https://p16-sign.tiktokcdn.com/obj/abc~tplv.jpeg";
      expect(
        getThumbnailCandidates(tiktok, { source_url: "https://www.tiktok.com/@a/video/123456789" }),
      ).toEqual([tiktok]);
    });
  });
});
