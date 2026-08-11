import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile } from "@/test/support/factories";
import { AskAISentence } from "./AskAISentence";

/**
 * "Ask AI about this sentence."
 *
 * A translation on its own answers *what* but never *why*, and the why is where
 * a dialect learner actually gets stuck — why this pronoun, why this word order,
 * why the Gulf form and not the MSA one. This is the escape hatch attached to
 * every sentence in the app.
 *
 * It talks to the edge function directly rather than through supabase-js,
 * because the reply is streamed: the answer types itself out instead of
 * appearing after a five-second pause. That means this file has to drive a real
 * SSE body, and it is where the interesting failures live — a chunk boundary
 * mid-token, a malformed frame, a reply that turns out to be empty.
 */

const CHAT_URL = "https://e2e.supabase.co/functions/v1/ask-translation";

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toasts.error(...a),
    success: (...a: unknown[]) => toasts.success(...a),
  },
}));

/** One SSE frame carrying a token, as the function emits them. */
const frame = (delta: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n`;

/** A body that emits the given raw chunks in order, then closes. */
function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface Reply {
  status?: number;
  chunks?: string[];
  /** Rejects instead of responding, the way a dropped connection does. */
  throws?: boolean;
}

let calls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
let reply: Reply = { chunks: [frame("Because "), frame("it is idiomatic."), "data: [DONE]\n"] };
let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
  calls = [];
  reply = { chunks: [frame("Because "), frame("it is idiomatic."), "data: [DONE]\n"] };
});

afterEach(async () => {
  // DialectProvider resolves the profile in the background. Restoring the real
  // fetch before that lands turns it into an unstubbed network request, and the
  // state it sets lands outside act().
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

/**
 * The harness installs the in-memory backend as `globalThis.fetch`. This wraps
 * it so the streaming endpoint is served here — a JSON stub would have no SSE
 * body to read — and everything else still reaches the emulator.
 */
function installChatFetch() {
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(CHAT_URL)) return inner(input as RequestInfo, init);

    calls.push({
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    if (reply.throws) throw new Error("network down");
    const status = reply.status ?? 200;
    if (status !== 200) return new Response("", { status });
    return new Response(sse(reply.chunks ?? []), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

interface Options {
  arabic?: string;
  english?: string;
  variant?: "icon" | "chip";
  dialect?: string;
}

function render({
  arabic = "شفيك اليوم؟",
  english = "What's up with you today?",
  variant,
  dialect = "Gulf",
}: Options = {}) {
  localStorage.setItem("hakiya_dialect_module", dialect);
  const harness = renderWithProviders(
    <AskAISentence arabic={arabic} english={english} variant={variant} />,
    // DialectProvider syncs from the profile on mount and overwrites what is in
    // localStorage, so the persona's profile has to agree or the dialect the
    // component reads is whatever the persona was seeded with.
    { persona: "free", seed: (backend) => backend.db.seed("profiles", [aProfile({ preferred_dialect: dialect })]) },
  );
  installChatFetch();
  cleanup = harness.cleanup;
  return harness;
}

const openDialog = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Ask AI( about this sentence)?/ }));
  });
};

const box = () => screen.getByPlaceholderText("Ask a question…");
const sendButton = () => screen.getByRole("button", { name: "Send" });

const ask = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(sendButton());
  });
};

/** The reply bubbles, in order. */
const answers = () =>
  Array.from(document.querySelectorAll(".bg-muted\\/50")) as HTMLElement[];

describe("the way in", () => {
  it("is an unobtrusive icon on a sentence by default", () => {
    render();

    // It hangs off every sentence in the app, so the default has to disappear
    // into the line rather than compete with it.
    expect(screen.getByRole("button", { name: "Ask AI about this sentence" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be a labelled chip where there is room", () => {
    render({ variant: "chip" });

    expect(screen.getByRole("button", { name: "Ask AI" })).toBeInTheDocument();
  });

  it("shows the sentence being asked about", async () => {
    render();

    await openDialog();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("شفيك اليوم؟")).toHaveAttribute("dir", "rtl");
    expect(within(dialog).getByText("What's up with you today?")).toBeInTheDocument();
  });

  it("works on a sentence with no translation yet", async () => {
    render({ english: undefined });

    await openDialog();

    // Tapping into an untranslated line is the most likely moment to want this.
    expect(within(screen.getByRole("dialog")).getByText("شفيك اليوم؟")).toBeInTheDocument();
  });

  it("offers questions worth asking before anything is typed", async () => {
    render();

    await openDialog();

    // A blank box invites nothing. These are the four questions a learner
    // actually has and would not think to phrase.
    for (const suggestion of [
      "Why is it translated like this?",
      "Explain the grammar",
      "Tell me more",
      "Give me alternatives",
    ]) {
      expect(screen.getByRole("button", { name: suggestion })).toBeInTheDocument();
    }
  });
});

describe("asking", () => {
  it("sends the sentence, the dialect and the conversation so far", async () => {
    render({ dialect: "Egyptian" });
    await openDialog();

    await ask("Why the feminine here?");

    // The dialect is what stops the answer explaining MSA grammar the learner is
    // not being taught.
    expect(calls[0].body).toMatchObject({
      arabic: "شفيك اليوم؟",
      english: "What's up with you today?",
      dialect: "Egyptian",
      messages: [{ role: "user", content: "Why the feminine here?" }],
    });
  });

  it("carries the earlier turns into the follow-up", async () => {
    render();
    await openDialog();
    await ask("Explain the grammar");

    await ask("And the word order?");

    // "Tell me more" is meaningless without the thread; the whole value of a
    // dialog over a one-shot lookup is the follow-up.
    expect(calls[1].body.messages).toEqual([
      { role: "user", content: "Explain the grammar" },
      { role: "assistant", content: "Because it is idiomatic." },
      { role: "user", content: "And the word order?" },
    ]);
  });

  it("asks a suggested question straight off the chip", async () => {
    render();
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain the grammar" }));
    });

    expect(calls[0].body.messages).toEqual([{ role: "user", content: "Explain the grammar" }]);
    // The chips are the empty state, so they go once there is a conversation.
    expect(screen.queryByRole("button", { name: "Tell me more" })).toBeNull();
  });

  it("sends on Enter and keeps Shift+Enter for a new line", async () => {
    render();
    await openDialog();
    fireEvent.change(box(), { target: { value: "why?" } });

    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(calls).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(calls).toHaveLength(1);
  });

  it("clears the box once the question is away", async () => {
    render();
    await openDialog();

    await ask("why?");

    expect(box()).toHaveValue("");
  });

  it("will not send an empty question", async () => {
    render();
    await openDialog();

    expect(sendButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(sendButton()).toBeDisabled();
  });

  it("shows the question straight away rather than after the answer", async () => {
    render();
    await openDialog();

    await ask("Why the feminine here?");

    // The optimistic echo is what makes the dialog feel like a conversation
    // rather than a form submission.
    expect(screen.getByText("Why the feminine here?")).toBeInTheDocument();
  });
});

describe("the streamed answer", () => {
  it("assembles the reply from the tokens as they arrive", async () => {
    render();
    await openDialog();

    await ask("why?");

    await waitFor(() => expect(answers()[0]).toHaveTextContent("Because it is idiomatic."));
  });

  it("survives a token split across two chunks", async () => {
    reply = {
      chunks: [
        // The newline that terminates the first frame arrives in the second read.
        `data: ${JSON.stringify({ choices: [{ delta: { content: "half" } }] })}`,
        `\n${frame(" a token")}data: [DONE]\n`,
      ],
    };
    render();
    await openDialog();

    await ask("why?");

    // A network never respects frame boundaries, so the buffer either handles
    // this or the answer loses a word at every chunk edge.
    await waitFor(() => expect(answers()[0]).toHaveTextContent("half a token"));
  });

  it("ignores anything that is not a data frame", async () => {
    reply = { chunks: [": keep-alive\n", "\n", frame("Answer."), "data: [DONE]\n"] };
    render();
    await openDialog();

    await ask("why?");

    await waitFor(() => expect(answers()[0]).toHaveTextContent("Answer."));
  });

  it("stops at the end marker", async () => {
    reply = { chunks: [frame("Done."), "data: [DONE]\n", frame(" And more.")] };
    render();
    await openDialog();

    await ask("why?");

    // Anything after [DONE] is not part of the reply.
    await waitFor(() => expect(answers()[0]).toHaveTextContent("Done."));
    expect(answers()[0]).not.toHaveTextContent("And more.");
  });

  it("drops the rest of the reply after one malformed frame", async () => {
    reply = { chunks: [frame("The verb "), "data: {not json\n", frame("is hollow."), "data: [DONE]\n"] };
    render();
    await openDialog();

    await ask("why?");

    // Pinned: a frame that will not parse is pushed back onto the buffer and
    // retried forever, so the loop never advances past it. Every token after it
    // is discarded and the answer simply stops mid-sentence, with no error and
    // no spinner — it reads as a complete reply that happens to be truncated.
    await waitFor(() => expect(answers()[0]).toHaveTextContent("The verb"));
    expect(answers()[0]).not.toHaveTextContent("is hollow");
  });

  it("leaves a spinner behind when the reply turns out to be empty", async () => {
    reply = { chunks: ["data: [DONE]\n"] };
    render();
    await openDialog();

    await ask("why?");

    // Pinned: the assistant bubble is appended before the first token and shows
    // a spinner while its content is empty. A reply that produces no tokens
    // leaves that spinner in the transcript permanently — the dialog looks like
    // it is still thinking long after it has stopped.
    await waitFor(() => expect(box()).toBeEnabled());
    expect(answers()[0].querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("formatting the answer", () => {
  const answered = async (markdown: string) => {
    reply = { chunks: [frame(markdown), "data: [DONE]\n"] };
    render();
    await openDialog();
    await ask("why?");
    await waitFor(() => expect(answers()[0].textContent).not.toBe(""));
    return answers()[0];
  };

  it("emphasises the parts the tutor stressed", async () => {
    const bubble = await answered("The **verb** is *hollow* — see `كان`.");

    // Grammar explanations lean on emphasis to pick out the form under
    // discussion; flattened to plain text they are much harder to read.
    expect(bubble.querySelector("strong")!.textContent).toBe("verb");
    expect(bubble.querySelector("em")!.textContent).toBe("hollow");
    expect(bubble.querySelector("code")!.textContent).toBe("كان");
  });

  it("lays alternatives out as a list", async () => {
    const bubble = await answered("Alternatives:\n- شلونك\n* كيفك\n");

    // Both bullet characters, because the model uses them interchangeably.
    const items = bubble.querySelectorAll("li");
    expect(Array.from(items).map((li) => li.textContent)).toEqual(["شلونك", "كيفك"]);
  });

  it("keeps paragraphs apart and line breaks inside them", async () => {
    const bubble = await answered("First line\nsame paragraph\n\nSecond paragraph");

    expect(bubble.querySelectorAll("p")).toHaveLength(2);
    expect(bubble.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders a list that follows a paragraph", async () => {
    const bubble = await answered("Because:\n- it is idiomatic\n\nThat is all.");

    expect(bubble.querySelectorAll("p")).toHaveLength(2);
    expect(bubble.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("when the tutor cannot answer", () => {
  it("says to wait when the learner is going too fast", async () => {
    reply = { status: 429 };
    render();
    await openDialog();

    await ask("why?");

    // A rate limit is a "try again in a moment", not a failure — and saying so
    // is the difference between waiting and giving up on the feature.
    expect(toasts.error).toHaveBeenCalledWith("Too many requests — wait a moment");
  });

  it("names the real problem when the credits have run out", async () => {
    reply = { status: 402 };
    render();
    await openDialog();

    await ask("why?");

    expect(toasts.error).toHaveBeenCalledWith("AI credits exhausted");
  });

  it("falls back to a plain failure for anything else", async () => {
    reply = { status: 500 };
    render();
    await openDialog();

    await ask("why?");

    expect(toasts.error).toHaveBeenCalledWith("Couldn't reach the tutor");
  });

  it("reports a connection that never opened", async () => {
    reply = { throws: true };
    render();
    await openDialog();

    await ask("why?");

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Something went wrong"));
  });

  it("keeps the question so it can be retried", async () => {
    reply = { status: 500 };
    render();
    await openDialog();

    await ask("Why the feminine here?");

    // Losing the typed question along with the answer would make a transient
    // failure cost the learner the effort of writing it again.
    expect(screen.getByText("Why the feminine here?")).toBeInTheDocument();
    expect(answers()).toHaveLength(0);
  });

  it("lets the learner ask again straight away", async () => {
    reply = { status: 500 };
    render();
    await openDialog();
    await ask("why?");

    expect(box()).toBeEnabled();
    fireEvent.change(box(), { target: { value: "again?" } });
    expect(sendButton()).toBeEnabled();
  });
});

describe("while it is thinking", () => {
  it("locks the box and the button until the answer lands", async () => {
    render();
    // A body that never closes, so the component stays mid-stream. `inner` has
    // to be read after render — before it, it is the real fetch rather than the
    // harness backend, and the providers' own queries would escape to the network.
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(CHAT_URL)) return inner(input as RequestInfo, init);
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    });
    await openDialog();

    fireEvent.change(box(), { target: { value: "why?" } });
    await act(async () => {
      fireEvent.click(sendButton());
    });

    // Two questions in flight at once would interleave their tokens into one
    // bubble, because the stream always writes to the last message.
    expect(box()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(sendButton().querySelector(".animate-spin")).not.toBeNull();
  });

  it("frees them again once it is finished", async () => {
    render();
    await openDialog();

    await ask("why?");

    await waitFor(() => expect(box()).toBeEnabled());
    expect(screen.queryByText("Because it is idiomatic.")).not.toBeNull();
  });
});
