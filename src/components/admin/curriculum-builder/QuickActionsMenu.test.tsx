import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMode } from "./ChatInput";
import { QuickActionsMenu } from "./QuickActionsMenu";

/**
 * The generator picker in the curriculum builder's composer.
 *
 * Thirteen things the model can be asked to produce, grouped so an admin can
 * find one without reading all of them. Picking an action sets both the chat
 * mode and a prompt prefix, so the composer knows which generator to call and
 * the admin only has to type the topic.
 */

const openMenu = async (currentMode: ChatMode = "chat", disabled = false) => {
  const onSelect = vi.fn();
  const view = render(
    <QuickActionsMenu currentMode={currentMode} onSelect={onSelect} disabled={disabled} />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Brainstorm");
  return { ...view, onSelect };
};

/**
 * An action inside the popover, scoped to it — the trigger repeats the active
 * generator's label, so an unscoped query matches two elements.
 */
const action = (label: string) =>
  within(screen.getByRole("dialog")).getByRole("button", { name: label });

describe("QuickActionsMenu — the trigger", () => {
  it("offers to generate something", () => {
    render(<QuickActionsMenu currentMode="chat" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Generate/ })).toBeInTheDocument();
  });

  it("names the generator once one is chosen", () => {
    // The composer's placeholder changes too, but the button is what the admin
    // is looking at when they wonder what mode they are in.
    render(<QuickActionsMenu currentMode="generate_lesson" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Lesson/ })).toBeInTheDocument();
  });

  it("can be disabled while a generation is running", () => {
    render(<QuickActionsMenu currentMode="chat" onSelect={vi.fn()} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  /**
   * FINDING — the two reference actions leave the trigger saying "Generate".
   *
   * "Compare Dialects" and "Translate" both use mode `chat`, and the lookup
   * that decides the trigger's label explicitly skips `chat`
   * (`a.mode === currentMode && a.mode !== 'chat'`). So selecting either one
   * prefills the prompt but leaves the button looking untouched — the admin has
   * no confirmation that the click registered, and no way to tell afterwards
   * which of the two prefixes is in play.
   */
  it("shows no sign that a reference action was chosen", () => {
    render(<QuickActionsMenu currentMode="chat" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Generate/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Translate/ })).not.toBeInTheDocument();
  });
});

describe("QuickActionsMenu — the menu", () => {
  it("groups the actions", async () => {
    await openMenu();
    for (const group of ["Brainstorm", "Generate content", "Exercises", "Reference"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  it("offers every generator", async () => {
    await openMenu();
    for (const label of [
      "Suggest Lessons",
      "Suggest Vocab",
      "Lesson",
      "Vocabulary",
      "Grammar",
      "Listening",
      "Reading",
      "Daily Challenge",
      "Conversation",
      "Game Set",
      "Compare Dialects",
      "Translate",
    ]) {
      expect(action(label)).toBeInTheDocument();
    }
  });

  it("reports the whole action, not just its label", async () => {
    // The composer needs the mode and the prompt prefix as well, so it can call
    // the right generator and prefill the box.
    const { onSelect } = await openMenu();
    fireEvent.click(action("Lesson"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Lesson",
        mode: "generate_lesson",
        prompt: "Create a complete lesson about: ",
      }),
    );
  });

  it("gives each generator its own mode", async () => {
    const { onSelect } = await openMenu();
    fireEvent.click(action("Grammar"));
    expect(onSelect.mock.calls[0][0].mode).toBe("generate_grammar");
  });

  it("sends the reference actions through as plain chat", async () => {
    const { onSelect } = await openMenu();
    fireEvent.click(action("Translate"));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ mode: "chat" });
    expect(onSelect.mock.calls[0][0].prompt).toContain("Gulf Arabic");
  });

  it("marks the generator already in use", async () => {
    await openMenu("generate_reading");
    expect(action("Reading").className).toContain("ring-1");
  });

  it("marks only that one", async () => {
    await openMenu("generate_reading");
    expect(action("Listening").className).not.toContain("ring-1");
  });

  it("marks nothing when the composer is in plain chat", async () => {
    // Both reference actions are `chat`, so highlighting on mode alone would
    // light up two unrelated rows.
    await openMenu("chat");
    expect(action("Translate").className).not.toContain("ring-1");
    expect(action("Compare Dialects").className).not.toContain("ring-1");
  });

  /**
   * FINDING — the menu stays open over the composer after a choice.
   *
   * Nothing closes it: the popover is uncontrolled and the action buttons are
   * plain buttons rather than `PopoverClose`. So an admin picks a generator and
   * the 72-unit panel stays sitting on top of the input they now need to type
   * the topic into, until they click elsewhere to dismiss it.
   */
  it("does not close when an action is picked", async () => {
    await openMenu();
    fireEvent.click(action("Lesson"));
    expect(screen.getByText("Brainstorm")).toBeInTheDocument();
    expect(action("Vocabulary")).toBeInTheDocument();
  });
});
