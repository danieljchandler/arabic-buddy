import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranslationProvenancePanel, type TranslationProvenance } from "./TranslationProvenancePanel";

/**
 * The panel that says why a transcript has, or has not, got its English.
 *
 * Before it, a video that arrived untranslated was a dead end for the person
 * looking at it: which of the three models failed, and why, lived only in the
 * function logs. What matters here is that a failure is named with the
 * model's own error, that a fallback fill is counted, and that an analysis
 * running an older build than the app is called out — the build banner only
 * probes the pipeline function, so this is the one place that can say it.
 */

const provenance = (over: Partial<TranslationProvenance> = {}): TranslationProvenance => ({
  strategy: "weighted_ensemble",
  build: "2026-09-05.6",
  merge_model: "qwen/qwen3-235b-a22b",
  degraded: false,
  active_models: 3,
  lines: 12,
  blank_after_ensemble: 0,
  cheap_fill: 0,
  tiers: [
    { name: "anthropic/claude-sonnet-5", via: "openrouter", weight: 1, status: "ok", latency_ms: 12_300, lines_won: 7 },
    { name: "google/gemini-3.7-flash", via: "google", weight: 1, status: "ok", latency_ms: 8_100, lines_won: 5 },
    { name: "qwen/qwen3.8-max", via: "openrouter", weight: 0.6, status: "ok", latency_ms: 30_000, lines_won: 0 },
  ],
  ...over,
});

const render_ = (translation: TranslationProvenance | undefined, expectedBuild = "2026-09-05.6") =>
  render(
    <TranslationProvenancePanel
      enginesUsed={translation ? { translation } : { asr: {} }}
      expectedBuild={expectedBuild}
    />,
  );

describe("TranslationProvenancePanel", () => {
  it("shows nothing for a row the analysis never annotated", () => {
    const { container } = render_(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("names every model, how long it took and what it won", () => {
    render_(provenance());
    expect(screen.getByText("Translation — 3 of 3 models answered")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getByText(/answered in 12\.3s — won 7 lines/)).toBeInTheDocument();
    expect(screen.getByText(/answered in 30\.0s — won 0 lines/)).toBeInTheDocument();
  });

  it("says what a failed model said, in the model's own words", () => {
    render_(provenance({
      active_models: 0,
      degraded: true,
      tiers: [
        { name: "anthropic/claude-sonnet-5", via: "openrouter", status: "failed", latency_ms: 40_010, error: "AI request timed out after 40000ms" },
        { name: "google/gemini-3.7-flash", via: "google", status: "parse_failed", latency_ms: 9_000 },
        { name: "qwen/qwen3.8-max", via: "openrouter", status: "failed", latency_ms: 5_200, error: "AI response timed out after 5000ms of generation" },
      ],
    }));
    expect(screen.getByText(/0 of 3 models answered: no English came from the ensemble/)).toBeInTheDocument();
    expect(screen.getByText(/failed after 40\.0s — AI request timed out after 40000ms/)).toBeInTheDocument();
    expect(screen.getByText(/answered, but not with usable JSON after 9\.0s/)).toBeInTheDocument();
    expect(screen.getByTestId("translation-provenance").className).toContain("border-destructive");
  });

  it("counts the lines a cheaper fallback filled", () => {
    render_(provenance({ blank_after_ensemble: 4, cheap_fill: 3 }));
    expect(screen.getByText(/4 lines left blank by the ensemble; 3 filled by the per-line fallback translator/)).toBeInTheDocument();
  });

  it("calls out an analysis running an older build than the app", () => {
    render_(provenance({ build: "2026-09-05.4" }), "2026-09-05.6");
    expect(screen.getByText(/Analysis build 2026-09-05\.4/)).toBeInTheDocument();
    expect(screen.getByText(/this app expects 2026-09-05\.6\. Deploy analyze-gulf-arabic/)).toBeInTheDocument();
  });

  it("stays quiet about the build when it matches", () => {
    render_(provenance());
    expect(screen.getByText(/Analysis build 2026-09-05\.6 · merge on qwen3-235b-a22b/)).toBeInTheDocument();
    expect(screen.queryByText(/Deploy analyze-gulf-arabic/)).not.toBeInTheDocument();
  });
});
