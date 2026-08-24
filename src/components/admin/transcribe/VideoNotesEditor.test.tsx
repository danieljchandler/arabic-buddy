import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VideoNotesEditor from "./VideoNotesEditor";

/**
 * Everything about the video that is not a line of transcript.
 *
 * A native speaker's usefulness does not stop at the Arabic — they are the
 * person who knows a phrase is only said at a funeral, or that a grammar note
 * describes MSA rather than what is actually spoken. So these fields are
 * editable here rather than behind the admin-only video form, and the grammar
 * examples in particular are editable at all for the first time: the pipeline
 * writes them and nothing in the old form could correct them.
 */

function setup(over: Partial<React.ComponentProps<typeof VideoNotesEditor>> = {}) {
  const props = {
    culturalContext: "A greeting exchange.",
    grammarPoints: [{ title: "Negation", explanation: "ما before a verb.", examples: ["ما أدري"] }],
    vocabulary: [{ arabic: "شلونك", english: "how are you", root: "ل و ن" }],
    onSave: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const view = render(<VideoNotesEditor {...props} />);
  return { ...props, view };
}

describe("what is on screen", () => {
  it("shows the notes as they stand", () => {
    setup();

    expect(screen.getByLabelText("Cultural notes")).toHaveValue("A greeting exchange.");
    expect(screen.getByLabelText("Grammar point 1 title")).toHaveValue("Negation");
    expect(screen.getByLabelText("Vocabulary 1 Arabic")).toHaveValue("شلونك");
  });

  it("makes the grammar examples editable", () => {
    setup();

    expect(screen.getByLabelText("Grammar point 1 examples")).toHaveValue("ما أدري");
  });

  it("counts what is there", () => {
    setup();

    expect(screen.getByText("Grammar points (1)")).toBeInTheDocument();
    expect(screen.getByText("Vocabulary (1)")).toBeInTheDocument();
  });

  it("says when a section is empty rather than showing a bare heading", () => {
    setup({ grammarPoints: [], vocabulary: [] });

    expect(screen.getByText("No grammar points yet.")).toBeInTheDocument();
    expect(screen.getByText("No vocabulary yet.")).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("stays disabled until something changes", () => {
    setup();

    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
  });

  it("wakes up on an edit and says so", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Cultural notes"), {
      target: { value: "A greeting between neighbours." },
    });

    expect(screen.getByRole("button", { name: "Save notes" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("sends all three fields together", async () => {
    const props = setup();

    fireEvent.change(screen.getByLabelText("Cultural notes"), { target: { value: "Revised." } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith({
        culturalContext: "Revised.",
        grammarPoints: props.grammarPoints,
        vocabulary: props.vocabulary,
      }),
    );
  });

  it("splits the examples box back into a list", async () => {
    const props = setup();

    fireEvent.change(screen.getByLabelText("Grammar point 1 examples"), {
      target: { value: "ما أدري\nما عندي\n\n  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          // Blank lines dropped: a trailing newline is a keystroke, not an example.
          grammarPoints: [expect.objectContaining({ examples: ["ما أدري", "ما عندي"] })],
        }),
      ),
    );
  });

  it("locks while the save is in flight", () => {
    setup({ busy: true });

    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
  });
});

describe("adding and removing", () => {
  it("adds a grammar point", () => {
    setup();

    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);

    expect(screen.getByText("Grammar points (2)")).toBeInTheDocument();
  });

  it("removes one", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Remove grammar point 1" }));

    expect(screen.getByText("Grammar points (0)")).toBeInTheDocument();
  });

  it("adds a vocabulary entry", () => {
    setup();

    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);

    expect(screen.getByText("Vocabulary (2)")).toBeInTheDocument();
  });

  it("removes one", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Remove vocabulary 1" }));

    expect(screen.getByText("Vocabulary (0)")).toBeInTheDocument();
  });
});

describe("when the video finishes loading", () => {
  it("takes up the notes that arrive", () => {
    const { view, ...props } = setup({ culturalContext: "" });

    view.rerender(
      <VideoNotesEditor {...props} culturalContext="Arrived from the server." />,
    );

    // Otherwise the reviewer sees an empty box over a video that has notes, and
    // saving would wipe them.
    expect(screen.getByLabelText("Cultural notes")).toHaveValue("Arrived from the server.");
  });
});
