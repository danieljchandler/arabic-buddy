import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { QuizOptionsCard, type QuizOption } from "./QuizOptionsCard";

/**
 * The picture, word and reply questions. Each has one thing it must not
 * give away before the answer — the picture question the meaning, the word
 * question the Arabic, the reply question the translation of what was said —
 * and one thing it must do afterwards: show and sound the right answer.
 */

const tts = vi.hoisted(() => ({ urls: {} as Record<string, string>, asked: [] as string[] }));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => {
    if (!options.skip && options.text) tts.asked.push(options.text);
    return {
      ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
      isLoading: false,
      regenerate: vi.fn(),
    };
  },
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  tts.asked = [];
  audio.play.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

type Props = Parameters<typeof QuizOptionsCard>[0];

function render(props: Omit<Props, "onAnswer" | "id"> & { id?: string }) {
  const onAnswer = vi.fn();
  const harness = renderWithProviders(<QuizOptionsCard id="card-1" onAnswer={onAnswer} {...props} />);
  cleanup = harness.cleanup;
  return { ...harness, onAnswer };
}

const radios = () => screen.getAllByRole("radio");

describe("pick the picture", () => {
  const options: QuizOption[] = [
    { key: "wrong-0", imageUrl: "https://img.test/house.png", english: "house" },
    { key: "answer", imageUrl: "https://img.test/market.png", english: "the market" },
    { key: "wrong-1", imageUrl: "https://img.test/school.png", english: "school" },
    { key: "wrong-2", imageUrl: "https://img.test/car.png", english: "car" },
  ];

  it("shows the word, plays it, and offers four pictures", () => {
    tts.urls["السوق"] = "blob:souq";
    render({ format: "picture-choice", prompt: { arabic: "السوق" }, options, answerKey: "answer" });

    expect(screen.getByText("السوق")).toBeInTheDocument();
    expect(audio.play).toHaveBeenCalledWith("blob:souq");
    expect(radios()).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "the market" })).toBeInTheDocument();
    // The meaning is not printed anywhere a sighted learner reads it.
    expect(screen.queryByText("the market")).not.toBeInTheDocument();
  });

  it("grades the pick and names the meaning on a miss", () => {
    const { onAnswer } = render({ format: "picture-choice", prompt: { arabic: "السوق" }, options, answerKey: "answer" });

    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: false, hintUsed: false });
    expect(screen.getByRole("status")).toHaveTextContent('السوق is "the market"');
  });

  it("takes one answer only", () => {
    const { onAnswer } = render({ format: "picture-choice", prompt: { arabic: "السوق" }, options, answerKey: "answer" });

    fireEvent.click(screen.getByRole("radio", { name: "the market" }));
    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: false });
  });
});

describe("pick the picture, with clips", () => {
  const clip = { clip: "https://cdn.test/eat.mp4", poster: "https://cdn.test/eat.png" };

  it("plays an option's clip in its tile", () => {
    render({
      format: "picture-choice",
      prompt: { arabic: "آكل" },
      options: [
        { key: "answer", animation: clip, english: "I eat" },
        { key: "wrong-0", animation: { clip: "https://cdn.test/drink.mp4", poster: "https://cdn.test/drink.png" }, english: "I drink" },
        { key: "wrong-1", imageUrl: "https://img.test/house.png", english: "house" },
        { key: "wrong-2", imageUrl: "https://img.test/car.png", english: "car" },
      ],
      answerKey: "answer",
    });

    expect(screen.getByRole("radio", { name: "I eat" }).querySelector("video")?.getAttribute("src")).toBe(clip.clip);
    expect(screen.getAllByTestId("quiz-animation")).toHaveLength(2);
  });

  it("shows a clip held still as its poster", () => {
    render({
      format: "picture-choice",
      prompt: { arabic: "آكل" },
      options: [
        { key: "answer", animation: clip, still: true, english: "I eat" },
        { key: "wrong-0", imageUrl: "https://img.test/house.png", english: "house" },
        { key: "wrong-1", imageUrl: "https://img.test/school.png", english: "school" },
        { key: "wrong-2", imageUrl: "https://img.test/car.png", english: "car" },
      ],
      answerKey: "answer",
    });

    expect(screen.queryAllByTestId("quiz-animation")).toHaveLength(0);
    expect(screen.getByRole("radio", { name: "I eat" }).querySelector("img")?.getAttribute("src")).toBe(clip.poster);
  });
});

describe("pick the word", () => {
  const options: QuizOption[] = [
    { key: "answer", arabic: "السوق", english: "the market", transliteration: "is-suug", audioUrl: "https://audio.test/souq.mp3" },
    { key: "wrong-0", arabic: "بيت", english: "house", audioUrl: "https://audio.test/house.mp3" },
    { key: "wrong-1", arabic: "مدرسة", english: "school" },
    { key: "wrong-2", arabic: "سيارة", english: "car" },
  ];

  it("asks from the picture, keeps the meaning behind a tap, and plays each option", () => {
    const { onAnswer } = render({
      format: "word-choice",
      prompt: { imageUrl: "https://img.test/market.png", english: "the market" },
      options,
      answerKey: "answer",
    });

    expect(screen.queryByText("the market")).not.toBeInTheDocument();
    expect(radios().map((r) => r.textContent?.trim())).toEqual(expect.arrayContaining(["السوق", "بيت"]));

    fireEvent.click(screen.getByRole("button", { name: "Play بيت" }));
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/house.mp3");
    // Playing an option is not choosing it.
    expect(onAnswer).not.toHaveBeenCalled();
    // An option with no recording has no play button to mislead with.
    expect(screen.queryByRole("button", { name: "Play مدرسة" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show meaning/i }));
    expect(screen.getByText("the market")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "السوق" }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: true });
    expect(screen.getByText("is-suug")).toBeInTheDocument();
  });

  it("asks from the meaning when there is no picture, with nothing to hint", () => {
    const { onAnswer } = render({ format: "word-choice", prompt: { english: "the market" }, options, answerKey: "answer" });

    expect(screen.getByText("the market")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show meaning/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "سيارة" }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: false, hintUsed: false });
    expect(screen.getByRole("status")).toHaveTextContent("It's السوق");
  });
});

describe("answer the line", () => {
  const options: QuizOption[] = [
    { key: "wrong-0", arabic: "هذا الباب", english: "This is the door" },
    { key: "answer", arabic: "أكيد. تفضل", english: "Sure. Here you go" },
    { key: "wrong-1", arabic: "مشكور", english: "Thanks" },
    { key: "wrong-2", arabic: "العفو. شاي؟", english: "You're welcome. Tea?" },
  ];
  const prompt = { arabic: "سمحلي، ماي لو سمحت", english: "Excuse me, water please", speaker: "Customer" };

  it("says the line, names who said it, and keeps the translation behind a tap", () => {
    tts.urls[prompt.arabic] = "blob:line";
    const { onAnswer } = render({ format: "reply-choice", prompt, options, answerKey: "answer" });

    expect(screen.getByText(prompt.arabic)).toBeInTheDocument();
    expect(screen.getByText(/customer says/i)).toBeInTheDocument();
    expect(audio.play).toHaveBeenCalledWith("blob:line");
    expect(screen.queryByText(prompt.english)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));
    expect(screen.getByText(prompt.english)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "أكيد. تفضل" }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: true, hintUsed: true });
    expect(screen.getByText("Sure. Here you go")).toBeInTheDocument();
  });

  it("grades a reply that does not fit as wrong, without help", () => {
    const { onAnswer } = render({ format: "reply-choice", prompt, options, answerKey: "answer" });

    fireEvent.click(screen.getByRole("radio", { name: "مشكور" }));

    expect(onAnswer).toHaveBeenCalledWith({ correct: false, hintUsed: false });
    expect(screen.getByRole("status")).toHaveTextContent(/isn't what fits/i);
  });
});

/** What the assistant was opened on, for the "Why not this one?" chip. */
function Probe() {
  const { isOpen, seed, pendingAsk } = useAiAssistant();
  return <div data-testid="probe">{isOpen ? `open|${seed?.arabic}|${seed?.english ?? ""}|${pendingAsk?.text ?? ""}` : "closed"}</div>;
}

describe("why not this one?", () => {
  function renderWithProbe(props: Omit<Props, "onAnswer" | "id">) {
    const harness = renderWithProviders(
      <>
        <QuizOptionsCard id="card-1" onAnswer={vi.fn()} {...props} />
        <Probe />
      </>,
    );
    cleanup = harness.cleanup;
  }
  const whyNot = () => screen.getByRole("button", { name: /why not this one/i });
  const probe = () => screen.getByTestId("probe");

  it("on a wrong picture, asks how to tell the word from what the picture shows, naming that word", () => {
    renderWithProbe({
      format: "picture-choice",
      prompt: { arabic: "السوق" },
      options: [
        { key: "wrong-0", imageUrl: "https://img.test/house.png", english: "house", arabic: "بيت" },
        { key: "answer", imageUrl: "https://img.test/market.png", english: "the market" },
        { key: "wrong-1", imageUrl: "https://img.test/school.png", english: "school", arabic: "مدرسة" },
        { key: "wrong-2", imageUrl: "https://img.test/car.png", english: "car", arabic: "سيارة" },
      ],
      answerKey: "answer",
    });
    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    fireEvent.click(whyNot());
    expect(probe()).toHaveTextContent("open|السوق|the market|");
    expect(probe()).toHaveTextContent(
      'I picked the picture of "house" (that\'s «بيت») for «السوق», but «السوق» means "the market". How do I tell them apart?',
    );
  });

  it("offers nothing after a right picture, as before", () => {
    renderWithProbe({
      format: "picture-choice",
      prompt: { arabic: "السوق" },
      options: [
        { key: "wrong-0", imageUrl: "https://img.test/house.png", english: "house", arabic: "بيت" },
        { key: "answer", imageUrl: "https://img.test/market.png", english: "the market" },
      ],
      answerKey: "answer",
    });
    fireEvent.click(screen.getByRole("radio", { name: "the market" }));
    expect(screen.queryByRole("button", { name: /why not this one|ask ai/i })).not.toBeInTheDocument();
  });

  const words: QuizOption[] = [
    { key: "answer", arabic: "السوق", english: "the market" },
    { key: "wrong-0", arabic: "بيت", english: "house" },
    { key: "wrong-1", arabic: "مدرسة", english: "school" },
    { key: "wrong-2", arabic: "سيارة", english: "car" },
  ];

  it("on a wrong word, asks why it is not the word for the meaning, with the word picked's own meaning", () => {
    renderWithProbe({ format: "word-choice", prompt: { imageUrl: "https://img.test/market.png", english: "the market" }, options: words, answerKey: "answer" });
    fireEvent.click(screen.getByRole("radio", { name: "بيت" }));

    fireEvent.click(whyNot());
    expect(probe()).toHaveTextContent("open|السوق|the market|");
    expect(probe()).toHaveTextContent('I picked «بيت» ("house") for "the market", but the word is «السوق». Why isn\'t it «بيت»?');
  });

  it("offers the plain question after a right word", () => {
    renderWithProbe({ format: "word-choice", prompt: { english: "the market" }, options: words, answerKey: "answer" });
    fireEvent.click(screen.getByRole("radio", { name: "السوق" }));
    expect(screen.queryByRole("button", { name: /why not this one/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("on a wrong reply, opens on the line said and asks why the reply picked does not answer it", () => {
    renderWithProbe({
      format: "reply-choice",
      prompt: { arabic: "سمحلي، ماي لو سمحت", english: "Excuse me, water please" },
      options: [
        { key: "answer", arabic: "أكيد. تفضل", english: "Sure. Here you go" },
        { key: "wrong-0", arabic: "مشكور", english: "Thanks" },
      ],
      answerKey: "answer",
    });
    fireEvent.click(screen.getByRole("radio", { name: "مشكور" }));

    fireEvent.click(whyNot());
    expect(probe()).toHaveTextContent("open|سمحلي، ماي لو سمحت|Excuse me, water please|");
    expect(probe()).toHaveTextContent(
      "Someone said «سمحلي، ماي لو سمحت» and I answered «مشكور», but the reply is «أكيد. تفضل». Why doesn't «مشكور» fit as the answer?",
    );
  });
});
