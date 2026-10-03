import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  BRAND_FONT_LINK_ID,
  BRAND_PREVIEW_STORAGE_KEY,
  setBrandPreview,
} from "@/lib/brandPreview";
import { BrandPreviewSwitcher } from "./BrandPreviewSwitcher";

/**
 * The floating switcher for the opt-in brand preview.
 *
 * The case this file exists for is the first one: with no preview active the
 * component renders nothing. It is mounted at the app root for everyone, so
 * that null is the whole of what a learner who never opened a `?brand=` link
 * gets from it.
 *
 * The rest pins what makes it usable for the owner clicking through a deploy
 * preview: it says which direction is showing, switching is one tap and
 * lands on <html> immediately, Current keeps the switcher so the comparison
 * can continue, and × ends the preview entirely.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  act(() => setBrandPreview(null));
});

const render = () => {
  const harness = renderWithProviders(<BrandPreviewSwitcher />, { route: "/today" });
  cleanup = harness.cleanup;
};

const html = () => document.documentElement;

describe("BrandPreviewSwitcher", () => {
  it("renders nothing when no preview is active", () => {
    render();
    expect(screen.queryByRole("group", { name: "Brand preview" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the four options and marks the active direction as pressed", () => {
    act(() => setBrandPreview("ink"));
    render();

    const group = screen.getByRole("group", { name: "Brand preview" });
    expect(group).toHaveAttribute("data-feedback-ignore", "true");

    expect(screen.getByRole("button", { name: "Preview the Ink direction" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of [
      "Preview the previous look",
      "Preview the Weave direction",
      "Preview the Souq direction",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    // Visible labels, in order.
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Current",
      "Weave",
      "Ink",
      "Souq",
      "",
    ]);
  });

  it("switches direction on click, on <html> and in storage", () => {
    act(() => setBrandPreview("weave"));
    render();

    fireEvent.click(screen.getByRole("button", { name: "Preview the Souq direction" }));

    expect(html().getAttribute("data-brand")).toBe("souq");
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBe("souq");
    expect(screen.getByRole("button", { name: "Preview the Souq direction" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Preview the Weave direction" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Current shows today's look but keeps the switcher, so the comparison can go on", () => {
    act(() => setBrandPreview("weave"));
    render();

    fireEvent.click(screen.getByRole("button", { name: "Preview the previous look" }));

    expect(html().hasAttribute("data-brand")).toBe(false);
    expect(document.getElementById(BRAND_FONT_LINK_ID)).toBeNull();
    expect(screen.getByRole("button", { name: "Preview the previous look" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview the Weave direction" }));
    expect(html().getAttribute("data-brand")).toBe("weave");
  });

  it("× turns the preview off and the switcher goes away", () => {
    act(() => setBrandPreview("souq"));
    render();

    fireEvent.click(screen.getByRole("button", { name: "Turn off brand preview" }));

    expect(html().hasAttribute("data-brand")).toBe(false);
    expect(localStorage.getItem(BRAND_PREVIEW_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("group", { name: "Brand preview" })).toBeNull();
  });

  it("appears when a preview is switched on after mount", () => {
    render();
    expect(screen.queryByRole("group", { name: "Brand preview" })).toBeNull();

    act(() => setBrandPreview("ink"));

    expect(screen.getByRole("group", { name: "Brand preview" })).toBeInTheDocument();
  });
});
