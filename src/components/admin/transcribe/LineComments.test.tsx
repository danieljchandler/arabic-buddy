import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineComments from "./LineComments";
import type { TranscriptCommentRow } from "@/hooks/useTranscriptReview";

/**
 * The reviewer's channel back to whoever owns the content.
 *
 * The kind on a comment is what makes it actionable: "the translation is
 * defensible but wrong in register" and "I do not think this clip is
 * appropriate" both need somewhere to go that is not a silent edit, and they
 * need different attention. A suggestion carries the proposed English as its
 * own field so it can be applied rather than transcribed by hand.
 */

const aComment = (over: Partial<TranscriptCommentRow> = {}): TranscriptCommentRow => ({
  id: "c-1",
  lineId: "L1",
  kind: "comment",
  body: "This reads oddly.",
  suggestedTranslation: null,
  authorId: "user-1",
  createdAt: "2026-08-24T10:00:00Z",
  resolvedAt: null,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof LineComments>> = {}) {
  const props = {
    comments: [] as TranscriptCommentRow[],
    onAdd: vi.fn().mockResolvedValue(undefined),
    onResolve: vi.fn(),
    ...over,
  };
  render(<LineComments {...props} />);
  return props;
}

describe("writing one", () => {
  it("sends the text", async () => {
    const props = setup();

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "وايد is Gulf, not Egyptian." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() =>
      expect(props.onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ body: "وايد is Gulf, not Egyptian.", kind: "comment" }),
      ),
    );
  });

  it("will not send an empty comment", () => {
    setup();

    expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
  });

  it("will not send whitespace either", () => {
    const props = setup();

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("clears the box after sending, ready for the next line", async () => {
    setup();

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Noted." } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue(""));
  });

  it("carries a suggested translation as its own field", async () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: "Better translation" }));
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "Too formal for how this is said." },
    });
    fireEvent.change(screen.getByLabelText("Suggested translation"), {
      target: { value: "How's it going?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() =>
      expect(props.onAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "suggestion",
          suggestedTranslation: "How's it going?",
        }),
      ),
    );
  });

  it("only asks for a suggested translation when that is the kind", () => {
    setup();

    expect(screen.queryByLabelText("Suggested translation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Better translation" }));

    expect(screen.getByLabelText("Suggested translation")).toBeInTheDocument();
  });

  it("does not attach a stale suggestion to a plain note", async () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: "Better translation" }));
    fireEvent.change(screen.getByLabelText("Suggested translation"), {
      target: { value: "abandoned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Concern" }));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Actually…" } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() =>
      expect(props.onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "concern", suggestedTranslation: undefined }),
      ),
    );
  });
});

describe("reading them", () => {
  it("says so when there are none", () => {
    setup();

    expect(screen.getByText(/No comments on this line yet/i)).toBeInTheDocument();
  });

  it("shows the body and the kind", () => {
    setup({ comments: [aComment({ kind: "concern", body: "Is this Kuwaiti?" })] });

    expect(screen.getByText("Is this Kuwaiti?")).toBeInTheDocument();
    // Scoped to the comment itself: "Concern" is also one of the kind buttons
    // on the compose box below.
    const entry = screen.getByRole("listitem");
    expect(within(entry).getByText("Concern")).toBeInTheDocument();
  });

  it("folds resolved comments away without losing them", () => {
    setup({
      comments: [
        aComment({ id: "open", body: "Still open" }),
        aComment({ id: "done", body: "Dealt with", resolvedAt: "2026-08-24T11:00:00Z" }),
      ],
    });

    expect(screen.getByText("Still open")).toBeInTheDocument();
    expect(screen.getByText("1 resolved")).toBeInTheDocument();
    expect(screen.getByText("Dealt with")).toBeInTheDocument();
  });

  it("names the author when it can", () => {
    setup({ comments: [aComment()], nameFor: () => "Fatima" });

    expect(screen.getByText("Fatima")).toBeInTheDocument();
  });
});

describe("acting on them", () => {
  it("resolves an open comment", () => {
    const props = setup({ comments: [aComment()] });

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(props.onResolve).toHaveBeenCalledWith("c-1", true);
  });

  it("reopens a resolved one", () => {
    const props = setup({
      comments: [aComment({ resolvedAt: "2026-08-24T11:00:00Z" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    expect(props.onResolve).toHaveBeenCalledWith("c-1", false);
  });

  it("applies a suggested translation in one click", () => {
    const onApplySuggestion = vi.fn();
    setup({
      comments: [aComment({ kind: "suggestion", suggestedTranslation: "How's it going?" })],
      onApplySuggestion,
    });

    fireEvent.click(screen.getByRole("button", { name: "Use this translation" }));

    expect(onApplySuggestion).toHaveBeenCalledWith("How's it going?");
  });

  it("does not offer to apply a suggestion that has been resolved", () => {
    setup({
      comments: [
        aComment({
          kind: "suggestion",
          suggestedTranslation: "How's it going?",
          resolvedAt: "2026-08-24T11:00:00Z",
        }),
      ],
      onApplySuggestion: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: "Use this translation" })).not.toBeInTheDocument();
  });

  it("hides the apply button on a whole-video thread, which has no line to apply to", () => {
    setup({
      comments: [aComment({ kind: "suggestion", suggestedTranslation: "How's it going?" })],
    });

    expect(screen.queryByRole("button", { name: "Use this translation" })).not.toBeInTheDocument();
  });

  it("locks the controls while a write is in flight", () => {
    setup({ comments: [aComment()], busy: true });

    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
  });
});
