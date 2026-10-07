import { afterEach, describe, expect, it } from "vitest";
import { setSoundEnabled } from "@/lib/uiPrefs";
import {
  DANCE_MUSIC_KEY,
  isDanceMusicTestOn,
  parseDanceMusicParam,
  setDanceMusicTestOn,
  shouldPlayDanceMusic,
} from "./danceMusic";

/**
 * When a celebration plays its dance's music. The loops are test audio whose
 * rights are not cleared, so the rule that matters is that a learner never
 * hears one by accident: only a preview, or someone who switched the test flag
 * on, does, and the app's sound switch silences both.
 */

afterEach(() => {
  window.localStorage.clear();
});

describe("parseDanceMusicParam", () => {
  it("reads on and off, and ignores anything else", () => {
    expect(parseDanceMusicParam("?dancemusic=on")).toBe(true);
    expect(parseDanceMusicParam("?dancemusic=ON")).toBe(true);
    expect(parseDanceMusicParam("?dancemusic=1")).toBe(true);
    expect(parseDanceMusicParam("?dancemusic=off")).toBe(false);
    expect(parseDanceMusicParam("?dancemusic=0")).toBe(false);
    expect(parseDanceMusicParam("?dancemusic=loud")).toBeNull();
    expect(parseDanceMusicParam("?celebrate=ardah")).toBeNull();
    expect(parseDanceMusicParam("")).toBeNull();
  });
});

describe("the test flag", () => {
  it("is off until switched on, and forgets itself when switched off", () => {
    expect(isDanceMusicTestOn()).toBe(false);
    setDanceMusicTestOn(true);
    expect(isDanceMusicTestOn()).toBe(true);
    expect(window.localStorage.getItem(DANCE_MUSIC_KEY)).toBe("on");
    setDanceMusicTestOn(false);
    expect(isDanceMusicTestOn()).toBe(false);
    expect(window.localStorage.getItem(DANCE_MUSIC_KEY)).toBeNull();
  });

  it("uses the Hikaya storage prefix", () => {
    expect(DANCE_MUSIC_KEY.startsWith("hikaya:")).toBe(true);
  });
});

describe("shouldPlayDanceMusic", () => {
  it("plays in a preview, and in a real celebration only with the test flag on", () => {
    expect(shouldPlayDanceMusic(true)).toBe(true);
    expect(shouldPlayDanceMusic(false)).toBe(false);
    setDanceMusicTestOn(true);
    expect(shouldPlayDanceMusic(false)).toBe(true);
  });

  it("stays silent whenever the app's sound is off", () => {
    setDanceMusicTestOn(true);
    setSoundEnabled(false);
    expect(shouldPlayDanceMusic(true)).toBe(false);
    expect(shouldPlayDanceMusic(false)).toBe(false);
  });
});
