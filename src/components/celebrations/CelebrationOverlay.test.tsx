import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARDAH } from "@/lib/dances";
import { CHEERS, TIER_DURATION_MS } from "@/lib/celebrations";
import { CelebrationOverlay } from "./CelebrationOverlay";

/**
 * The celebration over the whole screen. It must say what happened, get out
 * of the way by itself, end early for a learner who wants to move on, not
 * have its clock restarted by the page underneath re-rendering, and give a
 * line that joins it late the time to be read.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Props = ComponentProps<typeof CelebrationOverlay>;

const props = (overrides: Partial<Props> = {}): Props => ({
  open: true,
  dance: ARDAH,
  dialect: "Gulf",
  tier: "medium",
  cheer: CHEERS.Gulf[0],
  title: "Lesson complete!",
  subtitle: "You finished “At the souq”.",
  onClose: vi.fn(),
  ...overrides,
});

const show = (overrides: Partial<Props> = {}) => render(<CelebrationOverlay {...props(overrides)} />);

describe("CelebrationOverlay", () => {
  it("is a dialog named for the milestone, saying what was done and what the cheer means", () => {
    show();
    const dialog = screen.getByRole("dialog", { name: "Lesson complete!" });
    expect(dialog).toHaveAccessibleDescription("You finished “At the souq”.");
    expect(screen.getByRole("img", { name: "Al-Ardah, a dance from Najd, Saudi Arabia" })).toBeInTheDocument();
    expect(screen.getByText("Kafu!")).toBeInTheDocument();
    expect(screen.getByText(/Well done!/)).toBeInTheDocument();
  });

  it("lists the moments that joined it", () => {
    show({ extras: ["Badge earned! First Steps", "Daily goal reached!"] });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Badge earned! First Steps",
      "Daily goal reached!",
    ]);
  });

  it("still celebrates without a dancer", () => {
    show({ dance: null, dialect: "Yemeni", cheer: CHEERS.Yemeni[0] });
    expect(screen.getByRole("dialog", { name: "Lesson complete!" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("closes itself when its tier has played", () => {
    const onClose = vi.fn();
    show({ onClose });
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
    const { rerender } = show({ onClose: first });
    act(() => {
      vi.advanceTimersByTime(TIER_DURATION_MS.medium - 100);
    });
    const second = vi.fn();
    rerender(<CelebrationOverlay {...props({ onClose: second })} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("starts the clock over when a line joins, so it isn't taken away half-read", () => {
    const onClose = vi.fn();
    const { rerender } = show({ onClose });
    act(() => {
      vi.advanceTimersByTime(TIER_DURATION_MS.medium - 100);
    });
    rerender(<CelebrationOverlay {...props({ onClose, extras: ["Badge earned! First Steps"], clockKey: 1 })} />);
    act(() => {
      vi.advanceTimersByTime(TIER_DURATION_MS.medium - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends early on Continue", () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("ends early on Escape", () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ends early on a tap around the stage", () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps playing on a tap on the stage itself", () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.click(screen.getByTestId("celebration-scene"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    show({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
