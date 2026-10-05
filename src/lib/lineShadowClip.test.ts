import { describe, expect, it } from "vitest";
import { buildLineShadowClip } from "./lineShadowClip";

const line = { id: "l4", arabic: "روح ارتاح", translation: "Go and rest", startMs: 6400, endMs: 8200 };
const youtube = {
  platform: "youtube",
  embed_url: "https://www.youtube.com/embed/abc123def45",
  source_url: null,
  dialect: "Gulf",
  title: "A clip",
};

describe("buildLineShadowClip", () => {
  it("plays the native audio file when there is one", () => {
    expect(buildLineShadowClip(line, youtube, "https://cdn.test/audio.m4a")).toEqual({
      id: "line-l4",
      source: "audio",
      audioUrl: "https://cdn.test/audio.m4a",
      text: "روح ارتاح",
      translation: "Go and rest",
      startSec: 6.4,
      endSec: 8.2,
      dialect: "Gulf",
      locale: "ar-SA",
      sourceTitle: "A clip",
    });
  });

  it("falls back to the YouTube segment without one", () => {
    const clip = buildLineShadowClip(line, youtube, null);
    expect(clip?.source).toBe("youtube");
    expect(clip?.youtubeId).toBe("abc123def45");
  });

  it("has nothing to offer for a line with no place on the timeline", () => {
    expect(buildLineShadowClip({ ...line, endMs: undefined }, youtube, "https://cdn.test/a.m4a")).toBeNull();
    expect(buildLineShadowClip({ ...line, endMs: 6000 }, youtube, "https://cdn.test/a.m4a")).toBeNull();
  });

  it("has nothing to offer for a TikTok with no audio copy yet", () => {
    expect(buildLineShadowClip(line, { ...youtube, platform: "tiktok" }, null)).toBeNull();
  });
});
