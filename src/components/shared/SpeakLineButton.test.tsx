import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakLineButton } from "./SpeakLineButton";

/**
 * A speaker for a line that stands on its own — a Souq News headline, where a
 * whole-passage read-through would make no sense but "how is that said?" is
 * still the first question a learner has.
 *
 * It borrows `useLineAudio` rather than carrying its own playback, so what is
 * tested here is the button: what it asks for, and what it refuses to ask for.
 */

const audio = vi.hoisted(() => ({
  state: {
    playingIndex: null as number | null,
    loadingIndex: null as number | null,
    isPlayingAll: false,
  },
  asked: [] as { lines: string[]; dialect?: string }[],
  playLine: vi.fn(),
  playAll: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/hooks/useLineAudio", () => ({
  useLineAudio: ({ lines, dialect }: { lines: string[]; dialect?: string }) => {
    audio.asked.push({ lines, dialect });
    return {
      ...audio.state,
      playLine: audio.playLine,
      playAll: audio.playAll,
      stop: audio.stop,
    };
  },
}));

beforeEach(() => {
  audio.asked = [];
  audio.playLine.mockClear();
  audio.state = { playingIndex: null, loadingIndex: null, isPlayingAll: false };
});

const HEADLINE = "قطر تعلن عن خط سكة حديد جديد";

describe("SpeakLineButton", () => {
  it("hands its one line to the audio hook", () => {
    render(<SpeakLineButton text={HEADLINE} dialect="Gulf" />);
    expect(audio.asked[0]).toEqual({ lines: [HEADLINE], dialect: "Gulf" });
  });

  it("plays that line when pressed", () => {
    render(<SpeakLineButton text={HEADLINE} />);
    fireEvent.click(screen.getByLabelText("Listen"));
    expect(audio.playLine).toHaveBeenCalledWith(0);
  });

  it("becomes a stop while it is sounding", () => {
    audio.state = { playingIndex: 0, loadingIndex: null, isPlayingAll: false };
    render(<SpeakLineButton text={HEADLINE} />);
    expect(screen.getByLabelText("Stop")).toBeInTheDocument();
  });

  it("takes no second press while the clip is being synthesised", () => {
    audio.state = { playingIndex: null, loadingIndex: 0, isPlayingAll: false };
    render(<SpeakLineButton text={HEADLINE} />);
    expect(screen.getByLabelText("Listen")).toBeDisabled();
  });

  it("is dead rather than misleading when there is nothing to say", () => {
    // Callers render this straight off a field that can be empty while content
    // is still being generated; a live-looking button that does nothing when
    // tapped says nothing about why.
    render(<SpeakLineButton text="   " />);
    const button = screen.getByLabelText("Listen");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(audio.playLine).not.toHaveBeenCalled();
  });

  it("shows a label only when it is given one", () => {
    const { rerender } = render(<SpeakLineButton text={HEADLINE} label="Listen" />);
    expect(screen.getByText("Listen")).toBeInTheDocument();

    rerender(<SpeakLineButton text={HEADLINE} />);
    expect(screen.queryByText("Listen")).not.toBeInTheDocument();
  });
});
