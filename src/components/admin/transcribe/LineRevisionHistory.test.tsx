import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LineRevisionHistory from "./LineRevisionHistory";
import type { TranscriptRevisionRow } from "@/hooks/useTranscriptReview";

/**
 * What changed on a line, and who changed it.
 *
 * The layout is the feature: the previous value sits above the new one so the
 * two can be read down the page. A side-by-side diff fails here specifically
 * because Arabic is right-to-left and English is not — a translation edit would
 * put the two versions at opposite edges of the panel with a gutter between
 * them.
 */

const aRevision = (over: Partial<TranscriptRevisionRow> = {}): TranscriptRevisionRow => ({
  id: "rev-1",
  lineId: "L1",
  field: "arabic",
  previousValue: "شلونك اليوم",
  newValue: "شخبارك اليوم",
  changedBy: "user-1",
  changedAt: "2026-08-24T10:00:00Z",
  source: "human",
  ...over,
});

describe("an entry", () => {
  it("shows the previous value and the new one", () => {
    render(<LineRevisionHistory revisions={[aRevision()]} />);

    expect(screen.getByText("شلونك اليوم")).toBeInTheDocument();
    expect(screen.getByText("شخبارك اليوم")).toBeInTheDocument();
  });

  it("labels which is which", () => {
    render(<LineRevisionHistory revisions={[aRevision()]} />);

    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
  });

  it("puts the previous value above the new one", () => {
    const { container } = render(<LineRevisionHistory revisions={[aRevision()]} />);

    const text = container.textContent ?? "";
    expect(text.indexOf("Before")).toBeLessThan(text.indexOf("After"));
  });

  it("names the field that changed", () => {
    render(<LineRevisionHistory revisions={[aRevision({ field: "translation" })]} />);

    expect(screen.getByText("Translation")).toBeInTheDocument();
  });

  it("falls back to the raw field name for one it does not know", () => {
    render(<LineRevisionHistory revisions={[aRevision({ field: "something_new" })]} />);

    expect(screen.getByText("something_new")).toBeInTheDocument();
  });

  it("reads Arabic right-to-left and English left-to-right", () => {
    const { container } = render(
      <LineRevisionHistory
        revisions={[
          aRevision({ id: "a", field: "arabic" }),
          aRevision({ id: "b", field: "translation", previousValue: "old", newValue: "new" }),
        ]}
      />,
    );

    const entries = container.querySelectorAll("li");
    expect(within(entries[0] as HTMLElement).getByText("شلونك اليوم")).toHaveAttribute("dir", "rtl");
    expect(within(entries[1] as HTMLElement).getByText("old")).toHaveAttribute("dir", "ltr");
  });
});

describe("who made the change", () => {
  it("distinguishes a person's edit from the machine's", () => {
    render(
      <LineRevisionHistory
        revisions={[
          aRevision({ id: "a", source: "human" }),
          aRevision({ id: "b", source: "ai_retranslate" }),
        ]}
      />,
    );

    expect(screen.getByText("edited by hand")).toBeInTheDocument();
    expect(screen.getByText("re-translated by AI")).toBeInTheDocument();
  });

  it("names the reviewer when it can", () => {
    render(
      <LineRevisionHistory
        revisions={[aRevision()]}
        nameFor={(id) => (id === "user-1" ? "Fatima" : "someone")}
      />,
    );

    expect(screen.getByText("· Fatima")).toBeInTheDocument();
  });
});

describe("the edges", () => {
  it("says a line is new rather than showing an empty box", () => {
    render(
      <LineRevisionHistory
        revisions={[aRevision({ field: "structure", previousValue: null })]}
      />,
    );

    expect(screen.getByText(/this is new/i)).toBeInTheDocument();
  });

  it("says a line was removed", () => {
    render(
      <LineRevisionHistory revisions={[aRevision({ field: "structure", newValue: null })]} />,
    );

    expect(screen.getByText("(removed)")).toBeInTheDocument();
  });

  it("explains an empty history instead of showing nothing", () => {
    render(<LineRevisionHistory revisions={[]} emptyLabel="Nothing changed here." />);

    expect(screen.getByText("Nothing changed here.")).toBeInTheDocument();
  });

  it("shows an unparseable timestamp rather than 'Invalid Date'", () => {
    render(<LineRevisionHistory revisions={[aRevision({ changedAt: "not-a-date" })]} />);

    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
