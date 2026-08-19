import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Bookmark,
  BookmarkCheck,
  History,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiAssistant, type AssistantTab } from "@/contexts/AiAssistantContext";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useSaveConversation } from "@/hooks/useSavedConversations";
import { buildPagePayload } from "@/lib/pageAiContext";
import { cn } from "@/lib/utils";
import { SaduBubble } from "@/components/brand/SaduBubble";
import { AskAiContextCard } from "./AskAiContextCard";
import { ChatTab } from "./ChatTab";
import { VoiceTab } from "./VoiceTab";

/**
 * The global Ask AI panel. Mounted once (in App.tsx); opened by the FAB, the
 * Ask AI chips, or Cmd/Ctrl+K. Chat and Voice share the same seed and page
 * context, so "ask about this sentence" works in either mode.
 *
 * Deliberately non-modal: the learner has to keep seeing (and using) the thing
 * they're asking about. On mobile it's a bottom sheet that peeks at 56dvh so
 * the video or passage stays visible above it, expandable to 92dvh for long
 * answers; on desktop it's a right rail with no scrim over the page. The
 * mobile/desktop split is pure CSS — branching on a JS breakpoint would remount
 * the subtree on rotation and drop a live voice call.
 *
 * Staying out of the way stops being a kindness once there's a conversation to
 * read: a long answer, or a voice transcript, in a 56dvh sheet is a paragraph
 * seen through a letterbox. So the panel grows with the conversation — it
 * promotes itself to the taller snap as soon as there are messages, and the
 * header carries a full-screen control that hands the whole viewport over to
 * the transcript (a centred reading column on desktop, where the rail is only
 * max-w-md wide). Reading mode is one tap away and one tap back.
 */

/**
 * How much of the screen the panel takes. `peek` and `full` are the mobile
 * sheet heights; `cover` is reading mode and applies on every breakpoint.
 */
type Snap = "peek" | "full" | "cover";

export function AskAiPanel() {
  const {
    isOpen,
    close,
    activeTab,
    setActiveTab,
    seed,
    clearSeed,
    newChat,
    messages,
    pageContext,
    conversationId,
    setConversationId,
  } = useAiAssistant();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const saveConversation = useSaveConversation();

  const pagePayload = useMemo(
    () => buildPagePayload(pathname, pageContext),
    [pathname, pageContext],
  );

  // Local, not context: AssistantMount keeps this component mounted for the
  // rest of the session, so the choice already survives close/reopen.
  const [snap, setSnap] = useState<Snap>("peek");
  const isCover = snap === "cover";
  // Only ever grows the panel — a learner who went to full screen has said
  // plainly what size they want, and nothing here should walk that back.
  const promoteToFull = useCallback(
    () => setSnap((s) => (s === "peek" ? "full" : s)),
    [],
  );
  const toggleCover = useCallback(
    () => setSnap((s) => (s === "cover" ? "full" : "cover")),
    [],
  );
  const kbInset = useKeyboardInset(isOpen);

  // A live call needs the transcript and the call controls; peek can't hold both.
  useEffect(() => {
    if (isOpen && activeTab === "voice") promoteToFull();
  }, [isOpen, activeTab, promoteToFull]);

  // Once there's a conversation, the conversation is the point. Peek is sized
  // to keep the page visible, which leaves roughly four lines for the reply —
  // and tapping a suggested prompt never touches the composer, so waiting for
  // composer focus to expand missed the most common way in.
  useEffect(() => {
    if (isOpen && messages.length > 0) promoteToFull();
  }, [isOpen, messages.length, promoteToFull]);

  // Swipe the handle to resize, in addition to tapping it. Bound to the handle
  // only — on the body it would fight the transcript's own scrolling.
  const dragStartY = useRef<number | null>(null);
  const draggedRef = useRef(false);

  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    draggedRef.current = false;
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    const start = dragStartY.current;
    dragStartY.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    if (Math.abs(dy) <= 40) return; // a tap — let onClick toggle instead
    // Mark it so the click that follows this drag doesn't toggle it straight back.
    draggedRef.current = true;
    // One drag moves one step up or down the ladder, so a flick up from peek
    // can't skip past the height that still shows the page.
    if (dy < 0) setSnap((s) => (s === "peek" ? "full" : "cover"));
    else if (dy > 120 && snap === "peek") close();
    else setSnap((s) => (s === "cover" ? "full" : "peek"));
  };

  const onHandleClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    // Tapping the handle is the "give me a bit more / a bit less" gesture, so
    // full is the middle it returns to from either end.
    setSnap((s) => (s === "full" ? "peek" : "full"));
  };

  const canSave = !!user && messages.some((m) => m.role === "assistant" && m.content);

  const handleSave = () => {
    saveConversation.mutate(
      {
        id: conversationId,
        dialect: activeDialect,
        seed,
        pageContext: { route: pagePayload.route, title: pagePayload.title },
        messages,
      },
      {
        onSuccess: (row) => {
          setConversationId(row.id);
          toast.success(conversationId ? "Conversation updated" : "Conversation saved", {
            description: "Find it any time under Saved chats.",
          });
        },
        onError: () => toast.error("Couldn't save the conversation"),
      },
    );
  };

  return (
    <Sheet modal={false} open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="none"
        showClose={false}
        hideOverlay
        data-feedback-ignore="true"
        // A non-modal Radix dialog still dismisses on an outside pointer down.
        // Left alone, tapping the video to pause it would close the panel —
        // exactly the interaction this layout exists to allow.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        // Don't pull focus into the composer on a phone: the keyboard would
        // open immediately and swallow the peek. Read matchMedia directly —
        // useIsMobile reports false on its first render.
        onOpenAutoFocus={(e) => {
          if (window.matchMedia?.("(max-width: 639px)").matches) e.preventDefault();
        }}
        // Escape steps out of reading mode before it closes the panel — losing
        // a conversation you were mid-way through reading is the harsher of the
        // two readings of that key.
        onEscapeKeyDown={(e) => {
          if (isCover) {
            e.preventDefault();
            setSnap("full");
          }
        }}
        data-snap={snap}
        style={{
          ...(kbInset
            ? { bottom: kbInset, maxHeight: `calc(100dvh - ${kbInset}px - 0.5rem)` }
            : null),
          // Reading mode is the only snap that reaches the top of the screen,
          // so it's the only one that has to duck the notch. AppShell's own
          // safe-area padding doesn't reach here — the sheet is portalled.
          ...(isCover
            ? {
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }
            : null),
        }}
        className={cn(
          // Named so descendants can size their own type off the snap without
          // prop drilling — a prop would be fine, but ChatTab and VoiceTab both
          // need it and neither may remount when it changes.
          "group/panel flex flex-col gap-0 p-0 focus:outline-none",
          "bg-background supports-[backdrop-filter]:bg-background/95 supports-[backdrop-filter]:backdrop-blur-xl",
          // max-width too, so the desktop rail widens into reading mode rather
          // than snapping to it.
          "transition-[height,max-width] duration-300 ease-lahja motion-reduce:transition-none",
          "data-[state=open]:duration-300 data-[state=closed]:duration-300",
          // Mobile: a bottom sheet that leaves the page visible above it.
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-full",
          "max-sm:shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)]",
          "max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
          // Desktop: a right rail, no scrim over the page.
          "sm:inset-y-0 sm:right-0 sm:h-full sm:w-full",
          "sm:rounded-none sm:shadow-elegant",
          "sm:data-[state=open]:slide-in-from-right sm:data-[state=closed]:slide-out-to-right",
          // The geometry that reading mode overrides is branched rather than
          // layered: Tailwind resolves same-property utilities by its own
          // ordering, not by the order they appear in this list, so an
          // override that sits next to what it overrides is a coin toss.
          // Static literals throughout, so the scanner emits every height.
          isCover
            ? // Reading mode: the whole viewport on a phone (bottom-0 plus a
              // full-height box, so `top` stays out of the fight), and a
              // centred column on desktop — a 1440px-wide line of chat is no
              // more readable than a 380px-tall one.
              "max-sm:h-[100dvh] max-sm:rounded-none sm:left-0 sm:max-w-none"
            : cn(
                "max-sm:rounded-t-2xl max-sm:border-t sm:left-auto sm:max-w-md sm:border-l",
                snap === "full" ? "max-sm:h-[92dvh]" : "max-sm:h-[56dvh]",
              ),
        )}
      >
        {/*
          The reading column. Always rendered, so switching modes only changes
          a className — see the remount warning on the tab body below, which
          applies to every ancestor of it too.
        */}
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col",
            isCover && "mx-auto max-w-3xl",
          )}
        >
          <div className="flex shrink-0 items-center gap-1 px-2 pt-1 sm:pt-2">
            <button
              type="button"
              aria-expanded={snap !== "peek"}
              aria-controls="ask-ai-body"
              aria-label={snap === "peek" ? "Expand panel" : "Collapse panel"}
              onClick={onHandleClick}
              onPointerDown={onHandlePointerDown}
              onPointerUp={onHandlePointerUp}
              className="group flex flex-1 touch-none items-center justify-center py-2.5 sm:hidden"
            >
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30 transition-colors group-active:bg-muted-foreground/60" />
            </button>
            {/* The way out of a letterboxed transcript, on every breakpoint: the
                handle is mobile-only, and on desktop the rail is the narrow
                dimension rather than the height. */}
            <button
              type="button"
              aria-label={isCover ? "Exit full screen" : "Read full screen"}
              aria-pressed={isCover}
              onClick={toggleCover}
              title={isCover ? "Exit full screen" : "Read full screen"}
              className="ml-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {isCover ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              aria-label="Close Ask AI"
              onClick={close}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <SheetHeader className="shrink-0 space-y-2 border-b px-4 pb-3 pt-0 text-left">
            {/* Title and its actions share a row — the context card below is the
                part worth the vertical space at the peek height. */}
            <div className="flex items-center gap-1.5">
              <SheetTitle className="mr-auto flex items-center gap-2 text-base">
                <SaduBubble tone="terracotta" className="h-4 w-auto" />
                Ask AI
              </SheetTitle>
              {messages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={newChat}
                >
                  <Plus className="h-3 w-3" />
                  New chat
                </Button>
              )}
              {canSave && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={handleSave}
                  disabled={saveConversation.isPending}
                >
                  {saveConversation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : conversationId ? (
                    <BookmarkCheck className="h-3 w-3" />
                  ) : (
                    <Bookmark className="h-3 w-3" />
                  )}
                  {conversationId ? "Saved" : "Save"}
                </Button>
              )}
              {user && (
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                >
                  <Link to="/saved-chats" onClick={close} aria-label="Saved chats">
                    <History className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>

            <SheetDescription className="sr-only">
              Chat with the AI tutor about anything you see in the app — by text or live voice.
            </SheetDescription>

            <AskAiContextCard
              seed={seed}
              payload={pagePayload}
              pageKind={pageContext?.kind}
              onClearSeed={clearSeed}
            />

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AssistantTab)}>
              <TabsList className="grid h-8 w-full grid-cols-2">
                <TabsTrigger value="chat" className="h-6 gap-1 text-xs">
                  <MessageSquare className="h-3 w-3" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="voice" className="h-6 gap-1 text-xs">
                  <Mic className="h-3 w-3" />
                  Live voice
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </SheetHeader>

          {/*
            This wrapper must stay unconditional. Swapping the element structure
            around the tab body remounts it, and remounting VoiceTab runs its
            cleanup — which hangs up a live call.
          */}
          <div id="ask-ai-body" className="flex min-h-0 flex-1 flex-col">
            {activeTab === "chat" ? <ChatTab onComposerFocus={promoteToFull} /> : <VoiceTab />}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
