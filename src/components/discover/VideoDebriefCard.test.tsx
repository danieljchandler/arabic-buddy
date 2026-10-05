import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { VideoDebriefCard } from "./VideoDebriefCard";

/**
 * The way from a video into its debrief: always there under the video, with a
 * promise that names the words the learner just saved, and marked as a paid
 * feature for a learner who would land on the paywall.
 */

const VIDEO = "aaaaaaaa-0000-4000-8000-000000000000";

let cleanup: (() => void) | undefined;
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

function render(savedCount: number, subscribed: boolean) {
  const harness = renderWithProviders(<VideoDebriefCard videoId={VIDEO} savedCount={savedCount} />, {
    persona: "free",
    seed: (backend) =>
      backend.stubFunction("check-subscription", {
        subscribed,
        tier: subscribed ? "standard" : null,
        product_id: null,
        subscription_end: null,
      }),
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("VideoDebriefCard", () => {
  it("links to this video's debrief", () => {
    render(0, true);
    expect(screen.getByRole("link", { name: /check what you understood/i })).toHaveAttribute(
      "href",
      `/debrief/${VIDEO}`,
    );
  });

  it("promises a quiz on the words just saved", () => {
    render(3, true);
    expect(screen.getByText(/a quiz on the 3 words you saved/)).toBeInTheDocument();
  });

  it("speaks of one word in the singular", () => {
    render(1, true);
    expect(screen.getByText(/the 1 word you saved/)).toBeInTheDocument();
  });

  it("promises the unsure words when none were saved", () => {
    render(0, true);
    expect(screen.getByText(/the words you weren't sure of/)).toBeInTheDocument();
  });

  it("marks the feature as paid for a learner without a plan", async () => {
    render(0, false);
    await waitFor(() => expect(screen.getByText("Premium")).toBeInTheDocument());
  });

  it("shows no badge to a subscriber", async () => {
    const { backend } = render(0, true);
    await waitFor(() => expect(backend.callsTo("check-subscription").length).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
  });
});
