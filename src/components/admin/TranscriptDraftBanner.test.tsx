import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TranscriptDraftState } from "@/hooks/useTranscriptDraft";
import { TranscriptDraftBanner } from "./TranscriptDraftBanner";

/**
 * The strip that keeps "auto-saved" and "published" apart.
 *
 * A reviewer spends an hour in this editor and reads whatever word is on screen
 * as the state of the world. If "saved" reads as "live", they walk away
 * believing learners have their corrections when the video still shows the old
 * transcript — a quieter and worse failure than losing the work outright. So
 * every state here names the button that actually publishes.
 */

const aDraft = (over: Partial<TranscriptDraftState> = {}): TranscriptDraftState => ({
  dirty: false,
  savedAt: null,
  failed: false,
  recovered: null,
  restore: vi.fn(),
  discardRecovered: vi.fn(),
  clear: vi.fn(),
  ...over,
});

const AT = new Date(2026, 0, 5, 14, 32).getTime();

describe("when everything is published", () => {
  it("shows nothing", () => {
    const { container } = render(<TranscriptDraftBanner draft={aDraft()} />);

    // The common case by far. A permanent banner would be read past.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("while there are unpublished changes", () => {
  it("says the changes are not published", () => {
    render(<TranscriptDraftBanner draft={aDraft({ dirty: true, savedAt: AT })} />);

    expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/learners still see the published/i);
  });

  it("names the button that publishes them", () => {
    render(<TranscriptDraftBanner draft={aDraft({ dirty: true, savedAt: AT })} />);

    // Not "save your work" — the reviewer needs the label they can see on the
    // page, at the bottom of a long form.
    expect(screen.getByRole("status")).toHaveTextContent(/Update Video/);
  });

  it("says where the auto-save went and when", () => {
    render(<TranscriptDraftBanner draft={aDraft({ dirty: true, savedAt: AT })} />);

    // "to this device" is the whole distinction, in three words.
    expect(screen.getByRole("status")).toHaveTextContent(/auto-saved to this device at/i);
  });

  it("does not claim a save that has not happened yet", () => {
    render(<TranscriptDraftBanner draft={aDraft({ dirty: true, savedAt: null })} />);

    expect(screen.getByRole("status")).toHaveTextContent(/saving a copy to this device/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/auto-saved to this device at/i);
  });
});

describe("when the browser will not store a draft", () => {
  it("says there is no backup, rather than staying quiet", () => {
    render(<TranscriptDraftBanner draft={aDraft({ dirty: true, failed: true })} />);

    // Private browsing and a full quota both do this, and a safety net nobody
    // is told has failed is worse than none.
    expect(screen.getByRole("status")).toHaveTextContent(/would not store a local backup/i);
    expect(screen.getByRole("status")).toHaveTextContent(/only in this tab/i);
  });
});

describe("when an abandoned draft is found", () => {
  const recovered = aDraft({
    recovered: { videoId: "vid-1", savedAt: AT, lines: [] },
  });

  it("offers the work back with the time it was done", () => {
    render(<TranscriptDraftBanner draft={recovered} />);

    expect(screen.getByRole("status")).toHaveTextContent(/unpublished transcript edits from/i);
    expect(screen.getByRole("status")).toHaveTextContent(/found on this device/i);
  });

  it("says what is on screen in the meantime", () => {
    render(<TranscriptDraftBanner draft={recovered} />);

    // Otherwise a reviewer reads the prompt as "your edits are already here"
    // and starts correcting the published transcript a second time.
    expect(screen.getByRole("status")).toHaveTextContent(/still the stored one/i);
  });

  it("restores on request", () => {
    const draft = aDraft({ recovered: { videoId: "vid-1", savedAt: AT, lines: [] } });
    render(<TranscriptDraftBanner draft={draft} />);

    fireEvent.click(screen.getByRole("button", { name: /restore edits/i }));

    expect(draft.restore).toHaveBeenCalled();
  });

  it("discards on request", () => {
    const draft = aDraft({ recovered: { videoId: "vid-1", savedAt: AT, lines: [] } });
    render(<TranscriptDraftBanner draft={draft} />);

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    expect(draft.discardRecovered).toHaveBeenCalled();
  });

  it("takes priority over the live status", () => {
    render(<TranscriptDraftBanner draft={aDraft({ ...recovered, dirty: true, savedAt: AT })} />);

    // One decision at a time: answering the recovery prompt is what decides
    // what the editor holds, so nothing else should compete with it.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /restore edits/i })).toBeInTheDocument();
  });
});
