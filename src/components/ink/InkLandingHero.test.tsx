import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InkLandingHero } from "./InkLandingHero";

/**
 * The signed-out landing hero in Ink.
 *
 * The page a stranger judges the product by, re-set as type. What must not
 * move is everything they can act on: the headline the smoke test reads, the
 * two CTAs and the closing one, with the default hero's words and
 * destinations. Past that: the name drawn big with its kasra, the three
 * value points numbered, the three dialects, and no fake play button.
 */

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

const renderHero = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<><InkLandingHero /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

describe("InkLandingHero", () => {
  it("leads with the promise, 'spoken' under the highlighter", () => {
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1, name: /real spoken arabic, one story at a time/i });
    const spoken = screen.getByText("spoken");
    expect(h1).toContainElement(spoken);
    expect(spoken.className).toContain("bg-[#E2B65C]");
  });

  it("carries the lockup, and the name drawn big", () => {
    renderHero();
    expect(screen.getByRole("img", { name: "Hikaya" })).toHaveAttribute("data-ink-mark-kind", "lockup");
    // حِكَايَة, kasra and all, breaking out of the oxblood panel.
    const big = document.querySelector('[data-ink-landing] .font-ink-display[aria-hidden="true"]');
    expect(big?.textContent?.startsWith("حِ")).toBe(true);
  });

  it("sends Join the beta to sign-up, from the hero and from the close", () => {
    renderHero();
    const joins = screen.getAllByRole("button", { name: /join the beta/i });
    expect(joins).toHaveLength(2);
    fireEvent.click(joins[0]);
    expect(screen.getByTestId("where")).toHaveTextContent("/auth");
  });

  it("sends the closing Join the beta to sign-up too", () => {
    renderHero();
    fireEvent.click(screen.getAllByRole("button", { name: /join the beta/i })[1]);
    expect(screen.getByTestId("where")).toHaveTextContent("/auth");
  });

  it("sends the placement quiz to the quiz", () => {
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: /try the placement quiz/i }));
    expect(screen.getByTestId("where")).toHaveTextContent("/placement");
  });

  it("numbers the three value points", () => {
    renderHero();
    const values = screen.getAllByRole("listitem").filter((li) => li.closest("ol"));
    expect(values).toHaveLength(3);
    expect(values.map((v) => v.querySelector("h2")!.textContent)).toEqual([
      "Told by native voices",
      "Every story stays with you",
      "Stories you'd actually watch",
    ]);
    values.forEach((v, i) => expect(v).toHaveTextContent(`0${i + 1}`));
  });

  it("names the three dialects in English and Arabic, on a sadu ink band", () => {
    const { container } = renderHero();
    for (const name of ["Gulf", "Egyptian", "Yemeni"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    for (const word of ["خليـــجي", "مصـــري", "يمـــني"]) {
      expect(screen.getByText(word)).toHaveAttribute("lang", "ar");
    }
    // Sadu on the two dark panels, and nowhere else.
    expect(container.querySelectorAll("[data-ink-sadu]")).toHaveLength(2);
  });

  it("does not draw a play button that plays nothing", () => {
    renderHero();
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
