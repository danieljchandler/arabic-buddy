import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialectClassifier from "./DialectClassifier";

/**
 * The two-level dialect picker on the review workspace.
 *
 * The interesting behaviour is all about the *dependency* between the two
 * dropdowns, because that is where a wrong answer is silent: a video left
 * claiming "Ḥijāzi" under "Egyptian" is not obviously broken on screen, but
 * every generator downstream reads it as a fact somebody asserted.
 */

function setup(over: Partial<React.ComponentProps<typeof DialectClassifier>> = {}) {
  const props = {
    dialect: "Saudi",
    subvariety: null as string | null,
    onChange: vi.fn(),
    ...over,
  };
  render(<DialectClassifier {...props} />);
  return props;
}

describe("what is on screen", () => {
  it("shows the dialect and the sub-dialect side by side", () => {
    setup({ subvariety: "hijazi" });

    expect(screen.getByLabelText("Dialect")).toHaveTextContent("Saudi");
    expect(screen.getByLabelText("Sub-dialect")).toHaveTextContent("Ḥijāzi");
  });

  it("explains the choice rather than only naming it", () => {
    setup({ subvariety: "tihami", dialect: "Yemeni" });

    // The hint is what tells a reviewer whether they picked the right one.
    expect(screen.getByText(/am-\/im- definite article/)).toBeInTheDocument();
  });

  it("sits on 'not sure' rather than guessing when nothing is set", () => {
    setup();

    // The default has to be honest: an unset video and one a reviewer judged
    // Najdi must not look the same.
    expect(screen.getByLabelText("Sub-dialect")).toHaveTextContent("Not sure");
  });

  it("hides the second dropdown for a dialect with no taxonomy", () => {
    setup({ dialect: "Levantine" });

    // Greying it out would invite the reviewer to work out why it will not
    // open; an absent control asks nothing of them.
    expect(screen.queryByLabelText("Sub-dialect")).not.toBeInTheDocument();
    expect(screen.getByText(/No sub-dialects are catalogued for Levantine/)).toBeInTheDocument();
  });
});

describe("choosing", () => {
  it("reports the sub-dialect that was picked", async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText("Sub-dialect"));
    await userEvent.click(screen.getByRole("option", { name: /Najdi/ }));

    expect(props.onChange).toHaveBeenCalledWith({ dialect: "Saudi", subvariety: "najdi" });
  });

  it("clears the sub-dialect when the country moves out from under it", async () => {
    const props = setup({ subvariety: "hijazi" });

    await userEvent.click(screen.getByLabelText("Dialect"));
    await userEvent.click(screen.getByRole("option", { name: "Egyptian" }));

    // The server clears it too, and that is the copy that counts — but leaving
    // "Ḥijāzi" visible under "Egyptian" until the save comes back reads as a
    // bug even though it isn't.
    expect(props.onChange).toHaveBeenCalledWith({ dialect: "Egyptian", subvariety: null });
  });

  it("keeps a sub-dialect that survives the move", async () => {
    // Shiḥḥi is on both the UAE and the Omani list, and it is the same variety.
    const props = setup({ dialect: "UAE", subvariety: "shihhi" });

    await userEvent.click(screen.getByLabelText("Dialect"));
    await userEvent.click(screen.getByRole("option", { name: "Omani" }));

    expect(props.onChange).toHaveBeenCalledWith({ dialect: "Omani", subvariety: "shihhi" });
  });

  it("lets the reviewer say they are not sure", async () => {
    const props = setup({ subvariety: "najdi" });

    await userEvent.click(screen.getByLabelText("Sub-dialect"));
    await userEvent.click(screen.getByRole("option", { name: /Not sure/ }));

    expect(props.onChange).toHaveBeenCalledWith({ dialect: "Saudi", subvariety: null });
  });
});

describe("labels already on the row", () => {
  it("shows a legacy dialect rather than an empty box", () => {
    // "Emirati" is written by the curriculum builder where the video form
    // writes "UAE". A Select whose value matches no item renders its
    // placeholder, so the video would look unclassified and the reviewer's
    // first touch would silently re-label it.
    setup({ dialect: "Emirati" });

    expect(screen.getByLabelText("Dialect")).toHaveTextContent("Emirati");
    expect(screen.getByLabelText("Sub-dialect")).toBeInTheDocument();
  });

  it("warns about a sub-dialect stranded under the wrong dialect", () => {
    setup({ dialect: "Egyptian", subvariety: "hijazi" });

    // Rather than dropping it silently: the reviewer should see what the row
    // used to claim, and be told what saving will do to it.
    expect(screen.getByText(/Ḥijāzi/)).toBeInTheDocument();
    expect(screen.getByText(/Saving will clear it/)).toBeInTheDocument();
  });
});

describe("while a save is in flight", () => {
  it("locks both dropdowns", () => {
    setup({ disabled: true, subvariety: "najdi" });

    expect(screen.getByLabelText("Dialect")).toBeDisabled();
    expect(screen.getByLabelText("Sub-dialect")).toBeDisabled();
  });
});
