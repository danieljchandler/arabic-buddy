import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { RatingButtons } from "./RatingButtons";

/**
 * The four FSRS grades under every review card.
 *
 * Two gates matter to scheduler integrity and are pinned here. `disabled`
 * holds all four buttons until the answer is revealed — rating before
 * checking is a judgment-of-learning, which runs overconfident, and every
 * inflated "Good" writes a too-long interval. `maxRating` caps the offered
 * grades when an objective check (the cloze card) has just measured a
 * failure: "Good" after a wrong pick would contradict the evidence.
 */

const baseProps = {
  stability: 3,
  difficulty: 5,
  intervalDays: 1,
  repetitions: 2,
  elapsedDays: 1,
};

describe("RatingButtons", () => {
  it("holds every grade until the answer is revealed", () => {
    const onRate = vi.fn();
    renderWithProviders(<RatingButtons {...baseProps} onRate={onRate} disabled />);

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      const button = screen.getByText(label).closest("button")!;
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onRate).not.toHaveBeenCalled();
  });

  it("offers all four grades once enabled", () => {
    const onRate = vi.fn();
    renderWithProviders(<RatingButtons {...baseProps} onRate={onRate} />);

    fireEvent.click(screen.getByText("Easy").closest("button")!);
    expect(onRate).toHaveBeenCalledWith("easy");
  });

  it("caps the offered grades after a measured failure", () => {
    const onRate = vi.fn();
    renderWithProviders(
      <RatingButtons {...baseProps} onRate={onRate} maxRating="hard" />,
    );

    expect(screen.getByText("Good").closest("button")).toBeDisabled();
    expect(screen.getByText("Easy").closest("button")).toBeDisabled();

    // The honest grades stay live.
    fireEvent.click(screen.getByText("Again").closest("button")!);
    expect(onRate).toHaveBeenCalledWith("again");
    fireEvent.click(screen.getByText("Hard").closest("button")!);
    expect(onRate).toHaveBeenCalledWith("hard");
  });
});
