import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiAssistantProvider } from "@/contexts/AiAssistantContext";
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
 *
 * Nor is an overlay something the player can seek back to and replay the way a
 * spoken line is, so clicking one must never drive the video — a caption is
 * for looking a word up in, same as the transcript, and nothing else.
 */

const invokeMock = vi.fn().mockResolvedValue({ data: { translation: "wake up", msa: null }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const aLine = (over: Partial<ScreenTextLine> = {}): ScreenTextLine => ({
  id: "s1",
  text: "لما تصحى بدري",
  translation: "when you wake up early",
  startSeconds: 2,
  endSeconds: 5,
  tokens: [
    { id: "s1-tok-0", surface: "لما" },
    { id: "s1-tok-1", surface: "تصحى" },
    { id: "s1-tok-2", surface: "بدري" },
  ],
  ...over,
});

describe("OnScreenTextPanel", () => {
  it("names itself so the learner knows this was not spoken", () => {
    render(<OnScreenTextPanel lines={[aLine()]} />);

    expect(screen.getByText("Text on screen")).toBeInTheDocument();
    expect(screen.getByText("when you wake up early")).toBeInTheDocument();
    // Words are split across tappable spans, so the sentence is asserted as
    // rendered text content rather than a single text node.
    expect(screen.getByLabelText("Text on screen")).toHaveTextContent("لما تصحى بدري");
  });

  it("renders nothing at all for a video with no text on it", () => {
    const { container } = render(<OnScreenTextPanel lines={[]} />);

    // Most videos have nothing written on them, and an empty "Text on screen"
    // heading above every transcript is noise.
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the overlays", () => {
    render(<OnScreenTextPanel lines={[aLine(), aLine({ id: "s2", text: "خلاص", tokens: [{ id: "s2-tok-0", surface: "خلاص" }] })]} />);

    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("hides the English when the learner has translations off", () => {
    render(<OnScreenTextPanel lines={[aLine()]} showTranslations={false} />);

    expect(screen.getByLabelText("Text on screen")).toHaveTextContent("لما تصحى بدري");
    expect(screen.queryByText("when you wake up early")).not.toBeInTheDocument();
  });

  it("makes every word tappable instead of the whole line", () => {
    render(<OnScreenTextPanel lines={[aLine()]} />);

    // One button per word, not one button for the line — the bug this fixes
    // was a single click target that seeked the video player.
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("leaves overlays with no timing just as tappable", () => {
    render(<OnScreenTextPanel lines={[aLine({ startSeconds: undefined, endSeconds: undefined })]} />);

    // There is nothing to seek to either way, so missing timing changes
    // nothing about how the words behave.
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("looks a tapped word up instead of doing anything to the player", async () => {
    render(
      <AiAssistantProvider>
        <OnScreenTextPanel lines={[aLine()]} />
      </AiAssistantProvider>,
    );

    fireEvent.click(screen.getAllByRole("button")[1]);

    // The popover fetches and shows a gloss for the tapped word — reading it
    // up, same as a transcript word, is the whole point of the click.
    await waitFor(() => expect(screen.getByText("wake up")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith(
      "translate-phrase",
      expect.objectContaining({ body: expect.objectContaining({ phrase: "تصحى" }) }),
    );
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
    const { container } = render(<OnScreenTextPanel lines={[aLine()]} />);

    expect(container.querySelector('p[dir="rtl"]')).not.toBeNull();
  });
});
