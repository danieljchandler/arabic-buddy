import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { QuizSpeakCard } from "./QuizSpeakCard";

/**
 * The speaking steps: say the word, or the line, and be scored.
 *
 * What has to hold: the Arabic never appears before the take (it is the
 * answer), the sentence hint has the word cut out of it, and the result the
 * card reports carries both the score and how close what was heard came to
 * the target — a confident wrong word must reach the grader as a wrong word.
 */

vi.mock("@/lib/audioToWav", () => ({
  blobToWav: vi.fn(async (blob: Blob) => blob),
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: () => ({ ttsUrl: "blob:target", isLoading: false, regenerate: vi.fn() }),
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const WORD = "السوق";
const SENTENCE = "رحت السوق أمس";

interface FakeRecorder {
  state: string;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

let recorders: FakeRecorder[] = [];
let micThrows: Error | null = null;
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
    recorders.push(this as unknown as FakeRecorder);
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
  micThrows = null;
  audio.play.mockReset();
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (micThrows) throw micThrows;
        return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
      }),
    },
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

type Props = Partial<Parameters<typeof QuizSpeakCard>[0]>;

function render(over: Props = {}, seed?: (backend: SupabaseBackend) => void) {
  const onResult = vi.fn();
  const onUnavailable = vi.fn();
  const harness = renderWithProviders(
    <QuizSpeakCard
      format="speak"
      id="card-1"
      arabic={WORD}
      english="market"
      transliteration="suug"
      sentence={{ arabic: SENTENCE, english: "I went to the market yesterday" }}
      onResult={onResult}
      onUnavailable={onUnavailable}
      {...over}
    />,
    {
      persona: "free",
      seed: (backend) => {
        backend.stubFunction("azure-pronunciation", aResult());
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onResult, onUnavailable };
}

async function recordTake() {
  fireEvent.click(screen.getByRole("button", { name: /say it/i }));
  await waitFor(() => expect(recorders).toHaveLength(1));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
  });
}

describe("asking for the word", () => {
  it("shows the meaning and keeps the Arabic off the screen", () => {
    render();

    expect(screen.getByText("market")).toBeInTheDocument();
    expect(screen.queryByText(WORD)).not.toBeInTheDocument();
    expect(screen.queryByText("suug")).not.toBeInTheDocument();
  });

  it("offers the sentence with the word cut out", () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /show the sentence/i }));

    expect(screen.getByText(/رحت ـــ أمس/)).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it("scores a take and reports what it heard with how close it came", async () => {
    const { onResult, backend } = render();

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ kind: "speech", score: 82, recognized: WORD });
    expect(onResult.mock.calls[0][0].similarity).toBeCloseTo(1);
    // The reference the scorer compared against is the word, in the word's locale.
    const call = backend.lastCallTo("azure-pronunciation");
    expect(call?.body).toMatchObject({ referenceText: WORD, locale: "ar-SA" });

    expect(screen.getByText("82")).toBeInTheDocument();
    // Heard and target both read the word; it is on screen now, with its sound.
    expect(screen.getAllByText(WORD).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("suug")).toBeInTheDocument();
  });

  it("reports a different word as far from the target", async () => {
    const { onResult } = render({}, (b) => b.stubFunction("azure-pronunciation", aResult({ recognizedText: "مدرسة" })));

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].similarity).toBeLessThan(0.5);
    expect(screen.getByText("مدرسة")).toBeInTheDocument();
  });

  it("reports nothing heard as no comparison rather than a mismatch", async () => {
    const { onResult } = render({}, (b) => b.stubFunction("azure-pronunciation", aResult({ recognizedText: "" })));

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ similarity: null, recognized: null });
  });

  it("scores in the card's own dialect", async () => {
    const { backend } = render({ dialect: "Egyptian" });

    await recordTake();

    await waitFor(() =>
      expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({ locale: "ar-EG" }),
    );
  });

  it("hands the card back when the microphone is refused", async () => {
    (globalThis as Record<string, unknown>).MediaRecorder = undefined;
    const { onUnavailable } = render();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /say it/i }));
    });

    expect(onUnavailable).toHaveBeenCalled();
  });

  it("lets a refused take be rated by hand", async () => {
    micThrows = new Error("NotAllowedError");
    const { onUnavailable } = render();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /say it/i }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/refused/i));
    fireEvent.click(screen.getByRole("button", { name: /rate it myself/i }));

    expect(onUnavailable).toHaveBeenCalled();
  });
});

describe("asking from a picture", () => {
  it("shows the picture alone and keeps the meaning behind a tap that counts as help", async () => {
    const { onResult } = render({ imageUrl: "https://img.test/market.png" });

    expect(screen.getByRole("img", { hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("market")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show meaning/i }));
    expect(screen.getByText("market")).toBeInTheDocument();

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ hintUsed: true });
  });

  it("is not help when the meaning was never asked for", async () => {
    const { onResult } = render({ imageUrl: "https://img.test/market.png" });

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ hintUsed: false });
    // After the take the meaning is shown regardless.
    expect(screen.getByText("market")).toBeInTheDocument();
  });
});

describe("asking for the line", () => {
  it("shows the English line and scores against the Arabic line", async () => {
    const { backend } = render({ format: "speak-sentence" });

    expect(screen.getByText("I went to the market yesterday")).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();

    await recordTake();

    await waitFor(() =>
      expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({ referenceText: SENTENCE }),
    );
  });

  it("asks for the line as a gap when it has no English", () => {
    render({ format: "speak-sentence", sentence: { arabic: SENTENCE, english: null } });

    expect(screen.getByText(/رحت ـــ أمس/)).toBeInTheDocument();
    expect(screen.getByText(/with/)).toHaveTextContent("market");
  });
});

describe("asking for the reply", () => {
  const REPLY = {
    prompt: { speaker: "Friend", arabic: "وين رحت أمس؟", english: "Where did you go yesterday?" },
    answer: {
      speaker: "You",
      arabic: "رحت السوق مع أخوي",
      english: "I went to the market with my brother",
      transliteration: "ruht is-suug ma' akhooy",
    },
  };
  const replyCard = (over: Props = {}, seed?: (backend: SupabaseBackend) => void) =>
    render({ format: "speak-reply", reply: REPLY, ...over }, seed);

  it("plays the line, shows what to reply, and keeps the Arabic reply off the screen", async () => {
    replyCard();

    expect(screen.getByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByText(/Friend says/)).toBeInTheDocument();
    expect(screen.getByText("وين رحت أمس؟")).toBeInTheDocument();
    expect(screen.getByText("I went to the market with my brother")).toBeInTheDocument();
    expect(screen.getByText(/^with/)).toHaveTextContent("with market");
    // The line is said once, by itself; the reply is the answer.
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(REPLY.answer.arabic)).not.toBeInTheDocument();
    expect(screen.queryByText("Where did you go yesterday?")).not.toBeInTheDocument();
  });

  it("scores against the reply, in the card's dialect, and holds the take to the word's span", async () => {
    const heard = "رحت السوق مع اخوي";
    const { onResult, backend } = replyCard({ dialect: "Yemeni" }, (b) =>
      b.stubFunction("azure-pronunciation", aResult({ overall: 88, recognizedText: heard })),
    );

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({
      referenceText: REPLY.answer.arabic,
      locale: "ar-YE",
    });
    expect(onResult.mock.calls[0][0]).toMatchObject({ kind: "speech", score: 88, recognized: heard, hintUsed: false });
    expect(onResult.mock.calls[0][0].similarity).toBe(1);
    // After the take, the reply is shown with its sound and transliteration.
    expect(screen.getByText(REPLY.answer.arabic)).toBeInTheDocument();
    expect(screen.getByText(REPLY.answer.transliteration)).toBeInTheDocument();
  });

  it("reports a reply said without the word as far from it, however close the line came", async () => {
    // Everything but the word: the line is nearly right, the reply is not.
    const { onResult } = replyCard({}, (b) =>
      b.stubFunction("azure-pronunciation", aResult({ overall: 90, recognizedText: "رحت المطعم مع أخوي" })),
    );

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].similarity).toBeLessThan(0.5);
  });

  it("counts the line's translation, asked for before the take, as help", async () => {
    const { onResult } = replyCard();

    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));
    expect(screen.getByText("Where did you go yesterday?")).toBeInTheDocument();

    await recordTake();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ hintUsed: true });
  });

  it("asks for a reply with no English as a gap", () => {
    replyCard({ reply: { ...REPLY, answer: { ...REPLY.answer, english: null } } });

    expect(screen.getByText(/رحت ـــ مع أخوي/)).toBeInTheDocument();
    expect(screen.getByText(/in the gap/)).toHaveTextContent("market");
  });
});
