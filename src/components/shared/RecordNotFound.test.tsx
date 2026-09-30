import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { RecordNotFound } from "./RecordNotFound";

/**
 * A missing record has to read as missing — not as an empty form or a page
 * with no title — and it has to leave by a real link back to its list.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("RecordNotFound", () => {
  it("names what is missing and why", () => {
    ({ cleanup } = renderWithProviders(
      <RecordNotFound title="Story not found" body="It may have been deleted." backTo="/stories" backLabel="Back to Stories" />,
    ));

    expect(screen.getByRole("heading", { name: "Story not found" })).toBeInTheDocument();
    expect(screen.getByText("It may have been deleted.")).toBeInTheDocument();
  });

  it("leaves by a link, so it can be opened in a new tab like any other", () => {
    ({ cleanup } = renderWithProviders(
      <RecordNotFound title="Video not found" backTo="/admin/videos" backLabel="Back to videos" />,
    ));

    expect(screen.getByRole("link", { name: "Back to videos" })).toHaveAttribute("href", "/admin/videos");
  });

  it("fills the screen when there is no shell around it", () => {
    ({ cleanup } = renderWithProviders(
      <RecordNotFound title="Topic not found" backTo="/admin/topics" backLabel="Back to topics" layout="screen" />,
    ));

    expect(screen.getByRole("heading", { name: "Topic not found" }).closest(".min-h-screen")).not.toBeNull();
  });
});
