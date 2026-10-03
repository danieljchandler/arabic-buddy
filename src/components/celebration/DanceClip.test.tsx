import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DANCE_SCENES, sceneAssets } from "@/lib/celebrations";
import { DanceClip, SETTLE_SECONDS } from "./DanceClip";

/**
 * The dancer on a celebration screen.
 *
 * It is the one decorative clip in the app that is meant to *stop*: a few
 * seconds of dance, then the final pose held. So the things to keep are that
 * it plays once rather than looping, that it eases into that last pose rather
 * than halting mid-step, that the learner can ask for it again, and — as with
 * every clip here — that reduced motion gets the painting and never the video.
 */

const scene = DANCE_SCENES[0];
const originalMatchMedia = window.matchMedia;
const originalPlay = HTMLMediaElement.prototype.play;
const originalPause = HTMLMediaElement.prototype.pause;
let play: ReturnType<typeof vi.fn>;

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  reducedMotion(false);
  play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  HTMLMediaElement.prototype.play = originalPlay;
  HTMLMediaElement.prototype.pause = originalPause;
});

const videoIn = (container: HTMLElement) => container.querySelector("video") as HTMLVideoElement;

/** jsdom has no media pipeline; give the element a duration and a position. */
function at(video: HTMLVideoElement, currentTime: number, duration = 5) {
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  video.currentTime = currentTime;
}

describe("DanceClip", () => {
  it("plays the scene's clip once, muted, without looping", () => {
    const { container } = render(<DanceClip scene={scene} />);
    const video = videoIn(container);

    expect(video).not.toBeNull();
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.getAttribute("poster")).toBe(sceneAssets(scene.id).poster);
    const sources = Array.from(video.querySelectorAll("source")).map((s) => s.getAttribute("src"));
    expect(sources).toEqual([sceneAssets(scene.id).mp4, sceneAssets(scene.id).webm]);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("slows into the final pose rather than stopping mid-step", () => {
    const { container } = render(<DanceClip scene={scene} />);
    const video = videoIn(container);

    at(video, 2);
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(1);

    at(video, 5 - SETTLE_SECONDS + 0.1);
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(0.5);
  });

  it("ignores time updates before the clip knows its length", () => {
    const { container } = render(<DanceClip scene={scene} />);
    const video = videoIn(container);
    Object.defineProperty(video, "duration", { configurable: true, value: NaN });
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(1);
  });

  it("offers to watch again once the dance has finished, and replays from the top", () => {
    const { container } = render(<DanceClip scene={scene} />);
    const video = videoIn(container);
    expect(screen.queryByRole("button", { name: /watch the .* again/i })).toBeNull();

    at(video, 5);
    video.playbackRate = 0.5;
    fireEvent.ended(video);
    fireEvent.click(screen.getByRole("button", { name: `Watch the ${scene.nameEn} again` }));

    expect(video.currentTime).toBe(0);
    expect(video.playbackRate).toBe(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /watch the .* again/i })).toBeNull();
  });

  it("shows the still, and never the video, under reduced motion", () => {
    reducedMotion(true);
    const { container } = render(<DanceClip scene={scene} />);

    expect(videoIn(container)).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(sceneAssets(scene.id).poster);
    expect(play).not.toHaveBeenCalled();
  });

  it("falls back to the still when the browser refuses to play", async () => {
    play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    const { container } = render(<DanceClip scene={scene} />);

    await act(async () => {});
    expect(videoIn(container)).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("falls back to the still when neither source can be decoded", () => {
    const { container } = render(<DanceClip scene={scene} />);
    const webm = container.querySelectorAll("source")[1];
    fireEvent.error(webm);
    expect(videoIn(container)).toBeNull();
  });
});
