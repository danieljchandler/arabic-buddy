import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { QuizItem } from "@/lib/videoDebrief";
import { DebriefQuizCard } from "./DebriefQuizCard";

/**
 * The debrief's word quiz. What matters: every answer is reported as it is
 * given (that is when a saved word's card is rescheduled), the translation of
 * the line stays hidden until the answer is in, and the finished quiz reports
 * exactly what was picked.
 */

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const tired: QuizItem = {
  id: "q1",
  arabic: "تعبان",
  english: "tired",
  source: "saved",
  vocabularyId: "v1",
  sentence: "والله تعبان شوي",
  sentenceEnglish: "Honestly a bit tired",
  options: ["happy", "tired", "late", "rest"],
  answerIndex: 1,
};

const lastNight: QuizItem = {
  id: "q2",
  arabic: "البارحة",
  english: "last night",
  source: "key_vocab",
  options: [],
  answerIndex: -1,
};

function render(items: QuizItem[], outcomes?: Parameters<typeof DebriefQuizCard>[0]["outcomes"]) {
  const onAnswer = vi.fn();
  const onComplete = vi.fn();
  const harness = renderWithProviders(
    <DebriefQuizCard items={items} outcomes={outcomes} onAnswer={onAnswer} onComplete={onComplete} />,
  );
  cleanup = harness.cleanup;
  return { onAnswer, onComplete };
}

describe("DebriefQuizCard", () => {
  it("asks for the meaning without giving away the line's translation", () => {
    render([tired]);
    expect(screen.getByText("تعبان")).toBeInTheDocument();
    expect(screen.getByText("والله تعبان شوي")).toBeInTheDocument();
    expect(screen.getByText("You saved this")).toBeInTheDocument();
    expect(screen.queryByText(/Honestly a bit tired/)).not.toBeInTheDocument();
  });

  it("reports a right answer at once, and then shows the line in English", () => {
    const { onAnswer } = render([tired]);
    fireEvent.click(screen.getByRole("button", { name: "tired" }));
    expect(onAnswer).toHaveBeenCalledWith(tired, true);
    expect(screen.getByText("Right!")).toBeInTheDocument();
    expect(screen.getByText(/Honestly a bit tired/)).toBeInTheDocument();
  });

  it("corrects a wrong answer and takes no second pick", () => {
    const { onAnswer } = render([tired]);
    fireEvent.click(screen.getByRole("button", { name: "late" }));
    expect(onAnswer).toHaveBeenCalledWith(tired, false);
    expect(screen.getByText('It means "tired".')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tired" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("asks a word with no options as recall, on the learner's word", () => {
    const { onAnswer } = render([lastNight]);
    expect(screen.queryByText("last night")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show the meaning/i }));
    expect(screen.getByText("last night")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));
    expect(onAnswer).toHaveBeenCalledWith(lastNight, false);
  });

  it("hands back every answer when the last word is done", () => {
    const { onComplete } = render([tired, lastNight]);
    fireEvent.click(screen.getByRole("button", { name: "late" }));
    fireEvent.click(screen.getByRole("button", { name: /next word/i }));
    expect(screen.getByText("Word 2 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show the meaning/i }));
    fireEvent.click(screen.getByRole("button", { name: /i knew it/i }));
    fireEvent.click(screen.getByRole("button", { name: /finish the quiz/i }));
    expect(onComplete).toHaveBeenCalledWith([
      { arabic: "تعبان", english: "tired", correct: false, chosen: "late" },
      { arabic: "البارحة", english: "last night", correct: true },
    ]);
  });

  it("shows what happened once finished", () => {
    render([tired, lastNight], [
      { arabic: "تعبان", english: "tired", correct: true },
      { arabic: "البارحة", english: "last night", correct: false },
    ]);
    expect(screen.getByText("Quiz: 1 of 2 right")).toBeInTheDocument();
    expect(screen.getByLabelText("Knew it")).toBeInTheDocument();
    expect(screen.getByLabelText("Missed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
