import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OnScreenTextPanel } from "./OnScreenTextPanel";
import type { ScreenTextLine } from "@/lib/onScreenText";

/**
 * The text written on a video, shown above its transcript.
 *
 * It sits above rather than inside because it is a different kind of evidence:
 * a POV caption is the setup the first spoken line assumes, and it is not
 * something anybody said. Folding it into the transcript — which is what the
 * pipeline used to do — put words in a speaker's mouth and broke line-by-line
 * playback, because there is no audio at that timestamp to play.
 */

const aLine = (over: Partial<ScreenTextLine> = {}): ScreenTextLine => ({
  id: "s1",
  text: "لما تصحى بدري",
  translation: "when you wake up early",
  startSeconds: 2,
  endSeconds: 5,
  ...over,
});

describe("OnScreenTextPanel", () => {
  it("names itself so the learner knows this was not spoken", () => {
    render(<OnScreenTextPanel lines={[aLine()]} />);

    expect(screen.getByText("Text on screen")).toBeInTheDocument();
    expect(screen.getByText("لما تصحى بدري")).toBeInTheDocument();
    expect(screen.getByText("when you wake up early")).toBeInTheDocument();
  });

  it("renders nothing at all for a video with no text on it", () => {
    const { container } = render(<OnScreenTextPanel lines={[]} />);

    // Most videos have nothing written on them, and an empty "Text on screen"
    // heading above every transcript is noise.
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the overlays", () => {
    render(<OnScreenTextPanel lines={[aLine(), aLine({ id: "s2", text: "خلاص" })]} />);

    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("hides the English when the learner has translations off", () => {
    render(<OnScreenTextPanel lines={[aLine()]} showTranslations={false} />);

    expect(screen.getByText("لما تصحى بدري")).toBeInTheDocument();
    expect(screen.queryByText("when you wake up early")).not.toBeInTheDocument();
  });

  it("seeks the player to the moment an overlay is on screen", () => {
    const onSeek = vi.fn();
    render(<OnScreenTextPanel lines={[aLine()]} onSeek={onSeek} />);

    fireEvent.click(screen.getByRole("button"));

    // In seconds, matching the timeline column — the caller converts.
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it("does not offer a seek it cannot perform", () => {
    render(<OnScreenTextPanel lines={[aLine({ startSeconds: undefined })]} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when the model could barely read a caption", () => {
    render(<OnScreenTextPanel lines={[aLine({ confidence: "low" })]} />);

    // Marked rather than dropped: stating a half-legible caption as fact is
    // worse than showing it with a hedge, and hiding it claims the screen was
    // blank when it plainly was not.
    expect(screen.getByText("partly legible")).toBeInTheDocument();
  });

  it("leaves a confident caption unqualified", () => {
    render(<OnScreenTextPanel lines={[aLine({ confidence: "high" })]} />);

    expect(screen.queryByText("partly legible")).not.toBeInTheDocument();
  });

  it("renders Arabic right-to-left", () => {
    render(<OnScreenTextPanel lines={[aLine()]} />);

    expect(screen.getByText("لما تصحى بدري")).toHaveAttribute("dir", "rtl");
  });
});
