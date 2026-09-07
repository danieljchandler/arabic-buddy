import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CultureNotes, GrammarNotes, LessonDialogue } from "./LessonNotes";

/**
 * The curriculum-track sections. The one behaviour that matters most is the
 * negative one: a lesson without these sections (every lesson authored in the
 * admin UI or imported from a spreadsheet) must render nothing, not an empty
 * card.
 */

describe("GrammarNotes", () => {
  it("renders nothing when there are no notes", () => {
    const { container } = render(<GrammarNotes notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the pattern open by default, with each example in Arabic and English", () => {
    render(
      <GrammarNotes
        notes={[
          {
            category: "negation",
            title: "ما before a verb",
            explanation: "Put ما in front of the verb.",
            examples: [{ arabic: "ما أبي", transliteration: "ma abi", english: "I don't want" }],
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /the pattern/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("ما before a verb")).toBeInTheDocument();
    expect(screen.getByText("Put ما in front of the verb.")).toBeInTheDocument();
    expect(screen.getByText("ما أبي")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("ma abi")).toBeInTheDocument();
    expect(screen.getByText(/I don't want/)).toBeInTheDocument();
  });

  it("drops notes with no title rather than rendering a blank heading", () => {
    const { container } = render(<GrammarNotes notes={[{ title: "", examples: [] }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CultureNotes", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<CultureNotes notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default and opens on tap", () => {
    render(
      <CultureNotes
        notes={[
          {
            title: "Coffee first",
            note: "The host pours; shake the cup to stop.",
            phrases: [{ arabic: "تفضل قهوة", transliteration: "tfaḍḍal gahwa", english: "Have some coffee" }],
          },
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: /how it's done/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Coffee first")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Coffee first")).toBeInTheDocument();
    expect(screen.getByText("The host pours; shake the cup to stop.")).toBeInTheDocument();
    expect(screen.getByText("تفضل قهوة")).toBeInTheDocument();
  });

  it("tolerates a note with no phrases and a phrase with no gloss", () => {
    render(<CultureNotes notes={[{ title: "Shoes off", phrases: [{ arabic: "تفضل" }] }]} />);
    fireEvent.click(screen.getByRole("button", { name: /how it's done/i }));
    expect(screen.getByText("Shoes off")).toBeInTheDocument();
    expect(screen.getByText("تفضل")).toBeInTheDocument();
  });
});

describe("LessonDialogue", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<LessonDialogue lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels each line with its speaker, falling back to A/B", () => {
    render(
      <LessonDialogue
        lines={[
          { speaker: "Host", arabic: "تفضل", english: "Please" },
          { arabic: "شكراً", english: "Thanks" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hear it in a conversation/i }));
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("تفضل")).toBeInTheDocument();
    expect(screen.getByText("شكراً")).toBeInTheDocument();
  });
});
