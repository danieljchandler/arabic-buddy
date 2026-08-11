import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { streaming } from "@/test/support/server/functions";
import { aProfile } from "@/test/support/factories";
import { AiAssistantProvider, useAiAssistant } from "@/contexts/AiAssistantContext";
import { AskAiPanel } from "./AskAiPanel";

/**
 * The global Ask AI panel. What matters here is the request contract with
 * assistant-chat — dialect, the seed sentence, and the page context all ride
 * along — and that the streamed reply lands in the transcript. The transport
 * itself (chunk boundaries, auth header) is covered by sseChat.test.ts.
 */

function Opener({ seed }: { seed?: { arabic: string; english?: string } }) {
  const { openChat } = useAiAssistant();
  return (
    <button type="button" onClick={() => openChat(seed)}>
      open-assistant
    </button>
  );
}

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function render({
  seed,
  route = "/reading",
}: { seed?: { arabic: string; english?: string }; route?: string } = {}) {
  localStorage.setItem("hakiya_dialect_module", "Gulf");
  const harness = renderWithProviders(
    <AiAssistantProvider>
      <Opener seed={seed} />
      <AskAiPanel />
    </AiAssistantProvider>,
    {
      persona: "free",
      route,
      seed: (backend) => backend.db.seed("profiles", [aProfile({ preferred_dialect: "Gulf" })]),
    },
  );
  harness.backend.stubFunction(
    "assistant-chat",
    streaming("Because ", "it is idiomatic."),
  );
  cleanup = harness.cleanup;
  return harness;
}

const open = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "open-assistant" }));
  });
};

const ask = async (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Ask a question…"), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
};

describe("AskAiPanel", () => {
  it("streams a reply and sends dialect + page context with the question", async () => {
    const { backend } = render();

    await open();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await ask("Why is this passage hard?");

    await waitFor(() => {
      expect(screen.getByText(/Because it is idiomatic\./)).toBeInTheDocument();
    });

    const call = backend.lastCallTo("assistant-chat");
    expect(call).toBeTruthy();
    const body = call!.body as Record<string, unknown>;
    expect(body.dialect).toBe("Gulf");
    expect(body.seed).toBeUndefined();
    const page = body.pageContext as Record<string, unknown>;
    expect(page.route).toBe("/reading");
    // /reading is unregistered here, so the PAGE_HINTS fallback describes it.
    expect(page.title).toBe("Reading Practice");
    expect((body.messages as unknown[]).length).toBe(1);
  });

  it("carries the seed sentence when opened from a chip", async () => {
    const { backend } = render({ seed: { arabic: "شلونك اليوم", english: "How are you today?" } });

    await open();

    // The seed is pinned in the header (context chip + sentence card).
    expect(screen.getAllByText("شلونك اليوم").length).toBeGreaterThan(0);
    expect(screen.getByText("How are you today?")).toBeInTheDocument();

    // …and rides along in the request.
    await ask("Explain the grammar");
    await waitFor(() => {
      expect(backend.lastCallTo("assistant-chat")).toBeTruthy();
    });
    const body = backend.lastCallTo("assistant-chat")!.body as Record<string, unknown>;
    expect(body.seed).toEqual({ arabic: "شلونك اليوم", english: "How are you today?" });
  });

  it("offers suggested prompts before the first message", async () => {
    render();
    await open();
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
  });

  it("clears the conversation via New chat", async () => {
    render();
    await open();
    await ask("hello");
    await waitFor(() => {
      expect(screen.getByText(/Because it is idiomatic\./)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    });

    expect(screen.queryByText(/Because it is idiomatic\./)).toBeNull();
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
  });
});
