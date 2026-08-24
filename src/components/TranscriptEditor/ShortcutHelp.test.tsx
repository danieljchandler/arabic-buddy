import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ShortcutHelp from "./ShortcutHelp";
import { SHORTCUTS } from "@/lib/transcriptShortcuts";

/**
 * The keyboard map on screen.
 *
 * Generated from the same table the resolver reads, so the thing worth
 * asserting is that it really is generated: a hand-written panel drifts from
 * the shortcuts within a release, and a shortcut nobody can discover is one
 * nobody uses.
 */

describe("the shortcut panel", () => {
  it("lists every shortcut the editor defines", () => {
    render(<ShortcutHelp onClose={vi.fn()} />);

    for (const spec of SHORTCUTS) {
      expect(screen.getAllByText(spec.label).length).toBeGreaterThan(0);
    }
  });

  it("groups them by what the reviewer is doing", () => {
    render(<ShortcutHelp onClose={vi.fn()} />);

    for (const group of ["Navigate", "Listen", "Edit", "Review", "Timing"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  it("explains that letter keys are letters inside a text box", () => {
    // The one rule a user has to know to make sense of the rest.
    render(<ShortcutHelp onClose={vi.fn()} />);

    expect(screen.getByText(/when you are not typing in a box/i)).toBeInTheDocument();
  });

  it("closes on the button", () => {
    const onClose = vi.fn();
    render(<ShortcutHelp onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Close keyboard shortcuts/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutHelp onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("stops listening for Escape once it is gone", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ShortcutHelp onClose={onClose} />);

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("announces itself as a dialog", () => {
    render(<ShortcutHelp onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /Keyboard shortcuts/i })).toBeInTheDocument();
  });
});
