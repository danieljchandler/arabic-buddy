import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageSkeleton, shapeForPath } from "./skeleton-page";

/**
 * The loading fallback every lazy route falls through.
 *
 * The property under test is that the silhouette matches the destination. A
 * skeleton that promises a card grid and delivers a video player makes the
 * layout visibly rearrange itself on arrival, which reads as a glitch — worse
 * than having shown nothing.
 */

describe("choosing a shape for the route", () => {
  it.each([
    ["/", "feed"],
    ["/discover", "feed"],
    ["/discover/abc123", "feed"],
    ["/review", "card"],
    ["/review/my-phrases", "card"],
    ["/quiz/lesson-1", "card"],
    ["/learn/lesson-1", "card"],
    ["/my-words", "list"],
    ["/leaderboard", "list"],
    ["/me", "hub"],
    ["/choose", "hub"],
    ["/today", "page"],
    ["/settings", "page"],
  ])("sends %s to the %s shape", (path, shape) => {
    expect(shapeForPath(path)).toBe(shape);
  });

  it("decides /review/my-words as a card before the my-words list rule can claim it", () => {
    // Ordering, pinned: both rules match this path, and the review screen is
    // one card at a time rather than a column of saved words.
    expect(shapeForPath("/review/my-words")).toBe("card");
    expect(shapeForPath("/my-words")).toBe("list");
  });

  it("is case-insensitive, because a pasted link may not be", () => {
    expect(shapeForPath("/Review")).toBe("card");
  });

  it("falls back to the general page shape for anything unrecognised", () => {
    // ~70 routes share five shapes; a new one that nobody classified should
    // get the neutral silhouette rather than crash or render nothing.
    expect(shapeForPath("/some-route-added-next-year")).toBe("page");
  });
});

describe("rendering", () => {
  const at = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <PageSkeleton />
      </MemoryRouter>,
    );

  it("carries the test id the e2e suite waits on, whichever shape it picked", () => {
    // routes.spec.ts waits for this to disappear rather than racing the
    // loader across every route in the app. A shape that dropped it would
    // make that wait resolve instantly and the assertions race the page.
    for (const path of ["/", "/review", "/my-words", "/me", "/today"]) {
      const { unmount } = at(path);
      expect(screen.getByTestId("page-skeleton")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the review shape with its four grading buttons", () => {
    at("/review");

    // The learner's hand is already going for these; showing four slots is
    // the whole reason the card shape is separate from the page shape.
    const { container } = { container: screen.getByTestId("page-skeleton") };
    expect(container.querySelectorAll(".grid-cols-4 > *")).toHaveLength(4);
  });
});
