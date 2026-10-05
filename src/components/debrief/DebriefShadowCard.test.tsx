import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { ShadowScoreResult } from "@/hooks/useShadowScore";
import type { ShadowLine } from "@/lib/videoDebrief";
import { DebriefShadowCard } from "./DebriefShadowCard";

/**
 * One line to shadow inside the debrief. The panel itself is tested where it
 * lives (LineShadowPanel.test.tsx); what is pinned here is what the debrief
 * hears back: the best of the learner's takes, or "skipped" — never a zero
 * for a line nobody tried.
 */

const panel = vi.hoisted(() => ({
  onResult: null as null | ((result: ShadowScoreResult) => void),
  onClose: null as null | (() => void),
  recordAttempt: undefined as boolean | undefined,
}));

vi.mock("@/components/pronunciation/LineShadowPanel", () => ({
  LineShadowPanel: (props: {
    onResult: (result: ShadowScoreResult) => void;
    onClose: () => void;
    recordAttempt?: boolean;
  }) => {
    panel.onResult = props.onResult;
    panel.onClose = props.onClose;
    panel.recordAttempt = props.recordAttempt;
    return <div data-testid="shadow-panel" />;
  },
}));

vi.mock("@/lib/vocabularyAudioContext", () => ({
  extractAudioClipFromUrl: vi.fn(async () => null),
}));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const LINE: ShadowLine = {
  lineId: "l5",
  lineNumber: 5,
  arabic: "روح ارتاح يا ريال",
  translation: "Go and rest, man",
  startMs: 7600,
  endMs: 9400,
};

const VIDEO = { platform: "tiktok", embed_url: null, source_url: null, dialect: "Gulf", title: "A clip" };

const take = (overall: number, recognizedText: string): ShadowScoreResult => ({
  overall,
  transcriptSimilarity: overall,
  rawTranscriptSimilarity: overall,
  acousticSimilarity: null,
  recognizedText,
  wordDiffs: [],
  tips: [],
});

function render(props: Partial<Parameters<typeof DebriefShadowCard>[0]> = {}) {
  const onDone = vi.fn();
  const harness = renderWithProviders(
    <DebriefShadowCard line={LINE} video={VIDEO} audioUrl="https://cdn.test/a.m4a" onDone={onDone} {...props} />,
  );
  cleanup = harness.cleanup;
  return { onDone };
}

describe("DebriefShadowCard", () => {
  it("opens the shadowing panel without filing takes in the practice history", () => {
    render();
    expect(screen.getByTestId("shadow-panel")).toBeInTheDocument();
    expect(panel.recordAttempt).toBe(false);
  });

  it("reports the best take when the learner is done", () => {
    const { onDone } = render();
    panel.onResult?.(take(58, "روح ارتاح"));
    panel.onResult?.(take(81, "روح ارتاح يا ريال"));
    panel.onResult?.(take(70, "روح ارتاح يا"));
    panel.onClose?.();
    expect(onDone).toHaveBeenCalledWith({
      lineNumber: 5,
      arabic: "روح ارتاح يا ريال",
      score: 81,
      heard: "روح ارتاح يا ريال",
    });
  });

  it("reports a line nobody tried as skipped", () => {
    const { onDone } = render();
    fireEvent.click(screen.getByRole("button", { name: /done with this line/i }));
    expect(onDone).toHaveBeenCalledWith({ lineNumber: 5, arabic: "روح ارتاح يا ريال", score: null, heard: undefined });
  });

  it("offers a skip when the clip cannot be played here", () => {
    const { onDone } = render({ audioUrl: null });
    expect(screen.getByText(/can't be played here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skip this line/i }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ score: null }));
  });

  it("shows what happened once done", () => {
    render({ outcome: { lineNumber: 5, arabic: "روح ارتاح يا ريال", score: 72.4 } });
    expect(screen.getByText("72/100")).toBeInTheDocument();
    expect(screen.queryByTestId("shadow-panel")).not.toBeInTheDocument();
  });
});
