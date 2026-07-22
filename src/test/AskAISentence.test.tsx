import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { AskAISentence } from "@/components/shared/AskAISentence";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    })),
  },
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

/** Builds a fake fetch `body` exposing getReader(), yielding one SSE "data: " line per chunk. */
function sseBody(chunks: string[]) {
  const lines = [...chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`), "data: [DONE]\n\n"];
  let i = 0;
  const encoder = new TextEncoder();
  return {
    getReader() {
      return {
        read: async () => {
          if (i < lines.length) {
            return { value: encoder.encode(lines[i++]), done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function okStreamResponse(chunks: string[]) {
  return { ok: true, status: 200, body: sseBody(chunks) };
}

async function openDialog(props: Partial<React.ComponentProps<typeof AskAISentence>> = {}) {
  render(<AskAISentence arabic="مرحبا" english="Hello" variant="chip" {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
  return screen.findByRole("dialog");
}

describe("AskAISentence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockToastError.mockClear();
  });

  describe("trigger rendering", () => {
    it("renders a chip button with 'Ask AI' text for variant=chip", () => {
      render(<AskAISentence arabic="مرحبا" variant="chip" />);
      expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
    });

    it("renders an icon-only button with aria-label for variant=icon (default)", () => {
      render(<AskAISentence arabic="مرحبا" />);
      expect(
        screen.getByRole("button", { name: /ask ai about this sentence/i })
      ).toBeInTheDocument();
    });
  });

  it("opens the dialog showing the Arabic sentence and English translation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("مرحبا");
    expect(dialog).toHaveTextContent("Hello");
  });

  it("shows all 4 suggested questions when there are no messages yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    await openDialog();
    expect(screen.getByText("Why is it translated like this?")).toBeInTheDocument();
    expect(screen.getByText("Explain the grammar")).toBeInTheDocument();
    expect(screen.getByText("Tell me more")).toBeInTheDocument();
    expect(screen.getByText("Give me alternatives")).toBeInTheDocument();
  });

  it("sends a suggested question and calls fetch with the expected payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamResponse(["Sure!"]));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.click(screen.getByText("Explain the grammar"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toEqual(expect.stringContaining("ask-translation"));
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      arabic: "مرحبا",
      english: "Hello",
      dialect: "Gulf",
      messages: [{ role: "user", content: "Explain the grammar" }],
    });
  });

  it("sends typed input via the send button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamResponse(["Hi"]));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.change(screen.getByPlaceholderText("Ask a question…"), {
      target: { value: "What does this mean?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("What does this mean?")).toBeInTheDocument();
  });

  it("sends on Enter and does not send on Shift+Enter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamResponse(["Hi"]));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    const textarea = screen.getByPlaceholderText("Ask a question…");

    fireEvent.change(textarea, { target: { value: "line with shift enter" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("disables the send button when the input is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    await openDialog();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("does not send whitespace-only input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.change(screen.getByPlaceholderText("Ask a question…"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask a question…"), { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams and assembles the assistant reply, rendering markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamResponse(["This is ", "**bold** text"]));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() => {
      expect(screen.getByText("bold")).toBeInTheDocument();
    });
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.getByText(/This is/)).toBeInTheDocument();
  });

  it("renders a markdown bullet list from the assistant reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamResponse(["- first item\n- second item"]));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() => {
      expect(screen.getByText("first item")).toBeInTheDocument();
    });
    const list = screen.getByText("first item").closest("ul");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("second item").closest("ul")).toBe(list);
  });

  it("shows a loading spinner while awaiting the first chunk, and disables input", async () => {
    let resolveFetch!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask a question…")).toBeDisabled();
    });

    await act(async () => {
      resolveFetch(okStreamResponse(["done"]));
    });
  });

  it("shows a rate-limit toast on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, body: null }));
    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/too many requests/i))
    );
  });

  it("shows a credits-exhausted toast on 402", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 402, body: null }));
    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/ai credits exhausted/i))
    );
  });

  it("shows a generic toast on other non-ok statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }));
    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't reach the tutor/i))
    );
  });

  it("shows a generic toast when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    await openDialog();
    fireEvent.click(screen.getByText("Tell me more"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/something went wrong/i))
    );
  });
});
