import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { PageAiContext } from "@/lib/pageAiContext";

/**
 * Global state for the Ask AI assistant: one conversation at a time, and
 * whatever the current page has published about itself.
 *
 * Both are scoped to the route, which is the correction this file carries.
 * They used to outlive it, in two different ways and with the same symptom —
 * a tutor answering about a page the learner had already left:
 *
 *  - **The conversation** survived every navigation, so a chat started on a
 *    video was still sitting there, seed sentence and all, when the panel was
 *    opened on the review deck. Closing it by hand was the only way out. It
 *    now ends when the learner walks away from the page it was about: a
 *    pathname change with the panel *closed* clears the seed and the
 *    transcript. Nothing is lost — every completed turn is written to the
 *    history (`saved_chat_conversations`) as it happens, so the conversation
 *    is one tap away under History. A panel that is *open* across a
 *    navigation is being used, so it is left alone.
 *  - **The page context** was last-writer-wins with no notion of which page
 *    wrote it, so a page that unmounted late (a route transition renders both
 *    for a frame) could clear the newcomer's context, and a page that never
 *    published one inherited its predecessor's. Registrations now carry the
 *    route they were made on and only the current route's newest one is
 *    published, so a stale one can neither win nor linger.
 *
 * Pages publish what they're showing via usePageAiContext; anything (the Ask
 * AI chips, the disc, Cmd/Ctrl+K) opens the panel via useAiAssistant.
 */

export interface AssistantSeed {
  arabic: string;
  english?: string;
}

export interface AssistantMsg {
  role: "user" | "assistant";
  content: string;
}

export type AssistantTab = "chat" | "voice";

interface AiAssistantValue {
  isOpen: boolean;
  activeTab: AssistantTab;
  setActiveTab: (tab: AssistantTab) => void;
  seed: AssistantSeed | null;
  clearSeed: () => void;
  messages: AssistantMsg[];
  setMessages: React.Dispatch<React.SetStateAction<AssistantMsg[]>>;
  /** Set when the current conversation has been saved (row id). */
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pageContext: PageAiContext | null;
  openChat: (seed?: AssistantSeed) => void;
  openVoice: () => void;
  close: () => void;
  newChat: () => void;
  loadConversation: (args: {
    id: string;
    seed: AssistantSeed | null;
    messages: AssistantMsg[];
  }) => void;
}

const AiAssistantContext = createContext<AiAssistantValue | null>(null);

// Internal registration channel for usePageAiContext, separated so pages that
// only publish context don't re-render when the conversation streams.
interface PageRegistryValue {
  register: (id: number, ctx: PageAiContext) => void;
  unregister: (id: number) => void;
}

/** A published context, tagged with the route that published it. */
interface Registration {
  route: string;
  ctx: PageAiContext;
}

const PageRegistryContext = createContext<PageRegistryValue | null>(null);

let nextRegistrationId = 1;

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AssistantTab>("chat");
  const [seed, setSeed] = useState<AssistantSeed | null>(null);
  const [messages, setMessages] = useState<AssistantMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageAiContext | null>(null);
  // Keyed by registration id, which is handed out in mount order and never
  // reused — so "the newest registration for this route" is the highest id,
  // and a page that re-registers late (its data landed after the next page had
  // already mounted) cannot jump the queue by re-inserting itself. Map
  // insertion order would have let it: a ctx change unregisters and registers
  // again, which moves the entry to the back.
  const registryRef = useRef<Map<number, Registration>>(new Map());
  // Written during render rather than in an effect: the provider re-renders
  // with the new pathname before the new page's effects run, so a registration
  // made on arrival is tagged with the route it actually happened on.
  const routeRef = useRef(pathname);
  routeRef.current = pathname;

  const publishCurrentRoute = useCallback(() => {
    let bestId = -1;
    let latest: PageAiContext | null = null;
    for (const [id, entry] of registryRef.current) {
      if (entry.route === routeRef.current && id > bestId) {
        bestId = id;
        latest = entry.ctx;
      }
    }
    setPageContext(latest);
  }, []);

  const register = useCallback(
    (id: number, ctx: PageAiContext) => {
      registryRef.current.set(id, { route: routeRef.current, ctx });
      publishCurrentRoute();
    },
    [publishCurrentRoute],
  );

  const unregister = useCallback(
    (id: number) => {
      registryRef.current.delete(id);
      publishCurrentRoute();
    },
    [publishCurrentRoute],
  );

  // Navigation drops the last page's context immediately, without waiting for
  // it to unmount: a route transition keeps the outgoing page mounted for a
  // frame or two, and for those frames the assistant would still be describing
  // the page the learner just left.
  useEffect(() => {
    publishCurrentRoute();
  }, [pathname, publishCurrentRoute]);

  const openChat = useCallback((newSeed?: AssistantSeed) => {
    if (newSeed) {
      setSeed((prev) => {
        // A different sentence starts a fresh conversation about it; the same
        // sentence resumes what's there.
        if (prev?.arabic !== newSeed.arabic) {
          setMessages([]);
          setConversationId(null);
        }
        return newSeed;
      });
    }
    setActiveTab("chat");
    setIsOpen(true);
  }, []);

  const openVoice = useCallback(() => {
    setActiveTab("voice");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const newChat = useCallback(() => {
    setMessages([]);
    setSeed(null);
    setConversationId(null);
  }, []);

  const clearSeed = useCallback(() => setSeed(null), []);

  // A conversation belongs to the page it was started on. Walking away from
  // that page with the panel closed ends it — otherwise the next tap on the
  // disc, three screens later, opens someone else's question about a sentence
  // that is no longer on screen, and the learner has to clear it by hand
  // before they can ask their own.
  //
  // An *open* panel is a conversation in use: the learner may well be
  // navigating because the tutor told them to. That one is left alone until
  // they close it and move on.
  const previousPathRef = useRef(pathname);
  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    if (isOpen) return;
    setSeed(null);
    setMessages([]);
    setConversationId(null);
  }, [pathname, isOpen]);

  const loadConversation = useCallback(
    (args: { id: string; seed: AssistantSeed | null; messages: AssistantMsg[] }) => {
      setSeed(args.seed);
      setMessages(args.messages);
      setConversationId(args.id);
      setActiveTab("chat");
      setIsOpen(true);
    },
    [],
  );

  const value = useMemo<AiAssistantValue>(
    () => ({
      isOpen,
      activeTab,
      setActiveTab,
      seed,
      clearSeed,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      pageContext,
      openChat,
      openVoice,
      close,
      newChat,
      loadConversation,
    }),
    [
      isOpen,
      activeTab,
      seed,
      clearSeed,
      messages,
      conversationId,
      pageContext,
      openChat,
      openVoice,
      close,
      newChat,
      loadConversation,
    ],
  );

  const registry = useMemo<PageRegistryValue>(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <PageRegistryContext.Provider value={registry}>
      <AiAssistantContext.Provider value={value}>{children}</AiAssistantContext.Provider>
    </PageRegistryContext.Provider>
  );
}

export function useAiAssistant(): AiAssistantValue {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) {
    throw new Error("useAiAssistant must be used within <AiAssistantProvider>");
  }
  return ctx;
}

/**
 * Publish what this page is showing to the AI assistant. Pass `null` to
 * publish nothing (the route-based fallback applies). Re-registers whenever
 * the context object identity changes — memoize the argument in the page.
 *
 * The registration is scoped to the route it is made on, so it stops being
 * published the moment the learner navigates, whether or not this component
 * has unmounted yet.
 */
export function usePageAiContext(ctx: PageAiContext | null) {
  const registry = useContext(PageRegistryContext);
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextRegistrationId++;

  useEffect(() => {
    if (!registry || !ctx) return;
    const id = idRef.current;
    registry.register(id, ctx);
    return () => registry.unregister(id);
  }, [registry, ctx]);
}
