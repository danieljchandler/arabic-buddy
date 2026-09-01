import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ShadowPlayer } from "./ShadowPlayer";
import type { ShadowScoreResult } from "@/hooks/useShadowScore";
import type { ShadowClip } from "@/hooks/useShadowQueue";

/**
 * Shadowing one clip, in repetitions: listen to a native speaker say a line,
 * repeat it immediately, get a closeness score — then do the SAME line again,
 * about five times, because that repetition is where shadowing's gains
 * actually come from. One take per clip was most of the exercise thrown away.
 *
 * The other contract worth pinning is what the score claims. It comes from a
 * transcript match against the clip's own words — evidence about word choice,
 * not pronunciation — so the result must present itself as closeness and must
 * not surface per-phoneme claims the measurement cannot support.
 *
 * Playback, recording and scoring each live behind their own interface and
 * are stubbed here so every branch of the state machine is reachable.
 */

const player = vi.hoisted(() => ({
  play: vi.fn(async (_rate?: number) => true),
  pause: vi.fn(),
  onEnded: null as null | (() => void),
  onError: null as null | ((message: string) => void),
}));

const recorder = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  level: 0,
  error: null as string | null,
  permissionDenied: false,
  isRecording: false,
}));

const scorer = vi.hoisted(() => ({
  score: vi.fn(),
  result: null as ShadowScoreResult | null,
  isLoading: false,
  error: null as string | null,
  reset: vi.fn(),
}));

vi.mock("./ClipSourcePlayer", () => ({
  ClipSourcePlayer: forwardRef(
    (
      props: { onEnded: () => void; onError?: (message: string) => void },
      ref: React.Ref<unknown>,
    ) => {
      player.onEnded = props.onEnded;
      player.onError = props.onError ?? null;
      useImperativeHandle(ref, () => ({
        play: player.play,
        pause: player.pause,
        isReady: () => true,
      }));
      return <div data-testid="clip-source" />;
    },
  ),
}));

vi.mock("@/hooks/useShadowRecorder", () => ({
  useShadowRecorder: () => recorder,
}));

vi.mock("@/hooks/useShadowScore", () => ({
  useShadowScore: () => scorer,
}));

const A_CLIP: ShadowClip = {
  id: "clip-1",
  source: "audio",
  audioUrl: "https://audio.test/clip.mp3",
  text: "شلونك اليوم",
  translation: "How are you today?",
  startSec: 2,
  endSec: 5,
  dialect: "Gulf",
  locale: "ar-KW",
  sourceTitle: "Kuwaiti street interview",
};

const aScore = (overall: number): ShadowScoreResult => ({
  overall,
  transcriptSimilarity: overall,
  rawTranscriptSimilarity: overall,
  acousticSimilarity: null,
  recognizedText: "شلونك اليوم",
  wordDiffs: [
    { ref: "شلونك", said: "شلونك", status: "match" },
    { ref: "اليوم", said: "اليم", status: "sub" },
  ],
  tips: ["Stretch the long vowel in اليوم."],
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  player.play.mockReset().mockResolvedValue(true);
  player.pause.mockReset();
  recorder.start.mockReset();
  recorder.stop.mockReset();
  recorder.level = 0;
  recorder.error = null;
  recorder.permissionDenied = false;
  recorder.isRecording = false;
  scorer.score.mockReset();
  scorer.result = null;
  scorer.isLoading = false;
  scorer.error = null;
  scorer.reset.mockReset().mockImplementation(() => {
    scorer.result = null;
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

interface Options {
  clip?: ShadowClip;
  threshold?: number;
  autoAdvance?: boolean;
  showEnglish?: boolean;
}

function render({
  clip = A_CLIP,
  threshold = 75,
  autoAdvance = false,
  showEnglish = false,
}: Options = {}) {
  const onResult = vi.fn();
  const onNext = vi.fn();
  const harness = renderWithProviders(
    <ShadowPlayer
      clip={clip}
      threshold={threshold}
      autoAdvance={autoAdvance}
      showEnglish={showEnglish}
      onResult={onResult}
      onNext={onNext}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onResult, onNext };
}

/** Play the clip through to its end, which is what opens the microphone. */
const listenThrough = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    player.onEnded?.();
  });
};

/** Hand back whatever the recorder heard, as it would when the learner stops. */
const finishRecording = async (blob: Blob | null, reason?: string) => {
  const options = recorder.start.mock.calls.at(-1)?.[0] as {
    onComplete: (blob: Blob | null, reason?: string) => void | Promise<void>;
  };
  await act(async () => {
    await options.onComplete(blob, reason);
  });
};

const aTake = () => new Blob([new Uint8Array(8)], { type: "audio/webm" });

/** A whole take, from pressing Listen to a score on screen. */
const takeScoring = async (overall: number) => {
  scorer.score.mockImplementation(async () => {
    scorer.result = aScore(overall);
    return scorer.result;
  });
  await listenThrough();
  await finishRecording(aTake());
};

/** From a result on screen: press Again and complete one more rep. */
const anotherRep = async (overall: number) => {
  scorer.score.mockImplementation(async () => {
    scorer.result = aScore(overall);
    return scorer.result;
  });
  fireEvent.click(screen.getByRole("button", { name: /again/i }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    player.onEnded?.();
  });
  await finishRecording(aTake());
};

describe("setting up the take", () => {
  it("shows the line to be repeated", () => {
    render();

    expect(screen.getByText("شلونك اليوم")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/Gulf · Kuwaiti street interview/)).toBeInTheDocument();
  });

  it("frames the clip as a set of repetitions from the start", () => {
    render();

    // The rep model is the exercise; a learner should arrive knowing the line
    // is to be repeated, not performed once.
    expect(screen.getByText("5 reps of this clip")).toBeInTheDocument();
  });

  it("keeps the English out of the way unless it was asked for", () => {
    render();

    expect(screen.queryByText("How are you today?")).not.toBeInTheDocument();
  });

  it("shows the English when the learner wants it", () => {
    render({ showEnglish: true });

    expect(screen.getByText("How are you today?")).toBeInTheDocument();
  });

  it("plays the clip at full speed to begin with", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalledWith(1));
  });

  it("plays it slowly when the learner asks", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: "0.5×" }));
    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalledWith(0.5));
  });

  it("goes back to waiting when the clip will not start", async () => {
    player.play.mockResolvedValue(false);
    render();

    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^listen$/i })).toBeEnabled());
  });
});

describe("the echo window", () => {
  it("opens the microphone the moment the clip stops", async () => {
    render();

    await listenThrough();

    expect(recorder.start).toHaveBeenCalled();
    expect(screen.getByText("Repeat now")).toBeInTheDocument();
  });

  it("allows the clip's length plus a breath, and stops on the silence after", async () => {
    render();

    await listenThrough();

    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 4500, trailingSilenceMs: 600 }),
    );
  });

  it("gives a very short clip a floor to speak into", async () => {
    render({ clip: { ...A_CLIP, startSec: 2, endSec: 2.2 } });

    await listenThrough();

    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 2300 }),
    );
  });

  it("lets the learner stop early", async () => {
    render();
    await listenThrough();

    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    expect(recorder.stop).toHaveBeenCalledWith("manual");
  });

  it("says it heard nothing rather than scoring silence", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "no-audio");

    expect(screen.getByText("We didn't hear you — try again.")).toBeInTheDocument();
    expect(scorer.score).not.toHaveBeenCalled();
  });

  it("reports a recording that failed for some other reason", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "error");

    expect(screen.getByText("Recording failed")).toBeInTheDocument();
  });

  it("offers another go or a way past after a failed take", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "no-audio");

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("explains a refused microphone rather than showing a bare error", async () => {
    recorder.permissionDenied = true;
    recorder.error = "Microphone blocked";
    render();

    expect(screen.getByText(/enable mic access in your browser/i)).toBeInTheDocument();
  });
});

describe("the score", () => {
  it("scores against the clip's own words and files the take under the clip", async () => {
    render();

    await takeScoring(82);

    // clipRef and rep are what let the scorer persist the take — the record
    // behind the progression display and the future durability analysis.
    expect(scorer.score).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ referenceText: A_CLIP.text, clipRef: "clip-1", rep: 1 }),
    );
  });

  it("presents the number as closeness to the clip, never as phoneme diagnosis", async () => {
    render();

    await takeScoring(82);

    // Twice on screen: the score circle and the rep chip carrying the trace.
    expect(screen.getAllByText("82").length).toBeGreaterThanOrEqual(1);
    // The transcript can say which words were said, so that is all the
    // subtitle claims. "Accuracy/fluency/completeness" belongs to the modes
    // with a pronunciation model behind them.
    expect(screen.getByText(/Closeness to the clip · said 1 of 2 words/)).toBeInTheDocument();
    expect(screen.queryByText(/Acc \d/)).not.toBeInTheDocument();
  });

  it("names the band rather than leaving a bare number", async () => {
    render();

    await takeScoring(92);

    expect(screen.getByText("Excellent")).toBeInTheDocument();
  });

  it("passes the coaching tips through", async () => {
    render();

    await takeScoring(82);

    expect(screen.getByText("Stretch the long vowel in اليوم.")).toBeInTheDocument();
  });

  it("tells the page what was scored", async () => {
    const { onResult } = render();

    await takeScoring(64);

    expect(onResult).toHaveBeenCalledWith(64);
  });

  it("shows the failure branch when scoring came back with nothing", async () => {
    scorer.score.mockResolvedValue(null);
    render();
    await listenThrough();

    await finishRecording(aTake());

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("repetitions", () => {
  it("offers the next rep as the primary action after a take", async () => {
    render();

    await takeScoring(70);

    // One take is a fifth of the exercise; Again leads until the reps are in.
    expect(screen.getByRole("button", { name: "Again (2/5)" })).toBeInTheDocument();
    expect(screen.getByText(/Rep 1 of ~5/)).toBeInTheDocument();
  });

  it("counts the rep up and shows the trace across takes", async () => {
    render();

    await takeScoring(70);
    await anotherRep(78);

    expect(scorer.score).toHaveBeenLastCalledWith(
      expect.any(Blob),
      expect.objectContaining({ rep: 2 }),
    );
    expect(screen.getByText(/Rep 2 of ~5/)).toBeInTheDocument();
    // The trace is the progression the reps exist to produce.
    const chips = screen.getByLabelText("repetitions");
    expect(chips).toHaveTextContent("70");
    expect(chips).toHaveTextContent("78");
  });

  it("starts the rep count fresh on a new clip", async () => {
    const { rerender } = render();
    await takeScoring(88);

    rerender(
      <ShadowPlayer
        clip={{ ...A_CLIP, id: "clip-2", text: "وين رايح" }}
        threshold={75}
        autoAdvance={false}
        showEnglish={false}
        onResult={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText("وين رايح")).toBeInTheDocument();
    expect(screen.queryByText("88")).not.toBeInTheDocument();
    expect(screen.getByText("5 reps of this clip")).toBeInTheDocument();
  });
});

describe("moving on", () => {
  it("does not advance after one good take — the reps are the exercise", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });

    await takeScoring(88);
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onNext).not.toHaveBeenCalled();
  });

  it("advances once the takes stop improving", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });

    await takeScoring(70);
    await anotherRep(80);
    // Rep three fails to beat the best so far: a plateau. More reps of this
    // clip buy boredom, not progress.
    await anotherRep(78);
    expect(screen.getByText(/Advancing…/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("advances at the target rep count even while still improving", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });

    await takeScoring(50);
    await anotherRep(58);
    await anotherRep(66);
    await anotherRep(74);
    await anotherRep(82);
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("lets Again cancel a pending advance — one more go means one more go", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });
    await takeScoring(70);
    await anotherRep(80);
    await anotherRep(78); // plateau: advance armed

    fireEvent.click(screen.getByRole("button", { name: /again/i }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // The old player moved the learner on mid-listen after a Loop. A learner
    // who asked for another rep gets another rep.
    expect(onNext).not.toHaveBeenCalled();
  });

  it("waits for the learner when advancing is switched off", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: false, threshold: 75 });

    await takeScoring(95);
    await anotherRep(94);
    await anotherRep(93);
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.queryByText(/Advancing…/)).not.toBeInTheDocument();
  });

  it("does not advance twice when the learner presses Next first", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });
    await takeScoring(70);
    await anotherRep(80);
    await anotherRep(78); // plateau: advance armed

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("always leaves Next available — the reps are a target, not a gate", async () => {
    const { onNext } = render();

    await takeScoring(40);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
