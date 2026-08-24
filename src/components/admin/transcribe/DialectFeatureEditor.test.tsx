import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialectFeatureEditor from "./DialectFeatureEditor";

/**
 * Where a reviewer records what marks this clip as the variety it is in.
 *
 * The thing worth protecting here is the *separation from grammar points*. The
 * card above this one is what a learner should take away about Arabic; this one
 * is what places this speaker, and most of the answers — a ق, a borrowing, an
 * intonation contour — are not grammar at all. Every test below is really a
 * test that this stayed its own shape rather than collapsing into the other.
 */

function setup(over: Partial<React.ComponentProps<typeof DialectFeatureEditor>> = {}) {
  const props = {
    features: [
      {
        category: "question-words",
        subvariety: "hijazi",
        title: "إيش rather than وش",
        explanation: "Hijazi asks with إيش.",
        contrast: "Riyadh would say وش.",
      },
    ],
    onChange: vi.fn(),
    dialect: "Saudi",
    subvariety: "hijazi" as string | null,
    ...over,
  };
  render(<DialectFeatureEditor {...props} />);
  return props;
}

describe("what is on screen", () => {
  it("shows a feature with its category, variety and contrast", () => {
    setup();

    expect(screen.getByLabelText("Dialect feature 1 category")).toHaveTextContent("Question words");
    expect(screen.getByLabelText("Dialect feature 1 sub-dialect")).toHaveTextContent("Ḥijāzi");
    expect(screen.getByLabelText("Dialect feature 1 contrast")).toHaveValue("Riyadh would say وش.");
  });

  it("says what the section is for rather than showing a bare heading", () => {
    setup({ features: [] });

    expect(screen.getByText(/what places this speaker/i)).toBeInTheDocument();
  });

  it("offers no line picker when there is no transcript to point at", () => {
    setup();

    expect(screen.queryByLabelText("Dialect feature 1 line")).not.toBeInTheDocument();
  });

  it("hides the variety picker for a dialect with no taxonomy", () => {
    setup({ dialect: "Levantine", features: [{ category: "lexicon", title: "x" }] });

    expect(screen.queryByLabelText("Dialect feature 1 sub-dialect")).not.toBeInTheDocument();
  });
});

describe("adding", () => {
  it("pre-fills the video's own variety", async () => {
    // The common case by a long way, and one fewer dropdown between hearing
    // something and writing it down.
    const props = setup({ features: [] });

    await userEvent.click(screen.getByRole("button", { name: "Add a dialect feature" }));

    expect(props.onChange).toHaveBeenCalledWith([
      { category: "phonology", subvariety: "hijazi" },
    ]);
  });

  it("leaves the variety unset when the video has none", async () => {
    const props = setup({ features: [], subvariety: null });

    await userEvent.click(screen.getByRole("button", { name: "Add a dialect feature" }));

    expect(props.onChange).toHaveBeenCalledWith([
      { category: "phonology", subvariety: undefined },
    ]);
  });

  it("stops at the cap", () => {
    const many = Array.from({ length: 100 }, () => ({ category: "lexicon", title: "a word" }));
    setup({ features: many });

    expect(screen.getByRole("button", { name: "Add a dialect feature" })).toBeDisabled();
    expect(screen.getByText(/100 is the most one video can carry/)).toBeInTheDocument();
  });
});

describe("editing", () => {
  it("records a change of category", async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText("Dialect feature 1 category"));
    await userEvent.click(screen.getByRole("option", { name: /Loanwords/ }));

    expect(props.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ category: "borrowings" }),
    ]);
  });

  it("lets a feature apply to the dialect as a whole", async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText("Dialect feature 1 sub-dialect"));
    await userEvent.click(screen.getByRole("option", { name: "The dialect as a whole" }));

    expect(props.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ subvariety: undefined }),
    ]);
  });

  it("keeps a variety borrowed from another country on offer", () => {
    // A Cairene speaker quoting a Ṣaʿīdi phrase is a real thing to record, so
    // the dropdown must not quietly drop the tag the moment it is opened.
    setup({
      dialect: "Egyptian",
      subvariety: "cairene",
      features: [{ category: "lexicon", subvariety: "saidi", title: "a quoted word" }],
    });

    expect(screen.getByLabelText("Dialect feature 1 sub-dialect")).toHaveTextContent("Ṣaʿīdi");
  });

  it("removes one", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Remove dialect feature 1" }));

    expect(props.onChange).toHaveBeenCalledWith([]);
  });
});

describe("pinning a feature to a line", () => {
  it("names the lines by their Arabic, not by their ids", async () => {
    // "L2" tells the reviewer nothing about where in the clip they are.
    const props = setup({
      lines: [
        { id: "L1", arabic: "شلونك اليوم" },
        { id: "L2", arabic: "إيش تبغى؟" },
      ],
    });

    await userEvent.click(screen.getByLabelText("Dialect feature 1 line"));
    await userEvent.click(screen.getByRole("option", { name: /إيش تبغى/ }));

    expect(props.onChange).toHaveBeenCalledWith([expect.objectContaining({ lineId: "L2" })]);
  });

  it("lets a feature be true of the whole clip", async () => {
    const props = setup({
      features: [{ category: "phonology", title: "ق as [g]", lineId: "L1" }],
      lines: [{ id: "L1", arabic: "شلونك" }],
    });

    await userEvent.click(screen.getByLabelText("Dialect feature 1 line"));
    await userEvent.click(screen.getByRole("option", { name: "Throughout" }));

    expect(props.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ lineId: undefined }),
    ]);
  });

  it("falls back to a number for a line with no Arabic yet", () => {
    setup({ lines: [{ id: "L1" }] });

    expect(screen.getByLabelText("Dialect feature 1 line")).toBeInTheDocument();
  });
});
