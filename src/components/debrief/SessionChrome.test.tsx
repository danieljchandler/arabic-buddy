import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ListenButton, StepChecklist } from "./SessionChrome";

/**
 * The chrome the guided tutor sessions share. The checklist has to say which
 * step the learner is on and which are behind them, for any set of steps;
 * the listen link has to exist only where there is Arabic to read.
 */

const speech = vi.hoisted(() => ({ fetchSpeechBlob: vi.fn() }));
vi.mock("@/lib/speakArabic", () => ({ fetchSpeechBlob: speech.fetchSpeechBlob }));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  speech.fetchSpeechBlob.mockReset();
});

type Step = "one" | "two" | "three";
const labels: Record<Step, string> = { one: "First", two: "Second", three: "Third" };

describe("StepChecklist", () => {
  it("marks the current step and ticks the finished ones, in the labels it is given", () => {
    cleanup = renderWithProviders(
      <StepChecklist<Step> steps={["one", "two", "three"]} current="two" done={new Set<Step>(["one"])} labels={labels} />,
    ).cleanup;

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["First", "2Second", "3Third"]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0].querySelector('[aria-label="Done"]')).not.toBeNull();
  });

  it("has no current step once the session is over", () => {
    cleanup = renderWithProviders(
      <StepChecklist<Step> steps={["one", "two"]} current={null} done={new Set<Step>(["one", "two"])} labels={labels} />,
    ).cleanup;
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
    expect(screen.getAllByLabelText("Done")).toHaveLength(2);
  });
});

describe("ListenButton", () => {
  it("is not there for a message with no Arabic in it", () => {
    cleanup = renderWithProviders(<ListenButton text="Well done, keep going." dialect="Gulf" />).cleanup;
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads only the Arabic aloud, in the session's dialect", async () => {
    speech.fetchSpeechBlob.mockResolvedValue(null);
    cleanup = renderWithProviders(<ListenButton text="Say: شلونك اليوم؟ — then: زين" dialect="Egyptian" />).cleanup;

    fireEvent.click(screen.getByRole("button", { name: /listen to the arabic/i }));

    await waitFor(() => expect(speech.fetchSpeechBlob).toHaveBeenCalledTimes(1));
    expect(speech.fetchSpeechBlob).toHaveBeenCalledWith({ text: "شلونك اليوم؟، زين", dialect: "Egyptian" });
  });
});
