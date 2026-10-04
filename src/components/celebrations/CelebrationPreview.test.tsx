import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CelebrationPreview } from "./CelebrationPreview";

/**
 * `?celebrate=` plays a scene on any page. A lesson only celebrates the first
 * time it is finished, so this is how a scene gets reviewed more than once —
 * and it must take itself out of the address, or every reload replays it.
 */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("CelebrationPreview", () => {
  it("plays the named dance and takes the parameter out of the address", () => {
    window.history.replaceState(null, "", "/today?dialect=gulf&celebrate=ardah-large#top");
    render(<CelebrationPreview />);
    expect(screen.getByRole("dialog", { name: "كفو! Preview" })).toBeInTheDocument();
    expect(window.location.search).toBe("?dialect=gulf");
    expect(window.location.hash).toBe("#top");
  });

  it("goes away when it's dismissed", () => {
    window.history.replaceState(null, "", "/?celebrate=ardah");
    render(<CelebrationPreview />);
    act(() => {
      screen.getByRole("button", { name: "Continue" }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does nothing without the parameter, or for a dance that doesn't exist", () => {
    window.history.replaceState(null, "", "/?celebrate=dabke");
    const { container } = render(<CelebrationPreview />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
