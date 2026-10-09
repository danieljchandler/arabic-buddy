import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { QuizChoiceCard } from "./QuizChoiceCard";

/**
 * The meaning question, shown or heard.
 *
 * The difference between the two formats is the whole point: the heard
 * version must not print the Arabic before the answer, or it is the shown
 * version with extra steps. And the sentence hint has to be honest about
 * itself — opening it before answering is help, and the answer says so.
 */

const tts = vi.hoisted(() => ({ urls: {} as Record<string, string> }));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => ({
    ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
    isLoading: false,
    regenerate: vi.fn(),
  }),
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const WORD = "سوق";
const MEANING = "market";
const POOL = ["house", "school", "restaurant", "car"];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  audio.play.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

type Props = Partial<Parameters<typeof QuizChoiceCard>[0]>;

function render(over: Props = {}) {
  const onAnswer = vi.fn();
  const harness = renderWithProviders(
    <QuizChoiceCard
      format="meaning"
      id="card-1"
      arabic={WORD}
      english={MEANING}
      pool={POOL}
      onAnswer={onAnswer}
      {...over}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onAnswer };
}

const options = () => screen.getAllByRole("radio");
const pick = (label: string) => fireEvent.click(options().find((o) => o.textContent?.trim() === label)!);

describe("the shown question", () => {
  it("shows the Arabic and four meanings, the right one among them", () => {
    render();

    expect(screen.getByText(WORD)).toBeInTheDocument();
    const labels = options().map((o) => o.textContent?.trim());
    expect(labels).toHaveLength(4);
    expect(labels).toContain(MEANING);
  });

  it("keeps the options where they are across re-renders", () => {
    const { rerender } = render();
    const before = options().map((o) => o.textContent?.trim());

    rerender(
      <QuizChoiceCard format="meaning" id="card-1" arabic={WORD} english={MEANING} pool={POOL} onAnswer={vi.fn()} />,
    );

    expect(options().map((o) => o.textContent?.trim())).toEqual(before);
  });

  it("reports a right answer as right, with no help used", () => {
    const { onAnswer } = render();

    pick(MEANING);

    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: false });
    expect(screen.getByRole("status")).toHaveTextContent(/correct/i);
  });

  it("reports a wrong answer and shows the meaning", () => {
    const { onAnswer } = render();

    pick(options().map((o) => o.textContent!.trim()).find((l) => l !== MEANING)!);

    expect(onAnswer).toHaveBeenCalledWith({ correct: false, hintUsed: false });
    expect(screen.getByRole("status")).toHaveTextContent(`means "${MEANING}"`);
  });

  it("takes one answer only", () => {
    const { onAnswer } = render();

    pick(MEANING);
    pick(options().map((o) => o.textContent!.trim()).find((l) => l !== MEANING)!);

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("plays the word on request, from the recording when there is one", () => {
    render({ audioUrl: "https://audio.test/souq.mp3" });

    fireEvent.click(screen.getByRole("button", { name: /play the word/i }));

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
  });

  it("does not play itself", () => {
    tts.urls[WORD] = "blob:souq";
    render();

    expect(audio.play).not.toHaveBeenCalled();
  });
});

describe("the heard question", () => {
  it("hides the Arabic until the answer and plays itself once", () => {
    tts.urls[WORD] = "blob:souq";
    render({ format: "listen" });

    expect(screen.queryByText(WORD)).not.toBeInTheDocument();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledWith("blob:souq");

    pick(MEANING);

    // The word is the answer; after answering it is shown so the sound and
    // the spelling meet.
    expect(screen.getByText(WORD)).toBeInTheDocument();
  });

  it("offers to play again", () => {
    tts.urls[WORD] = "blob:souq";
    render({ format: "listen" });
    audio.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /play the word again/i }));

    expect(audio.play).toHaveBeenCalledWith("blob:souq");
  });
});

describe("the sentence hint", () => {
  const context = { arabic: "رحت السوق أمس", english: "I went to the market yesterday" };

  it("is offered, and counts as help when opened before answering", () => {
    const { onAnswer } = render({ context });

    fireEvent.click(screen.getByRole("button", { name: /show the sentence/i }));
    expect(screen.getByText(context.arabic)).toBeInTheDocument();
    // The translation would be the answer; it waits.
    expect(screen.queryByText(context.english)).not.toBeInTheDocument();

    pick(MEANING);

    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: true });
    expect(screen.getByText(context.english)).toBeInTheDocument();
  });

  it("is free after answering", () => {
    const { onAnswer } = render({ context });

    pick(MEANING);
    fireEvent.click(screen.getByRole("button", { name: /show the sentence/i }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: false });
  });

  it("is absent when the card has no sentence", () => {
    render();

    expect(screen.queryByRole("button", { name: /show the sentence/i })).not.toBeInTheDocument();
  });
});
