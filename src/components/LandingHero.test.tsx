import { act, fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { setBrandPreview } from "@/lib/brandPreview";
import { LandingHero } from "./LandingHero";

/**
 * The signed-out landing hero. By default it is the painted campfire page;
 * under the Ink brand preview it is Ink's own hero (tested in
 * ink/InkLandingHero.test.tsx). Pinned here: which one renders when, and
 * that both offer the same way in.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  act(() => setBrandPreview(null));
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

const render = () => {
  const harness = renderWithProviders(
    <>
      <LandingHero />
      <Where />
    </>,
    { route: "/" },
  );
  cleanup = harness.cleanup;
  return harness;
};

describe("LandingHero", () => {
  it("is the painted page for anyone not previewing", () => {
    const { container } = render();
    expect(screen.getByRole("heading", { level: 1, name: /real spoken arabic/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Hikaya" }).tagName).toBe("IMG");
    expect(screen.getByRole("img", { name: "Gulf Arabic illustration" })).toBeInTheDocument();
    expect(container.querySelector("[data-ink-landing]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /join the beta/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /try the placement quiz/i })).toBeInTheDocument();
  });

  it("sends Join the beta to sign-up and the quiz to the quiz", () => {
    render();
    fireEvent.click(screen.getAllByRole("button", { name: /join the beta/i })[0]);
    expect(screen.getByTestId("where")).toHaveTextContent("/auth");
    fireEvent.click(screen.getByRole("button", { name: /try the placement quiz/i }));
    expect(screen.getByTestId("where")).toHaveTextContent("/placement");
  });

  it("is Ink's own hero under the Ink preview, with no painted scenes", () => {
    act(() => setBrandPreview("ink"));
    const { container } = render();
    expect(container.querySelector("[data-ink-landing]")).not.toBeNull();
    // The only pictures are the logo's own two files (day and night).
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.getAttribute("src")).toMatch(/hikaya-sadu-harakat-lockup/);
    expect(screen.getByRole("heading", { level: 1, name: /real spoken arabic/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /join the beta/i })).toHaveLength(2);
  });
});
