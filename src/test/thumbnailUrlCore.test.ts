import { describe, expect, it } from "vitest";
import {
  isEphemeralThumbnailUrl,
  isExpiredThumbnailUrl,
  isMirroredThumbnailUrl,
  thumbnailExpiresAt,
} from "../../supabase/functions/_shared/thumbnailUrlCore";

/**
 * Telling a still that lasts from one that is on loan.
 *
 * This is the whole diagnosis of "the video thumbnails keep dropping out".
 * TikTok's oEmbed does not answer with an address, it answers with a signed
 * one, and `x-expires` is about forty-eight hours out — so every TikTok row
 * that stored what the platform said went blank two days later, and fetching
 * it again minted another two-day URL. Everything downstream (copy it, count
 * it as missing, refuse to save it as final) hangs off recognising that shape.
 */

/** A real oEmbed answer, trimmed. The `x-expires` is what matters. */
const signedTikTok = (expires: number) =>
  `https://p16-common-sign.tiktokcdn-us.com/tos-maliva-p-0068/2367c7d4~tplv-tiktokx-origin.image` +
  `?dr=9636&x-expires=${expires}&x-signature=ci9fkBhPJk6V5lwZMykET4c7mA0%3D&idc=useast5`;

describe("spotting a still that expires", () => {
  it("reads TikTok's x-expires", () => {
    expect(thumbnailExpiresAt(signedTikTok(1788613200))).toBe(1788613200_000);
    expect(isEphemeralThumbnailUrl(signedTikTok(1788613200))).toBe(true);
  });

  it("leaves a permanent YouTube still alone", () => {
    // Derived from the video id, unsigned, and the reason YouTube rows never
    // had this problem in the first place.
    const url = "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg";
    expect(thumbnailExpiresAt(url)).toBeNull();
    expect(isEphemeralThumbnailUrl(url)).toBe(false);
  });

  it("leaves our own copy alone", () => {
    const url =
      "https://abc.supabase.co/storage/v1/object/public/flashcard-images/video-stills/v1.jpg";
    expect(isEphemeralThumbnailUrl(url)).toBe(false);
    expect(isMirroredThumbnailUrl(url)).toBe(true);
  });

  it("reads Meta's hex spelling of the same thing, on Meta's hosts", () => {
    const oe = (0x6975_2c00).toString(16); // 2026-01-14, well inside the window
    expect(
      thumbnailExpiresAt(`https://scontent.cdninstagram.com/v/t51/still.jpg?oe=${oe}&_nc_ht=x`),
    ).toBe(0x6975_2c00 * 1000);
  });

  it("does not read a stray eight-hex parameter as an expiry", () => {
    // `oe` is only an expiry on the CDNs that use it that way. Read anywhere,
    // it would condemn unrelated URLs to being copied for no reason.
    expect(thumbnailExpiresAt("https://cdn.example.com/still.jpg?oe=69752c00")).toBeNull();
  });

  it("ignores a number that cannot be a date", () => {
    expect(thumbnailExpiresAt("https://cdn.example.com/s.jpg?expires=42")).toBeNull();
    expect(thumbnailExpiresAt("https://cdn.example.com/s.jpg?expires=notanumber")).toBeNull();
  });

  it("takes a millisecond expiry for what it is", () => {
    expect(thumbnailExpiresAt("https://cdn.example.com/s.jpg?x-expires=1788613200000")).toBe(
      1788613200_000,
    );
  });

  it("survives everything that is not a URL", () => {
    expect(thumbnailExpiresAt(null)).toBeNull();
    expect(thumbnailExpiresAt(undefined)).toBeNull();
    expect(thumbnailExpiresAt("")).toBeNull();
    expect(thumbnailExpiresAt("not a url at all")).toBeNull();
    expect(isEphemeralThumbnailUrl("/relative/path.jpg")).toBe(false);
  });
});

describe("spotting a still that has already gone", () => {
  const now = Date.UTC(2026, 8, 3);

  it("knows the difference between about to expire and expired", () => {
    expect(isExpiredThumbnailUrl(signedTikTok(Math.floor(now / 1000) + 3600), now)).toBe(false);
    expect(isExpiredThumbnailUrl(signedTikTok(Math.floor(now / 1000) - 1), now)).toBe(true);
  });

  it("never calls a permanent still expired", () => {
    expect(isExpiredThumbnailUrl("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", now)).toBe(
      false,
    );
  });
});
