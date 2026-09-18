import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
 *
 * The dialect classification joined them for the same reason: the label the
 * pipeline guessed off a thirty-second clip was reaching every generator
 * downstream with nobody able to say it was Ḥijāzi and not Najdi.
 *
 * And the title after it. It is generated from the transcript and is the first
 * thing a learner reads, but it lived on the admin-only Details card — so a
 * transcriber who could see it was wrong had nowhere to put the correction.
 */

function setup(over: Partial<React.ComponentProps<typeof VideoNotesEditor>> = {}) {
  const props = {
    title: "Two friends greeting",
    titleArabic: "صديقان يتسلمان",
    culturalContext: "A greeting exchange.",
    grammarPoints: [{ title: "Negation", explanation: "ما before a verb.", examples: ["ما أدري"] }],
    vocabulary: [{ arabic: "شلونك", english: "how are you", root: "ل و ن" }],
    dialect: "Saudi",
    dialectSubvariety: null,
    dialectFeatures: [],
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

  it("sends every field together", async () => {
    const props = setup();

    fireEvent.change(screen.getByLabelText("Cultural notes"), { target: { value: "Revised." } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith({
        title: props.title,
        titleArabic: props.titleArabic,
        culturalContext: "Revised.",
        grammarPoints: props.grammarPoints,
        vocabulary: props.vocabulary,
        dialect: props.dialect,
        dialectSubvariety: props.dialectSubvariety,
        dialectFeatures: props.dialectFeatures,
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

describe("the title", () => {
  it("shows the name the video already has, in both languages", () => {
    setup();

    expect(screen.getByLabelText("Title")).toHaveValue("Two friends greeting");
    expect(screen.getByLabelText("Arabic title")).toHaveValue("صديقان يتسلمان");
  });

  it("sends a corrected title with the rest of the notes", async () => {
    // The whole point of the change: the pipeline names a clip off its own
    // transcript, and the reviewer is the person who can see that is wrong.
    const props = setup();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Two neighbours greeting in the street" },
    });
    fireEvent.change(screen.getByLabelText("Arabic title"), {
      target: { value: "جاران يتسلمان في الشارع" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Two neighbours greeting in the street",
          titleArabic: "جاران يتسلمان في الشارع",
        }),
      ),
    );
  });

  it("counts a renamed video as unsaved work", () => {
    setup();

    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A funeral greeting" } });
    expect(screen.getByRole("button", { name: "Save notes" })).toBeEnabled();
  });

  it("warns about a blank title instead of blocking the keystroke", () => {
    // Clearing the field to retype it is the common case; the server is what
    // refuses an actually-blank save, so the button stays live.
    setup();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });

    expect(screen.getByText(/needs an English title/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save notes" })).toBeEnabled();
  });
});

describe("the dialect classification", () => {
  it("sits above the notes it frames", () => {
    setup();

    expect(screen.getByText("Which variety is this?")).toBeInTheDocument();
    expect(screen.getByLabelText("Dialect")).toHaveTextContent("Saudi");
  });

  it("keeps dialect features in their own section, apart from grammar points", () => {
    // The separation is the point: a grammar point is what a learner should
    // take away about Arabic, a dialect feature is what places this speaker,
    // and most of the latter are not grammar at all.
    setup();

    expect(screen.getByText("Grammar points (1)")).toBeInTheDocument();
    expect(screen.getByText("Dialect-specific features (0)")).toBeInTheDocument();
  });

  it("sends the sub-dialect with the rest of the notes", async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText("Sub-dialect"));
    await userEvent.click(screen.getByRole("option", { name: /Ḥijāzi/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ dialect: "Saudi", dialectSubvariety: "hijazi" }),
      ),
    );
  });

  it("sends a dialect feature", async () => {
    const props = setup({ dialectSubvariety: "najdi" });

    await userEvent.click(screen.getByRole("button", { name: "Add a dialect feature" }));
    fireEvent.change(screen.getByLabelText("Dialect feature 1 contrast"), {
      target: { value: "Jeddah would say إيش." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          dialectFeatures: [
            expect.objectContaining({
              category: "phonology",
              subvariety: "najdi",
              contrast: "Jeddah would say إيش.",
            }),
          ],
        }),
      ),
    );
  });

  it("counts a change of dialect as unsaved work", () => {
    // Otherwise a reviewer re-labels a mis-tagged video, sees a disabled save
    // button, and concludes it went through.
    const { view, ...props } = setup();

    view.rerender(<VideoNotesEditor {...props} />);
    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add a dialect feature" }));
    expect(screen.getByRole("button", { name: "Save notes" })).toBeEnabled();
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

  it("takes up the title that arrives", () => {
    const { view, ...props } = setup({ title: "", titleArabic: "" });

    view.rerender(<VideoNotesEditor {...props} title="Named by the pipeline" titleArabic="عنوان" />);

    expect(screen.getByLabelText("Title")).toHaveValue("Named by the pipeline");
    expect(screen.getByLabelText("Arabic title")).toHaveValue("عنوان");
  });

  it("takes up the dialect classification that arrives", () => {
    const { view, ...props } = setup();

    view.rerender(<VideoNotesEditor {...props} dialect="Yemeni" dialectSubvariety="tihami" />);

    expect(screen.getByLabelText("Dialect")).toHaveTextContent("Yemeni");
    expect(screen.getByLabelText("Sub-dialect")).toHaveTextContent("Tihāmi");
  });
});
