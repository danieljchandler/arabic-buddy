import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { NativeReviewFrame } from "../../../supabase/functions/_shared/arabicReviewCore";
import { NativeReviewNote } from "./NativeReviewNote";

/**
 * The note an Arabic-native model leaves under a chat reply.
 *
 * The one thing this component must not do is look like a correction to the
 * answer above it. The learner has already read that answer; a note that reads
 * as "what you saw was wrong, here is the real text" leaves them unable to say
 * which of the two the app actually stands behind. Both readings stay on
 * screen, attributed, and the note says so in as many words.
 */

const review: NativeReviewFrame = {
  type: "native_review",
  model: "humain/humain-m3",
  corrections: [
    { arabic: "كيف حالك", suggestion: "شلونك", note: "MSA greeting, not spoken", kind: "msa" },
  ],
};

describe("NativeReviewNote", () => {
  it("shows what was said, what a native speaker would say, and why", () => {
    renderWithProviders(<NativeReviewNote review={review} />);

    expect(screen.getByText("كيف حالك")).toBeInTheDocument();
    expect(screen.getByText("شلونك")).toBeInTheDocument();
    expect(screen.getByText("MSA greeting, not spoken")).toBeInTheDocument();
  });

  it("attributes the judgment and says the answer is unchanged", () => {
    renderWithProviders(<NativeReviewNote review={review} />);

    // The vendor prefix is routing, not provenance — a learner reading "humain/"
    // learns nothing.
    expect(screen.getByText(/Checked by humain-m3/)).toBeInTheDocument();
    expect(screen.getByText(/the\s+answer above is unchanged/)).toBeInTheDocument();
  });

  it("falls back to the verdict when the judge gave no reason", () => {
    renderWithProviders(
      <NativeReviewNote
        review={{ ...review, corrections: [{ ...review.corrections[0], note: "" }] }}
      />,
    );

    expect(screen.getByText("MSA, not spoken")).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderWithProviders(
      <NativeReviewNote review={{ ...review, corrections: [] }} />,
    );

    expect(container.querySelector("[data-testid='native-review-note']")).toBeNull();
  });
});
