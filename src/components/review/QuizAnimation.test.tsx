import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuizAnimation } from "./QuizAnimation";

/**
 * An action word's clip, where its picture would be. What it must do is what
 * a picture does — sit there quietly — and what it must never do is move for
 * a learner who asked the device for less motion.
 */

const clip = { clip: "https://cdn.test/eat.mp4", poster: "https://cdn.test/eat.png" };

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

function reduceMotion() {
  window.matchMedia = ((query: string) => ({
    ...original(query),
    matches: query.includes("prefers-reduced-motion"),
  })) as typeof window.matchMedia;
}

describe("QuizAnimation", () => {
  it("plays the clip muted, looped and inline over its poster, with no controls", () => {
    const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
    play.mockClear();
    render(<QuizAnimation animation={clip} />);

    const video = screen.getByTestId("quiz-animation") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(clip.clip);
    expect(video.getAttribute("poster")).toBe(clip.poster);
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.getAttribute("aria-hidden")).toBe("true");
    expect(play).toHaveBeenCalled();
  });

  it("shows the poster and never plays under reduced motion", () => {
    reduceMotion();
    const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
    play.mockClear();
    render(<QuizAnimation animation={clip} />);

    expect(screen.queryByTestId("quiz-animation")).toBeNull();
    expect(screen.getByTestId("quiz-animation-still").getAttribute("src")).toBe(clip.poster);
    expect(play).not.toHaveBeenCalled();
  });

  it("shows the poster when held still", () => {
    render(<QuizAnimation animation={clip} still />);
    expect(screen.getByTestId("quiz-animation-still").getAttribute("alt")).toBe("");
  });

  it("falls back to the poster when the clip cannot be loaded", () => {
    render(<QuizAnimation animation={clip} />);
    fireEvent.error(screen.getByTestId("quiz-animation"));
    expect(screen.getByTestId("quiz-animation-still").getAttribute("src")).toBe(clip.poster);
  });

  it("keeps the poster when the browser refuses to autoplay", async () => {
    const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
    play.mockRejectedValueOnce(new DOMException("not allowed", "NotAllowedError"));
    render(<QuizAnimation animation={clip} />);
    // Still the clip element, with its poster on screen; nothing thrown.
    expect((screen.getByTestId("quiz-animation") as HTMLVideoElement).getAttribute("poster")).toBe(clip.poster);
    await Promise.resolve();
  });
});
