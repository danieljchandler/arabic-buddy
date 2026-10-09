import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ReviewStyleSwitch } from "./ReviewStyleSwitch";

/**
 * The header switch is the Settings row where the decision is made. It has
 * to read the same preference and write the same one, so a tap here is what
 * the learner sees on their next device.
 */

const KEY = "hakiya:review-style";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render() {
  const harness = renderWithProviders(<ReviewStyleSwitch />);
  cleanup = harness.cleanup;
  return harness;
}

describe("the switch", () => {
  it("starts on Flip for a learner who has not chosen", () => {
    render();

    expect(screen.getByRole("radio", { name: /flip/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /quiz/i })).toHaveAttribute("aria-checked", "false");
  });

  it("reflects a stored choice", () => {
    localStorage.setItem(KEY, "quiz");
    render();

    expect(screen.getByRole("radio", { name: /quiz/i })).toHaveAttribute("aria-checked", "true");
  });

  it("switches and stores the choice", () => {
    render();

    fireEvent.click(screen.getByRole("radio", { name: /quiz/i }));

    expect(screen.getByRole("radio", { name: /quiz/i })).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(KEY)).toBe("quiz");

    fireEvent.click(screen.getByRole("radio", { name: /flip/i }));

    expect(localStorage.getItem(KEY)).toBe("flashcards");
  });
});
