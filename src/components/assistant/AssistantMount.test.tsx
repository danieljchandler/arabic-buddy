import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { AssistantMount } from "./AssistantMount";

/**
 * The mount owns the assistant's one global opener now that the floating disc
 * is gone — it covered the bottom bar from tablet widths up, and everything
 * else that opens the assistant is attached to the thing being asked about.
 *
 * So what is worth pinning is the keystroke and the routes it stays off: a
 * tutor sheet over the sign-in form or the admin console is a bug, and the FAB
 * used to be what kept it away.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Reports the panel's open state without rendering the lazy panel itself. */
function OpenProbe() {
  const { isOpen } = useAiAssistant();
  return <span data-testid="state">{isOpen ? "open" : "closed"}</span>;
}

const renderAt = (route: string) => {
  const harness = renderWithProviders(
    <>
      <AssistantMount />
      <OpenProbe />
    </>,
    { route },
  );
  cleanup = harness.cleanup;
};

const state = () => screen.getByTestId("state").textContent;
const pressCmdK = () => fireEvent.keyDown(window, { key: "k", metaKey: true });

describe("AssistantMount", () => {
  it.each([
    ["/", "the home screen"],
    ["/discover/abc-123", "a Discovery video"],
    ["/transcribe", "Transcribe"],
    ["/reading", "reading practice"],
  ])("opens on Cmd+K on %s (%s)", (route) => {
    renderAt(route);
    expect(state()).toBe("closed");
    pressCmdK();
    expect(state()).toBe("open");
  });

  it("closes again on a second press", () => {
    renderAt("/");
    pressCmdK();
    expect(state()).toBe("open");
    pressCmdK();
    expect(state()).toBe("closed");
  });

  it("answers Ctrl+K too, for the keyboards that have no Cmd", () => {
    renderAt("/");
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    expect(state()).toBe("open");
  });

  it("ignores a bare k, which is a letter someone is typing", () => {
    renderAt("/");
    fireEvent.keyDown(window, { key: "k" });
    expect(state()).toBe("closed");
  });

  it.each([["/auth"], ["/onboarding"], ["/admin/videos"], ["/reset-password"]])(
    "stays out of the way on %s",
    (route) => {
      renderAt(route);
      pressCmdK();
      expect(state()).toBe("closed");
    },
  );
});
