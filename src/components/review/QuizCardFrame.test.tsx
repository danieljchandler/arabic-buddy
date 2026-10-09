import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { QuizCardFrame, type QuizItem } from "./QuizCardFrame";

/**
 * The frame is where the ladder meets the cards. What it has to get right is
 * the hand-off: the question a card's memory state calls for, the fallback
 * when the material is missing, and one rating per card, delivered when the
 * learner moves on rather than the instant they answer.
 */

const tts = vi.hoisted(() => ({ urls: {} as Record<string, string> }));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => ({
    ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
    isLoading: false,
    regenerate: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }),
}));

const recorder = vi.hoisted(() => ({ supported: true }));
vi.mock("@/hooks/useTakeRecorder", () => ({
  recordingSupported: () => recorder.supported,
  useTakeRecorder: () => ({ isRecording: false, start: vi.fn(async () => false), stop: vi.fn(), error: null, supported: recorder.supported }),
}));

const SENTENCE = "رحت السوق أمس";
const POOL = [
  { arabic: "بيت", english: "house" },
  { arabic: "مدرسة", english: "school" },
  { arabic: "مطعم", english: "restaurant" },
  { arabic: "سيارة", english: "car" },
];

const anItem = (over: Partial<QuizItem> = {}): QuizItem => ({
  id: "card-1",
  arabic: "السوق",
  english: "the market",
  sentence: { arabic: SENTENCE, english: "I went to the market yesterday" },
  direction: "recognition",
  memory: { stability: 0, repetitions: 0 },
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  recorder.supported = true;
  (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).mockClear?.();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(item: QuizItem, over: Partial<Parameters<typeof QuizCardFrame>[0]> = {}) {
  const onGraded = vi.fn();
  const renderFlashcard = vi.fn(() => <div>the flip card</div>);
  const harness = renderWithProviders(
    <QuizCardFrame item={item} pool={POOL} onGraded={onGraded} renderFlashcard={renderFlashcard} {...over} />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onGraded, renderFlashcard };
}

const arabicChoices = () => screen.getAllByRole("button").filter((b) => b.getAttribute("dir") === "rtl");

describe("which question is asked", () => {
  it("asks a new word to fill the gap, with its meaning as a hint", () => {
    render(anItem());

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.getByText(/the missing word means/i)).toHaveTextContent("the market");
    expect(screen.getByRole("img", { name: /step 1 of 5/i })).toBeInTheDocument();
  });

  it("drops the hint once the word is young rather than new", () => {
    render(anItem({ memory: { stability: 3, repetitions: 1 } }));

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.queryByText(/the missing word means/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 2 of 5/i })).toBeInTheDocument();
  });

  it("asks for the meaning when there is no sentence to cut", () => {
    render(anItem({ sentence: null }));

    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.textContent?.trim())).toContain("the market");
  });

  it("treats a sentence without the word in it as no sentence", () => {
    render(anItem({ sentence: { arabic: "رحت المطعم أمس" } }));

    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
  });

  it("plays the audio alone once the word is settled", () => {
    render(anItem({ memory: { stability: 30, repetitions: 4 } }));

    expect(screen.getByText("What did you hear?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 3 of 5/i })).toBeInTheDocument();
  });

  it("asks a production card to be said", () => {
    render(anItem({ direction: "production", memory: { stability: 2, repetitions: 1 } }));

    expect(screen.getByText("Say it in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 4 of 5/i })).toBeInTheDocument();
  });

  it("falls back to the flip card when there are too few other words", () => {
    const { renderFlashcard } = render(anItem(), { pool: POOL.slice(0, 2) });

    expect(renderFlashcard).toHaveBeenCalled();
    expect(screen.getByText("the flip card")).toBeInTheDocument();
    expect(screen.queryByText("Fill in the missing word")).not.toBeInTheDocument();
  });

  it("falls back to the flip card for a production card the device cannot record", () => {
    recorder.supported = false;
    render(anItem({ direction: "production", memory: { stability: 2, repetitions: 1 } }));

    expect(screen.getByText("the flip card")).toBeInTheDocument();
  });

  it("never offers the word itself, or a repeat, as a wrong option", () => {
    render(anItem(), { pool: [...POOL, { arabic: "السُّوق", english: "the market" }, { arabic: "بَيت", english: "a house" }] });

    const labels = arabicChoices().map((b) => b.textContent?.trim());
    expect(labels.filter((l) => l === "السوق")).toHaveLength(1);
    expect(labels).not.toContain("السُّوق");
    expect(labels.filter((l) => l === "بيت" || l === "بَيت")).toHaveLength(1);
  });
});

describe("turning an answer into a rating", () => {
  it("rates a right gap Good, once the learner moves on", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    expect(onGraded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onGraded).toHaveBeenCalledTimes(1);
    expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "cloze-hint", step: 1 });
  });

  it("rates a wrong gap Again", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() !== "السوق")!);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "again", correct: false }));
  });

  it("rates a meaning picked with the sentence open Hard", () => {
    const { onGraded } = render(anItem({ sentence: null, memory: { stability: 30, repetitions: 4 } }), {
      pool: POOL,
    });
    // No sentence on the card means no hint to open; give it one via a
    // settled card instead.
    cleanup?.();
    const settled = render(
      anItem({ memory: { stability: 30, repetitions: 4 }, sentence: { arabic: "البيت كبير", english: "the house is big" }, arabic: "البيت", english: "the house" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /show the sentence/i }));
    fireEvent.click(screen.getAllByRole("radio").find((r) => r.textContent?.trim() === "the house")!);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(settled.onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "hard", correct: true, format: "listen" }));
    expect(onGraded).not.toHaveBeenCalled();
  });

  it("moves on with Enter once answered, and not before", () => {
    const { onGraded } = render(anItem());

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onGraded).not.toHaveBeenCalled();

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onGraded).toHaveBeenCalledTimes(1);
  });

  it("ignores the rating keys", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    fireEvent.keyDown(window, { key: "3" });

    expect(onGraded).not.toHaveBeenCalled();
  });

  it("shows the combo beside the step", () => {
    render(anItem(), { combo: 4 });

    expect(screen.getByLabelText("4 in a row")).toBeInTheDocument();
  });
});
