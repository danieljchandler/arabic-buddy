import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bookmark, Flag, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useSaveConversation } from "@/hooks/useSavedConversations";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { buildPagePayload } from "@/lib/pageAiContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, SseChatError } from "@/lib/sseChat";
import { showCapToast } from "@/lib/handleCapResponse";
import { TinyMarkdown } from "@/components/shared/TinyMarkdown";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { SavePhraseDialog } from "./SavePhraseDialog";
import { cn } from "@/lib/utils";
import { ThinkingBubble } from "@/components/assistant/ThinkingBubble";
import { toast } from "sonner";

/** First run of Arabic script in a reply — the pre-fill for "save phrase". */
function firstArabicRun(text: string): string | null {
  const match = text.match(/[؀-ۿ][؀-ۿ\s،؟ـ]*/);
  const run = match?.[0]?.trim();
  return run && run.length > 1 ? run : null;
}

const SUGGESTED_SEEDED = [
  "Why is it translated like this?",
  "Explain the grammar",
  "Tell me more",
  "Give me alternatives",
];

const SUGGESTED_PAGE = [
  "What am I looking at?",
  "Explain this in simple terms",
  "Quiz me on this",
  "What should I learn next?",
];

interface ChatTabProps {
  /** Fired when the composer takes focus, so a peeking sheet can expand first. */
  onComposerFocus?: () => void;
}

export function ChatTab({ onComposerFocus }: ChatTabProps = {}) {
  const { seed, messages, setMessages, pageContext, conversationId, setConversationId } =
    useAiAssistant();
  const { activeDialect } = useDialect();
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  // Destructured: react-query hands back a fresh object each render, and `send`
  // lists its dependencies.
  const { mutateAsync: persistConversation } = useSaveConversation();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phraseToSave, setPhraseToSave] = useState<string | null>(null);
  // Message indexes already reported this session — one flag per reply.
  const [reported, setReported] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Whether the transcript is parked at the bottom. A reply streams in a token
  // at a time, and each one used to snap the view back down — so scrolling up
  // to re-read the start of a long answer was undone before you got a line in.
  const pinnedRef = useRef(true);
  // The history row this conversation is being written to, and which
  // conversation that is.
  //
  // A ref as well as context state because two turns can finish close
  // together: the second has to *update* the row the first created, and
  // `conversationId` only arrives back through a render. The writes are
  // serialised for the same reason — the second turn's write has to see the
  // first one's row id, which means waiting for it.
  //
  // The epoch is what stops that from going wrong in the other direction. A
  // write still in flight when the panel switches conversations (New chat,
  // walking away from the page, opening one from History) must not hand its
  // row id to whatever is in the panel now — that would overwrite one
  // conversation with the next one's messages.
  const historyRef = useRef<{ epoch: number; id: string | null }>({ epoch: 0, id: conversationId });
  const historyQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const switchHistoryRow = useCallback((id: string | null) => {
    historyRef.current = { epoch: historyRef.current.epoch + 1, id };
  }, []);

  // A learner's flag goes to the native-review queue, not straight into
  // training data — natives decide what was actually wrong.
  const reportMessage = useCallback(async (index: number, content: string) => {
    setReported((prev) => new Set(prev).add(index));
    const { error } = await supabase.functions.invoke("report-content", {
      body: { kind: "assistant_message", dialect: activeDialect, text: content },
    });
    if (error) {
      setReported((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      toast.error("Couldn't send the report — try again in a moment.");
      return;
    }
    toast.success("Thanks — a native speaker will take a look.");
  }, [activeDialect]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A generous threshold: fractional scroll heights and a partly-written last
    // line both mean "at the bottom" is rarely exactly zero.
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // A new question is the learner's own doing, so follow it down regardless of
  // where they had scrolled to while reading the last answer.
  const stickToBottom = useCallback(() => {
    pinnedRef.current = true;
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // "New chat" (and anything else that empties the conversation — including
  // navigating away from the page it was about) must also stop an in-flight
  // stream: without this the orphaned stream kept billing tokens, held
  // `loading` true so the composer stayed locked, and its deltas wrote into
  // whatever conversation came next. The history row goes with it, so the
  // next conversation starts its own rather than overwriting the last one.
  useEffect(() => {
    if (messages.length === 0) {
      abortRef.current?.abort();
      switchHistoryRow(null);
    }
  }, [messages.length, switchHistoryRow]);

  // Opening a conversation from History adopts its row. Guarded on the id
  // actually differing, so this doesn't fire on the panel learning the id of a
  // row we just wrote ourselves.
  useEffect(() => {
    if (conversationId && conversationId !== historyRef.current.id) {
      switchHistoryRow(conversationId);
    }
  }, [conversationId, switchHistoryRow]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      stickToBottom();
      const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // The reply as it stands, kept out here so the turn can be written to the
      // history the moment it finishes. Reading it back off `messages` would
      // mean waiting for a re-render, and by then the learner may have
      // navigated — which now ends the conversation.
      let reply = "";
      // Only a stream that ran to the end is a turn. An aborted one (New chat,
      // switching to voice, the panel closing) leaves a half-written answer
      // that nobody asked to keep.
      let completed = false;

      try {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        await streamChat({
          functionName: "assistant-chat",
          signal: ctrl.signal,
          body: {
            dialect: activeDialect,
            messages: nextMessages,
            seed: seed ?? undefined,
            pageContext: buildPagePayload(pathname, pageContext),
          },
          onDelta: (_delta, accumulated) => {
            reply = accumulated;
            setMessages((prev) => {
              // The conversation may have been cleared (New chat) while this
              // stream was still in flight — writing to the last index of an
              // empty or re-targeted array corrupts the next conversation.
              if (!prev.length || prev[prev.length - 1].role !== "assistant") return prev;
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: accumulated };
              return copy;
            });
          },
        });
        completed = true;
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          if (err instanceof SseChatError) {
            if (err.status === 429) {
              // Only the daily-cap body gets the upgrade toast; an upstream
              // provider rate limit (a plain `error` string) is transient and
              // telling the learner they hit their daily free limit is wrong.
              const capBody = err.body as { message?: string; limit?: number; error?: string } | null;
              if (capBody?.message || capBody?.limit) {
                showCapToast(capBody);
              } else {
                toast.error(capBody?.error ?? "The assistant is busy — try again in a moment.");
              }
            } else if (err.status === 402) {
              toast.error("AI credits exhausted");
            } else if (err.status === 401) {
              toast.error("Please sign in to chat");
            } else {
              toast.error("Couldn't reach the assistant");
            }
          } else {
            console.error(err);
            toast.error("Something went wrong");
          }
        }
      } finally {
        // Drop an empty assistant placeholder in EVERY exit path — error,
        // abort (closing the panel or switching to Voice mid-stream), or a
        // stream that resolved with zero tokens. Left in place, the empty
        // message rendered as a permanently spinning ThinkingBubble and was
        // re-sent on every later turn, which Anthropic rejects — 400ing the
        // whole conversation until "New chat".
        setMessages((prev) =>
          prev.length && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev,
        );
        setLoading(false);
      }

      // Write the finished turn to the history. Every conversation is kept,
      // not just the ones somebody thought to press Save on — which is what
      // lets a conversation end when the learner walks away from the page
      // without anything being lost, and what makes History worth opening.
      //
      // Per completed turn rather than on a timer: a debounce loses the last
      // answer to exactly the navigation that ends the conversation. Failures
      // are swallowed — a history that could not be written is not a reason to
      // interrupt someone mid-question.
      if (user && completed && reply.trim()) {
        const turns = [...nextMessages, { role: "assistant" as const, content: reply }];
        const pageTitle = buildPagePayload(pathname, pageContext).title;
        const { epoch, id: idAtSend } = historyRef.current;
        historyQueueRef.current = historyQueueRef.current
          .then(async () => {
            // Still the same conversation? Then the row id may have been
            // filled in by the write queued ahead of this one. If not, this
            // turn belongs to a conversation the panel has already left, and
            // the id it had when the question was asked is the right one.
            const current = historyRef.current.epoch === epoch;
            const row = await persistConversation({
              id: current ? historyRef.current.id : idAtSend,
              dialect: activeDialect,
              seed,
              pageContext: { route: pathname, title: pageTitle },
              messages: turns,
            });
            if (historyRef.current.epoch !== epoch) return;
            historyRef.current = { epoch, id: row.id };
            setConversationId(row.id);
          })
          .catch((err) => console.warn("Couldn't write the conversation to history", err));
      }
    },
    [
      messages,
      setMessages,
      loading,
      activeDialect,
      seed,
      pathname,
      pageContext,
      stickToBottom,
      user,
      setConversationId,
      persistConversation,
    ],
  );

  if (!user && !authLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to ask the AI tutor about anything you see in the app.
        </p>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  const suggestions = seed ? SUGGESTED_SEEDED : SUGGESTED_PAGE;

  return (
    <>
      {/* min-h-0 so this can actually shrink inside the sheet's bounded column.
          Full screen buys room, so spend some of it on the reply itself — the
          panel tags itself with data-snap for exactly this. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3",
          "group-data-[snap=cover]/panel:space-y-4 group-data-[snap=cover]/panel:px-5 group-data-[snap=cover]/panel:py-4",
        )}
      >
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {seed
                ? "Ask anything — translation choices, grammar, vocabulary, culture…"
                : "Ask about what's on this page, or anything about Arabic."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const savable = m.role === "assistant" && !loading ? firstArabicRun(m.content) : null;
          return (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                "group-data-[snap=cover]/panel:px-4 group-data-[snap=cover]/panel:py-3",
                "group-data-[snap=cover]/panel:text-[15px] group-data-[snap=cover]/panel:leading-relaxed",
                m.role === "user"
                  ? "bg-primary/10 ml-6"
                  : "bg-muted/50 mr-6 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
              )}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <>
                    <TinyMarkdown
                      source={m.content}
                      renderArabicRun={(text) => (
                        <TappableArabicText
                          text={text}
                          source="ask-ai"
                          inline
                          sentenceContext={seed ? { arabic: seed.arabic, english: seed.english } : undefined}
                        />
                      )}
                    />
                    {!loading && (
                      <div className="mt-1.5 flex items-center gap-3">
                        {savable && (
                          <button
                            type="button"
                            onClick={() => setPhraseToSave(savable)}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                          >
                            <Bookmark className="h-3 w-3" />
                            Save phrase
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={reported.has(i)}
                          onClick={() => reportMessage(i, m.content)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60 disabled:hover:text-muted-foreground"
                        >
                          <Flag className="h-3 w-3" />
                          {reported.has(i) ? "Reported" : "Report"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <ThinkingBubble />
                )
              ) : (
                // dir="auto": learners routinely type Arabic here, and an LTR
                // bubble scrambles its punctuation to the wrong ends — the
                // conversation simulator's input has always done this.
                <p dir="auto">{m.content}</p>
              )}
            </div>
          );
        })}
      </div>

      <SavePhraseDialog
        open={phraseToSave !== null}
        onOpenChange={(open) => !open && setPhraseToSave(null)}
        initialArabic={phraseToSave ?? ""}
      />

      <div className="flex shrink-0 gap-2 border-t p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={onComposerFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask a question…"
          rows={1}
          className="resize-none min-h-[40px] text-sm"
          disabled={loading}
          dir="auto"
        />
        <Button
          size="icon"
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
