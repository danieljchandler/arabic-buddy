import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { QuizItem } from "@/components/review/QuizCardFrame";
import { LIGHTNING_REVEAL_MS, type LightningWord } from "@/lib/lightningRound";
import { LightningRound } from "./LightningRound";

/**
 * The lightning round on a quiz deck's end screen (quiz Phase 7). What has to
 * hold: it is offered only over enough right answers; it asks each word once,
 * moving on by itself, against a sixty-second clock that ends it on the
 * minute; the result is the score and the time; and it costs nothing — no
 * voice is synthesised, nothing plays but a stored recording, and there is no
 * tutor to open.
 */

const tts = vi.hoisted(() => ({ asked: [] as Array<{ text: string; skip?: boolean }> }));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => {
    tts.asked.push(options);
    return { ttsUrl: options.skip ? null : `blob:${options.text}`, isLoading: false, regenerate: vi.fn() };
  },
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const item = (over: Partial<QuizItem> & { id: string; arabic: string; english: string }): QuizItem => ({
  direction: "recognition",
  memory: { stability: 2, repetitions: 1 },
  dialect: "Gulf",
  ...over,
});

const WORDS: LightningWord<QuizItem>[] = [
  {
    id: "souq",
    format: "cloze",
    item: item({
      id: "souq",
      arabic: "السوق",
      english: "the market",
      sentence: { arabic: "رحت السوق أمس", english: "I went to the market yesterday" },
    }),
  },
  { id: "bait", format: "meaning", item: item({ id: "bait", arabic: "بيت", english: "house" }) },
  {
    id: "gahwa",
    format: "listen",
    item: item({ id: "gahwa", arabic: "قهوة", english: "coffee", audioUrl: "https://audio.test/gahwa.mp3" }),
  },
];
const POOL = [
  { arabic: "مدرسة", english: "school" },
  { arabic: "سيارة", english: "car" },
  { arabic: "مطعم", english: "restaurant" },
];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T09:00:00Z"));
  tts.asked = [];
  audio.play.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render(words: LightningWord<QuizItem>[] = WORDS) {
  const harness = renderWithProviders(<LightningRound words={words} pool={POOL} />);
  cleanup = harness.cleanup;
  return harness;
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** The word on screen: the gap's, the one heard, or the one shown. */
function wordOnScreen(): LightningWord<QuizItem> {
  if (screen.queryByText("Fill in the missing word")) return WORDS[0];
  if (screen.queryByText("What did you hear?")) return WORDS[2];
  return WORDS.find((w) => screen.queryByText(w.item.arabic, { selector: "p" }))!;
}

/** Answer whatever is on screen, rightly or not. */
function answerOnScreen(right: boolean) {
  const word = wordOnScreen();
  if (word.format === "cloze") {
    const options = screen.getAllByRole("button").filter((b) => b.getAttribute("dir") === "rtl");
    fireEvent.click(options.find((o) => (o.textContent?.trim() === word.item.arabic) === right)!);
    return;
  }
  const radios = screen.getAllByRole("radio");
  fireEvent.click(radios.find((r) => (r.textContent?.trim() === word.item.english) === right)!);
}

describe("the offer", () => {
  it("is not made over fewer than three words", () => {
    const { container } = render(WORDS.slice(0, 2));
    expect(container).toBeEmptyDOMElement();
  });

  it("says what the round is over, and that nothing in it is rated", () => {
    render();
    expect(screen.getByRole("heading", { name: /lightning round/i })).toBeInTheDocument();
    expect(screen.getByText(/60 seconds over the 3 words you got right/i)).toHaveTextContent(/nothing in it is rated/i);
  });
});

describe("a round", () => {
  it("asks each word once, moving on by itself, and ends with the score and the time when every word is asked", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("60 seconds left")).toBeInTheDocument();

    advance(4000);
    answerOnScreen(true);
    expect(screen.getByText("1 right")).toBeInTheDocument();
    advance(LIGHTNING_REVEAL_MS.right);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    advance(3000);
    answerOnScreen(false);
    expect(screen.getByText("1 right")).toBeInTheDocument();
    advance(LIGHTNING_REVEAL_MS.wrong);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();

    advance(2000);
    answerOnScreen(true);

    expect(screen.getByRole("heading", { name: /every word in 11 s/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/lightning round score/i)).toHaveTextContent("2 / 3");
  });

  it("ends on the minute, mid-question", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    advance(2000);
    answerOnScreen(true);
    advance(LIGHTNING_REVEAL_MS.right);

    advance(59_000);
    expect(screen.getByRole("heading", { name: "Time!" })).toBeInTheDocument();
    expect(screen.getByLabelText(/lightning round score/i)).toHaveTextContent("1 / 3");
    expect(screen.getByText(/1 right answer of 1 asked · 60 s/i)).toBeInTheDocument();
    expect(screen.queryByTestId("lightning-round")).not.toBeInTheDocument();
  });

  it("plays again with the words in a new order", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    advance(61_000);
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("60 seconds left")).toBeInTheDocument();
  });
});

describe("what it costs: nothing", () => {
  it("synthesises no voice, plays only the stored recording, and offers no tutor", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    for (let i = 0; i < 3; i++) {
      advance(1000);
      expect(screen.queryByRole("button", { name: /ask ai|why not this one|show translation|show the sentence/i })).not.toBeInTheDocument();
      answerOnScreen(false);
      expect(screen.queryByRole("button", { name: /ask ai|why not this one|show translation/i })).not.toBeInTheDocument();
      advance(LIGHTNING_REVEAL_MS.wrong);
    }

    expect(tts.asked.length).toBeGreaterThan(0);
    expect(tts.asked.every((a) => a.skip || !a.text)).toBe(true);
    expect(audio.play.mock.calls.map(([url]) => url)).toEqual(["https://audio.test/gahwa.mp3"]);
  });

  it("asks a gap whose word is no longer in its sentence as its meaning", () => {
    const words = WORDS.map((w) =>
      w.id === "souq" ? { ...w, item: { ...w.item, sentence: { arabic: "رحت المطعم أمس", english: null } } } : w,
    );
    render(words);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    for (let i = 0; i < 3; i++) {
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
      advance(500);
      fireEvent.click(screen.getAllByRole("radio")[0]);
      advance(LIGHTNING_REVEAL_MS.wrong);
    }
    expect(screen.getByLabelText(/lightning round score/i)).toBeInTheDocument();
  });
});
