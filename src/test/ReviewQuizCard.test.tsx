import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ReviewQuizCard } from "@/components/review/ReviewQuizCard";
import { VocabularyWord } from "@/hooks/useReview";

// Minimal stub for VocabularyCard so the test focuses on quiz logic
vi.mock("@/components/design-system", () => ({
  VocabularyCard: ({ word }: { word: VocabularyWord }) => (
    <div data-testid="vocabulary-card">{word.word_arabic}</div>
  ),
}));

const makeWord = (overrides: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "w1",
  word_arabic: "كلب",
  word_english: "dog",
  image_url: null,
  audio_url: null,
  topic_id: "t1",
  image_position: null,
  ...overrides,
});

const topicWords: VocabularyWord[] = [
  makeWord({ id: "w1", word_english: "dog" }),
  makeWord({ id: "w2", word_english: "cat" }),
  makeWord({ id: "w3", word_english: "bird" }),
  makeWord({ id: "w4", word_english: "fish" }),
];

describe("ReviewQuizCard", () => {
  let onAnswer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAnswer = vi.fn();
  });

  it("renders 4 answer options", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const buttons = screen.getAllByRole("button");
    // 4 answer buttons
    expect(buttons).toHaveLength(4);
  });

  it("calls onAnswer(true) when correct option is selected", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(dogButton);
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("calls onAnswer(false) when wrong option is selected", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    fireEvent.click(catButton);
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("shows result feedback after answering", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(dogButton);
    expect(screen.getByText(/correct/i)).toBeInTheDocument();
  });

  it("shows correct answer on wrong selection", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    fireEvent.click(catButton);
    expect(screen.getByText(/the answer was: dog/i)).toBeInTheDocument();
  });

  it("does not call onAnswer again after the first selection (disabled)", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(catButton);
    // All answer buttons should be disabled after the first answer
    expect(catButton).toBeDisabled();
    expect(dogButton).toBeDisabled();
    fireEvent.click(dogButton); // should be a no-op
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
