import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  AiAssistantProvider,
  useAiAssistant,
  usePageAiContext,
} from "./AiAssistantContext";
import type { PageAiContext } from "@/lib/pageAiContext";

/**
 * The provider is the meeting point of three parties: chips that open the
 * panel with a sentence, pages that publish what they're showing, and the
 * panel that reads both. The subtle contract is seed identity — opening a
 * chat about a *different* sentence starts fresh, the *same* sentence (or no
 * seed) resumes. Get that wrong and either conversations leak across
 * sentences or every chip tap wipes the user's chat.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/discover/abc"]}>
    <AiAssistantProvider>{children}</AiAssistantProvider>
  </MemoryRouter>
);

describe("useAiAssistant", () => {
  it("throws a clear error outside the provider", () => {
    expect(() =>
      renderHook(() => useAiAssistant(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <MemoryRouter>{children}</MemoryRouter>
        ),
      }),
    ).toThrow(/AiAssistantProvider/);
  });

  it("opens chat with a seed and keeps the conversation for the same seed", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك", english: "How are you?" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.close());

    // Reopening about the same sentence resumes.
    act(() => result.current.openChat({ arabic: "شلونك", english: "How are you?" }));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isOpen).toBe(true);
  });

  it("resets the conversation when opened about a different sentence", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.setConversationId("saved-1"));

    act(() => result.current.openChat({ arabic: "وش تسوي" }));

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.seed?.arabic).toBe("وش تسوي");
  });

  it("resumes the in-memory conversation when opened without a seed", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.close());

    act(() => result.current.openChat());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.seed?.arabic).toBe("شلونك");
  });

  it("newChat clears seed, messages, and saved id", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.setConversationId("saved-1"));
    act(() => result.current.newChat());

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.seed).toBeNull();
    expect(result.current.conversationId).toBeNull();
  });

  it("loadConversation restores a saved chat and opens the panel", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() =>
      result.current.loadConversation({
        id: "conv-7",
        seed: { arabic: "يالله" },
        messages: [
          { role: "user", content: "what does this mean?" },
          { role: "assistant", content: "It means let's go." },
        ],
      }),
    );

    expect(result.current.isOpen).toBe(true);
    expect(result.current.conversationId).toBe("conv-7");
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.seed?.arabic).toBe("يالله");
  });
});

describe("usePageAiContext", () => {
  it("publishes on mount and clears on unmount", () => {
    const ctx: PageAiContext = { kind: "video", title: "Souq tour" };

    const { result, unmount } = renderHook(
      () => {
        usePageAiContext(ctx);
        return useAiAssistant();
      },
      { wrapper },
    );

    expect(result.current.pageContext?.title).toBe("Souq tour");
    unmount();
  });

  it("lets a successor page take over even when the old page unmounts late", () => {
    const first: PageAiContext = { kind: "story", title: "First" };
    const second: PageAiContext = { kind: "story", title: "Second" };

    const useBoth = ({ a, b }: { a: PageAiContext | null; b: PageAiContext | null }) => {
      usePageAiContext(a);
      usePageAiContext(b);
      return useAiAssistant();
    };

    const { result, rerender } = renderHook(useBoth, {
      wrapper,
      initialProps: { a: first, b: null as PageAiContext | null },
    });
    expect(result.current.pageContext?.title).toBe("First");

    // The new page registers, then the old page unregisters (unmount order
    // during a route transition). The successor's context must survive.
    rerender({ a: first, b: second });
    expect(result.current.pageContext?.title).toBe("Second");

    rerender({ a: null, b: second });
    expect(result.current.pageContext?.title).toBe("Second");
  });
});

/**
 * Everything the assistant holds is scoped to the page it came from. Before
 * this, both halves outlived the page: opening the panel two screens later
 * showed the last page's sentence with the last page's conversation under it,
 * and a page that published nothing of its own inherited its predecessor's
 * description of itself.
 */
describe("navigating away", () => {
  /** A hook that exposes the assistant plus a way to move to another route. */
  const useAssistantAndNav = (ctx?: PageAiContext) => {
    usePageAiContext(ctx ?? null);
    return { assistant: useAiAssistant(), navigate: useNavigate() };
  };

  it("ends a closed conversation when the route changes", () => {
    const { result } = renderHook(() => useAssistantAndNav(), { wrapper });

    act(() => result.current.assistant.openChat({ arabic: "شلونك" }));
    act(() => result.current.assistant.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.assistant.setConversationId("saved-1"));
    act(() => result.current.assistant.close());

    act(() => result.current.navigate("/review"));

    expect(result.current.assistant.seed).toBeNull();
    expect(result.current.assistant.messages).toHaveLength(0);
    expect(result.current.assistant.conversationId).toBeNull();
  });

  it("keeps a conversation the learner is still in the middle of", () => {
    const { result } = renderHook(() => useAssistantAndNav(), { wrapper });

    act(() => result.current.assistant.openChat({ arabic: "شلونك" }));
    act(() => result.current.assistant.setMessages([{ role: "user", content: "hi" }]));

    // Panel still open — following the tutor's advice to another page must not
    // wipe the answer that sent them there.
    act(() => result.current.navigate("/review"));

    expect(result.current.assistant.messages).toHaveLength(1);
    expect(result.current.assistant.seed?.arabic).toBe("شلونك");

    // It ends on the *next* move, once they have closed it.
    act(() => result.current.assistant.close());
    act(() => result.current.navigate("/my-words"));

    expect(result.current.assistant.messages).toHaveLength(0);
  });

  it("stops publishing a page's context once the learner has left it", () => {
    const ctx: PageAiContext = { kind: "video", title: "Souq tour" };
    const { result } = renderHook(() => useAssistantAndNav(ctx), { wrapper });

    expect(result.current.assistant.pageContext?.title).toBe("Souq tour");

    // The page component is still mounted (a route transition holds it for a
    // frame, and this hook never unmounts) — the route alone has to be enough.
    act(() => result.current.navigate("/review"));

    expect(result.current.assistant.pageContext).toBeNull();
  });

  it("does not let a lingering page overwrite the page that replaced it", () => {
    const older: PageAiContext = { kind: "video", title: "Souq tour" };
    const newer: PageAiContext = { kind: "drill", title: "Review" };

    const useTwoPages = ({ old, next }: { old: PageAiContext | null; next: PageAiContext | null }) => {
      usePageAiContext(old);
      usePageAiContext(next);
      return { assistant: useAiAssistant(), navigate: useNavigate() };
    };

    const { result, rerender } = renderHook(useTwoPages, {
      wrapper,
      initialProps: { old: older, next: null as PageAiContext | null },
    });
    expect(result.current.assistant.pageContext?.title).toBe("Souq tour");

    act(() => result.current.navigate("/review"));
    rerender({ old: older, next: newer });

    expect(result.current.assistant.pageContext?.title).toBe("Review");

    // The outgoing page re-publishing on its way out (data landing late) must
    // not put the old title back.
    rerender({ old: { ...older }, next: newer });
    expect(result.current.assistant.pageContext?.title).toBe("Review");
  });

  it("re-publishes when the same page comes back", () => {
    const ctx: PageAiContext = { kind: "video", title: "Souq tour" };
    const useOnePage = () => {
      usePageAiContext(ctx);
      return { assistant: useAiAssistant(), navigate: useNavigate() };
    };

    const { result } = renderHook(useOnePage, { wrapper });

    act(() => result.current.navigate("/review"));
    expect(result.current.assistant.pageContext).toBeNull();

    act(() => result.current.navigate("/discover/abc"));
    expect(result.current.assistant.pageContext?.title).toBe("Souq tour");
  });
});
