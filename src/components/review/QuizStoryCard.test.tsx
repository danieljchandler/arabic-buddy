import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { storyGap } from "@/lib/quizStory";
import { asStoredStoryLine } from "../../../supabase/functions/_shared/wordStoryLine";
import { QuizStoryCard } from "./QuizStoryCard";

/**
 * The quiz's top step, "in a story": two sentences of a story with the word
 * cut out, read aloud with the word muted, and the learner says it.
 *
 * What has to hold: the word is neither on the screen nor in what the voice
 * is given before the answer, and the passage is read in its own dialect's
 * voice, muted and whole; the take is scored against the word, in that
 * dialect's locale, and reaches the grader as the word's span of what was
 * heard; and on a device that cannot record the same gap is asked with four
 * options, a wrong pick asking the tutor why.
 */

vi.mock("@/lib/audioToWav", () => ({
  blobToWav: vi.fn(async (blob: Blob) => blob),
}));

const tts = vi.hoisted(() => ({
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string }>,
  /** Texts whose reading has not landed yet. */
  pending: new Set<string>(),
}));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    const ready = !options.skip && !tts.pending.has(options.text);
    return { ttsUrl: ready ? `blob:${options.text}` : null, isLoading: false, regenerate: vi.fn() };
  },
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const WORD = "قهوة";
const morning = { arabic: "كان الصبح بارد وايد.", english: "The morning was very cold." };
const ordered = { arabic: "طلب الريال قهوة حارة.", english: "The man ordered hot coffee." };
const MUTED = "كان الصبح بارد وايد. طلب الريال ... حارة.";
const WHOLE = `${morning.arabic} ${ordered.arabic}`;
const STORY = storyGap(
  asStoredStoryLine({ sentences: [morning, ordered], story: { id: "s", title: "The cold morning", titleArabic: "" } }, WORD),
  WORD,
)!;

interface FakeRecorder {
  state: string;
}
let recorders: FakeRecorder[] = [];
const originals = {
  MediaRecorder: (globalThis as Record<string, unknown>).MediaRecorder,
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
};

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(32)]) });
    this.onstop?.();
  }
}

let cleanup: (() => void) | undefined;

beforeEach(() => {
  recorders = [];
  tts.asked = [];
  tts.pending = new Set();
  audio.play.mockReset();
  audio.stop.mockReset();
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream) },
  });
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  (globalThis as Record<string, unknown>).MediaRecorder = originals.MediaRecorder;
  if (originals.mediaDevices) Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
});

const aResult = (over: Record<string, unknown> = {}) => ({
  overall: 82,
  accuracy: 84,
  fluency: 80,
  completeness: 100,
  words: [{ word: WORD, accuracy: 84, errorType: "None", phonemes: [] }],
  recognizedText: WORD,
  locale: "ar-SA",
  ...over,
});

/** What the assistant was opened on, for the "Why not this one?" chip. */
function Probe() {
  const { isOpen, seed, pendingAsk } = useAiAssistant();
  return <div data-testid="probe">{isOpen ? `open|${seed?.arabic}|${pendingAsk?.text ?? ""}` : "closed"}</div>;
}

type Props = Partial<Parameters<typeof QuizStoryCard>[0]>;

function render(over: Props = {}, seed?: (backend: SupabaseBackend) => void) {
  const onResult = vi.fn();
  const onChoice = vi.fn();
  const onUnavailable = vi.fn();
  const harness = renderWithProviders(
    <>
      <QuizStoryCard
        format="story-gap"
        id="card-1"
        arabic={WORD}
        english="coffee"
        transliteration="gahwa"
        dialect="Gulf"
        story={STORY}
        distractors={["شاي", "بيت", "سيارة"]}
        onResult={onResult}
        onChoice={onChoice}
        onUnavailable={onUnavailable}
        {...over}
      />
      <Probe />
    </>,
    {
      persona: "free",
      seed: (backend) => {
        backend.stubFunction("azure-pronunciation", aResult());
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onResult, onChoice, onUnavailable };
}

async function recordTake() {
  fireEvent.click(screen.getByRole("button", { name: /say it/i }));
  await waitFor(() => expect(recorders).toHaveLength(1));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
  });
}

const spoken = () => tts.asked.filter((a) => !a.skip);

describe("the passage", () => {
  it("shows both sentences with the word cut out of its own, and names the story and the meaning", () => {
    render();

    const passage = screen.getByTestId("story-passage");
    expect(passage).toHaveTextContent(morning.arabic);
    expect(passage).toHaveTextContent("طلب الريال");
    expect(passage).not.toHaveTextContent(WORD);
    expect(screen.getByTestId("story-gap")).toHaveTextContent("ـــ");
    expect(screen.getByText(/From the story “The cold morning”/)).toBeInTheDocument();
    expect(screen.getByText(/the missing word means/i)).toHaveTextContent("coffee");
    expect(screen.queryByText(ordered.english)).not.toBeInTheDocument();
  });

  it("is read aloud with the word muted, in the passage's dialect, once by itself", () => {
    render({ dialect: "Egyptian" });

    const asked = spoken();
    expect(asked.map((a) => a.text)).toEqual([MUTED]);
    expect(asked[0].text).not.toContain(WORD);
    expect(asked[0].dialect).toBe("Egyptian");
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledWith(`blob:${MUTED}`);
    expect(screen.getByRole("button", { name: "Play the passage with the word muted" })).toBeInTheDocument();
  });

  it("is read whole after the take, in the same dialect's voice, with the word in its gap", async () => {
    render({ dialect: "Egyptian" });

    await recordTake();

    await waitFor(() => expect(screen.getByTestId("story-gap")).toHaveTextContent(WORD));
    const whole = tts.asked.filter((a) => a.text === WHOLE && !a.skip);
    expect(whole.length).toBeGreaterThan(0);
    expect(whole.every((a) => a.dialect === "Egyptian")).toBe(true);
    expect(screen.getByRole("button", { name: "Play the whole passage" })).toBeInTheDocument();
    expect(screen.getByText(STORY.english)).toBeInTheDocument();
  });
});

describe("saying the word", () => {
  it("scores the take against the word, in the passage's locale, and reports it with how close it came", async () => {
    const { onResult, backend } = render({ dialect: "Yemeni" });

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ kind: "speech", score: 82, recognized: WORD, hintUsed: false });
    expect(onResult.mock.calls[0][0].similarity).toBeCloseTo(1);
    // A single word: graded by the ordinary bands, never as a reply.
    expect(onResult.mock.calls[0][0].reply).toBeUndefined();
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({ referenceText: WORD, locale: "ar-YE" });
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("gahwa")).toBeInTheDocument();
  });

  it("stops the passage before it listens", async () => {
    render();
    await recordTake();
    expect(audio.stop).toHaveBeenCalled();
  });

  it("never plays a reading that lands after the take has started", async () => {
    tts.pending.add(MUTED);
    render();
    expect(audio.play).not.toHaveBeenCalled();

    // The reading arrives as the learner taps "Say it".
    tts.pending.delete(MUTED);
    fireEvent.click(screen.getByRole("button", { name: /say it/i }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    expect(audio.play).not.toHaveBeenCalledWith(`blob:${MUTED}`);
  });

  it("reports the word said among other words as far from it", async () => {
    const { onResult } = render({}, (b) =>
      b.stubFunction("azure-pronunciation", aResult({ overall: 89, recognizedText: "شاي قهوة حليب" })),
    );
    await recordTake();
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].similarity).toBeLessThan(0.5);
  });

  it("hears the word with و, ب or ال attached as the word, and another word as another", async () => {
    const attached = render({}, (b) => b.stubFunction("azure-pronunciation", aResult({ recognizedText: "والقهوة" })));
    await recordTake();
    await waitFor(() => expect(attached.onResult).toHaveBeenCalledTimes(1));
    expect(attached.onResult.mock.calls[0][0].similarity).toBeCloseTo(1);
    cleanup?.();
    recorders = [];

    const other = render({}, (b) => b.stubFunction("azure-pronunciation", aResult({ recognizedText: "شاي" })));
    await recordTake();
    await waitFor(() => expect(other.onResult).toHaveBeenCalledTimes(1));
    expect(other.onResult.mock.calls[0][0].similarity).toBeLessThan(0.5);
  });

  it("holds a word of three letters or fewer to itself", async () => {
    const fine = { arabic: "الجو زين اليوم.", english: "The weather is nice today." };
    const story = storyGap(asStoredStoryLine({ sentences: [morning, fine] }, "زين"), "زين")!;
    const { onResult } = render({ arabic: "زين", english: "nice", story }, (b) =>
      b.stubFunction("azure-pronunciation", aResult({ recognizedText: "وين" })),
    );
    await recordTake();
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].similarity).toBeLessThan(0.5);
  });

  it("counts the passage's translation, opened before the take, as help", async () => {
    const { onResult } = render();

    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));
    expect(screen.getByText(STORY.english)).toBeInTheDocument();
    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].hintUsed).toBe(true);
  });
});

describe("on a device that cannot record: the four-option gap", () => {
  it("offers the word among three others and reports a right pick", () => {
    const { onChoice } = render({ format: "story-choice" });

    const options = screen.getByRole("radiogroup", { name: /choose the missing word/i });
    expect(options.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(screen.queryByText(/the missing word means/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /say it/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: WORD }));
    expect(onChoice).toHaveBeenCalledWith({ correct: true, hintUsed: false });
    expect(screen.getByTestId("story-gap")).toHaveTextContent(WORD);
    expect(screen.queryByRole("button", { name: /why not this one/i })).not.toBeInTheDocument();
  });

  it("reads the passage muted, and whole once picked", () => {
    render({ format: "story-choice" });
    expect(spoken().map((a) => a.text)).toEqual([MUTED]);
    fireEvent.click(screen.getByRole("radio", { name: "شاي" }));
    expect(tts.asked.some((a) => a.text === WHOLE && !a.skip)).toBe(true);
  });

  it("asks the tutor why on a wrong pick, with the pair and the passage", () => {
    const { onChoice } = render({ format: "story-choice" });

    fireEvent.click(screen.getByRole("radio", { name: "شاي" }));
    expect(onChoice).toHaveBeenCalledWith({ correct: false, hintUsed: false });
    expect(screen.getByTestId("story-gap")).toHaveTextContent("شاي");

    fireEvent.click(screen.getByRole("button", { name: /why not this one/i }));
    const probe = screen.getByTestId("probe");
    expect(probe).toHaveTextContent(`open|${WHOLE}|`);
    expect(probe).toHaveTextContent("I put «شاي» in the gap, but the word is «قهوة» (\"coffee\")");
  });

  it("counts the translation, opened before the pick, as help", () => {
    const { onChoice } = render({ format: "story-choice" });
    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));
    fireEvent.click(screen.getByRole("radio", { name: WORD }));
    expect(onChoice).toHaveBeenCalledWith({ correct: true, hintUsed: true });
  });

  it("takes one pick only", () => {
    const { onChoice } = render({ format: "story-choice" });
    fireEvent.click(screen.getByRole("radio", { name: "شاي" }));
    fireEvent.click(screen.getByRole("radio", { name: WORD }));
    expect(onChoice).toHaveBeenCalledTimes(1);
  });
});
