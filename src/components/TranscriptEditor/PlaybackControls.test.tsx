import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlaybackControls from "./PlaybackControls";
import { PLAYBACK_RATES } from "@/hooks/useLinePlayback";

/**
 * The reviewer's speed and loop controls.
 *
 * Worth testing beyond the wiring for one reason: a speed control sitting next
 * to a video player reads as "this changes the video". It does not — it changes
 * how this reviewer hears one line while checking it — and the label saying so
 * is load-bearing, not decoration.
 */

function setup(over: Partial<React.ComponentProps<typeof PlaybackControls>> = {}) {
  const props = {
    rate: 1,
    loop: false,
    isPlaying: false,
    onRateChange: vi.fn(),
    onLoopChange: vi.fn(),
    onStop: vi.fn(),
    ...over,
  };
  render(<PlaybackControls {...props} />);
  return props;
}

describe("speed", () => {
  it("offers every rate the playback hook supports", () => {
    setup();

    for (const rate of PLAYBACK_RATES) {
      expect(screen.getByRole("button", { name: `${rate}×` })).toBeInTheDocument();
    }
  });

  it("marks the rate in use", () => {
    setup({ rate: 0.5 });

    expect(screen.getByRole("button", { name: "0.5×" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports a change", () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: "0.5×" }));

    expect(props.onRateChange).toHaveBeenCalledWith(0.5);
  });

  it("says the speed is the reviewer's own, not the video's", () => {
    setup();

    expect(screen.getByText(/not the published video/i)).toBeInTheDocument();
  });
});

describe("loop", () => {
  it("reports being switched on", () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: /Loop/ }));

    expect(props.onLoopChange).toHaveBeenCalledWith(true);
  });

  it("reports being switched off again", () => {
    const props = setup({ loop: true });

    fireEvent.click(screen.getByRole("button", { name: /Loop/ }));

    expect(props.onLoopChange).toHaveBeenCalledWith(false);
  });

  it("shows whether it is on", () => {
    setup({ loop: true });

    expect(screen.getByRole("button", { name: /Loop/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("stopping", () => {
  it("offers a stop only while something is playing", () => {
    setup({ isPlaying: false });
    expect(screen.queryByRole("button", { name: /Stop/ })).not.toBeInTheDocument();
  });

  it("reports the stop", () => {
    const props = setup({ isPlaying: true });

    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));

    expect(props.onStop).toHaveBeenCalled();
  });
});

describe("what this bar is not", () => {
  it("does not carry its own shortcuts button", () => {
    // The toolbar above already has one, and it opens the same panel `?` does.
    // Two buttons for one panel is how a key map ends up documented twice and
    // updated once.
    setup();

    expect(screen.queryByRole("button", { name: /Shortcuts/ })).not.toBeInTheDocument();
  });
});
