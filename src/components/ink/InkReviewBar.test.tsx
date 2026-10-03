import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InkReviewBar } from "./InkReviewBar";

/**
 * The chooser's Review bar in Ink. It must say what the default bar says —
 * review.spec reads "3 cards ready now" and "caught up" off it — and be one
 * of the dark panels the sadu is pressed into.
 */
const renderBar = (due: number) =>
  render(
    <MemoryRouter>
      <InkReviewBar due={due} />
    </MemoryRouter>,
  );

describe("InkReviewBar", () => {
  it("leads with the count and goes to the review queue", () => {
    renderBar(12);
    const link = screen.getByRole("link", { name: /Review/ });
    expect(link).toHaveAttribute("href", "/review");
    expect(link).toHaveTextContent("12 cards ready now");
    expect(link).toHaveAttribute("data-ink-sadu");
    expect(screen.getByText("12")).toHaveClass("font-ink-serif");
  });

  it("counts one card in the singular", () => {
    renderBar(1);
    expect(screen.getByRole("link")).toHaveTextContent("1 card ready now");
  });

  it("says plainly when nothing is due", () => {
    renderBar(0);
    expect(screen.getByRole("link")).toHaveTextContent("Nothing due — you are caught up");
  });
});
