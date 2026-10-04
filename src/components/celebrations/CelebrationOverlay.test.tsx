import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARDAH, TIER_DURATION_MS } from "@/lib/celebrations";
import { CelebrationOverlay } from "./CelebrationOverlay";

/**
 * The celebration over the whole screen. It must get out of the way by
 * itself, end early for a learner who wants to move on, and not have its
 * clock restarted by the page underneath re-rendering.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const show = (onClose = vi.fn(), tier: "small" | "medium" | "large" = "medium") =>
  render(<CelebrationOverlay open dance={ARDAH} tier={tier} headline="Lesson complete" onClose={onClose} />);

describe("CelebrationOverlay", () => {
  it("is a dialog named for the praise and the milestone", () => {
    show();
    expect(screen.getByRole("dialog", { name: "كفو! Lesson complete" })).toBeInTheDocument();
    expect(screen.getByText("Al-Ardah, a dance from Najd, Saudi Arabia.")).toBeInTheDocument();
  });

  it("closes itself when its tier has played", () => {
    const onClose = vi.fn();
    show(onClose, "medium");
    act(() => {
      vi.advanceTimersByTime(TIER_DURATION_MS.medium - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not restart the clock when the page re-renders it", () => {
    const first = vi.fn();
    const { rerender } = show(first);
    act(() => {
      vi.advanceTimersByTime(TIER_DURATION_MS.medium - 100);
    });
    const second = vi.fn();
    rerender(<CelebrationOverlay open dance={ARDAH} tier="medium" headline="Lesson complete" onClose={second} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("ends early on Continue", () => {
    const onClose = vi.fn();
    show(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("ends early on Escape", () => {
    const onClose = vi.fn();
    show(onClose);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ends early on a tap around the stage", () => {
    const onClose = vi.fn();
    show(onClose);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps playing on a tap on the stage itself", () => {
    const onClose = vi.fn();
    show(onClose);
    fireEvent.click(screen.getByTestId("celebration-scene"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(<CelebrationOverlay open={false} dance={ARDAH} tier="medium" headline="x" onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
