import { describe, expect, it } from "vitest";
import { classifyShare, extractSharedUrl, isVideoPlatformUrl } from "./shareRouting";

/**
 * The deterministic half of share routing: what can be decided without an AI
 * call must be decided without an AI call, and the same payload must land in
 * a different place depending on who shared it (admins get the Discover
 * pipeline; learners never do).
 */

const base = { title: "", text: "", url: "", files: [] as File[], isAdmin: false };

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("extractSharedUrl", () => {
  it("prefers the explicit url field", () => {
    expect(extractSharedUrl({ text: "look", url: "https://x.com/a/status/1" })).toBe(
      "https://x.com/a/status/1",
    );
  });

  it("digs a URL out of the shared text, dropping trailing punctuation", () => {
    expect(
      extractSharedUrl({ text: "Check this! https://vt.tiktok.com/ZS8abc/, so funny", url: "" }),
    ).toBe("https://vt.tiktok.com/ZS8abc/");
  });

  it("returns null when nothing looks like a link", () => {
    expect(extractSharedUrl({ text: "just words", url: "" })).toBeNull();
  });
});

describe("isVideoPlatformUrl", () => {
  it.each([
    "https://www.tiktok.com/@user/video/123",
    "https://vt.tiktok.com/ZS8abc/",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.instagram.com/reel/abc123/",
  ])("recognises %s", (url) => {
    expect(isVideoPlatformUrl(url)).toBe(true);
  });

  it("does not treat an X post as a video platform", () => {
    expect(isVideoPlatformUrl("https://x.com/user/status/123")).toBe(false);
  });
});

describe("classifyShare", () => {
  it("sends audio files to Transcribe for everyone", () => {
    const voiceNote = file("note.m4a", "audio/mp4");
    expect(classifyShare({ ...base, files: [voiceNote] })).toEqual({
      action: "transcribe-file",
      file: voiceNote,
    });
  });

  it("sends a learner's video file to the meme analyzer, an admin's to Transcribe", () => {
    const clip = file("clip.mp4", "video/mp4");
    expect(classifyShare({ ...base, files: [clip] }).action).toBe("meme-file");
    expect(classifyShare({ ...base, files: [clip], isAdmin: true }).action).toBe("transcribe-file");
  });

  it("marks images for AI screening — a screenshot could be a meme or a chat", () => {
    const shot = file("screenshot.png", "image/png");
    expect(classifyShare({ ...base, files: [shot] })).toEqual({
      action: "screen-image",
      file: shot,
    });
  });

  it("sends X posts to Learn from X", () => {
    expect(classifyShare({ ...base, url: "https://x.com/user/status/1234567890" })).toEqual({
      action: "learn-from-x",
      url: "https://x.com/user/status/1234567890",
    });
  });

  it("gives admins the one-step pipeline for a TikTok link, learners a notice", () => {
    const url = "https://www.tiktok.com/@user/video/123";
    expect(classifyShare({ ...base, url, isAdmin: true })).toEqual({
      action: "video-pipeline",
      url,
    });
    expect(classifyShare({ ...base, url })).toEqual({ action: "video-url-unsupported", url });
  });

  it("finds the TikTok link buried in a share caption", () => {
    const decision = classifyShare({
      ...base,
      text: "هذا المقطع! https://vt.tiktok.com/ZS8abc/",
      isAdmin: true,
    });
    expect(decision).toEqual({ action: "video-pipeline", url: "https://vt.tiktok.com/ZS8abc/" });
  });

  it("marks free text for AI screening", () => {
    expect(classifyShare({ ...base, text: "شخبارك؟" })).toEqual({
      action: "screen-text",
      text: "شخبارك؟",
    });
  });

  it("screens the caption of an unknown link rather than dead-ending", () => {
    expect(
      classifyShare({ ...base, text: "وش معنى هالكلمة؟ https://blog.example.com/post" }),
    ).toEqual({ action: "screen-text", text: "وش معنى هالكلمة؟" });
  });

  it("falls back to the title when that is all the share carried", () => {
    expect(classifyShare({ ...base, title: "مقال عن القهوة" })).toEqual({
      action: "screen-text",
      text: "مقال عن القهوة",
    });
  });

  it("reports an empty share as empty", () => {
    expect(classifyShare(base)).toEqual({ action: "empty" });
    expect(classifyShare({ ...base, url: "https://blog.example.com/post" })).toEqual({
      action: "empty",
    });
  });

  it("ignores file types nothing can process", () => {
    expect(classifyShare({ ...base, files: [file("doc.pdf", "application/pdf")] })).toEqual({
      action: "empty",
    });
  });
});
