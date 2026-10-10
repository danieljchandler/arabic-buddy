import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { EMPTY_QUIZ_SESSION } from "@/lib/quizSession";
import { QuizRungBadge } from "./QuizRungBadge";
import { QuizSessionSummary } from "./QuizSessionSummary";

/**
 * The two pieces of quiz chrome that say where things stand: the step badge
 * on a card, and the tally on the end screen.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("the session summary", () => {
  it("renders nothing before anything was answered", () => {
    const harness = renderWithProviders(<QuizSessionSummary stats={EMPTY_QUIZ_SESSION} />);
    cleanup = harness.cleanup;

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows accuracy, the best run and the climbs", () => {
    const harness = renderWithProviders(
      <QuizSessionSummary
        stats={{ answered: 8, correct: 6, combo: 2, bestCombo: 4, promotions: 3, demotions: 1 }}
      />,
    );
    cleanup = harness.cleanup;

    const items = screen.getAllByRole("listitem").map((i) => i.textContent);
    expect(items[0]).toContain("75%");
    expect(items[1]).toContain("4");
    expect(items[2]).toContain("3");
    expect(items[3]).toContain("1");
  });
});

describe("the step badge", () => {
  it("names the step and hides a combo under two", () => {
    const harness = renderWithProviders(<QuizRungBadge step={2} label="Fill the gap" combo={1} />);
    cleanup = harness.cleanup;

    expect(screen.getByRole("img", { name: "Step 2 of 10: Fill the gap" })).toBeInTheDocument();
    expect(screen.getByText("Fill the gap")).toBeInTheDocument();
    expect(screen.queryByLabelText(/in a row/)).not.toBeInTheDocument();
  });

  it("has a dot for every step, the top one included", () => {
    const harness = renderWithProviders(<QuizRungBadge step={10} label="In a story" />);
    cleanup = harness.cleanup;

    const badge = screen.getByRole("img", { name: "Step 10 of 10: In a story" });
    expect(badge.children).toHaveLength(10);
  });

  it("shows a run of two or more", () => {
    const harness = renderWithProviders(<QuizRungBadge step={4} label="Say it" combo={7} />);
    cleanup = harness.cleanup;

    expect(screen.getByLabelText("7 in a row")).toHaveTextContent("7");
  });
});
