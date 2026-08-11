import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bookmark, BookmarkCheck, History, Loader2, MessageSquare, Mic, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiAssistant, type AssistantTab } from "@/contexts/AiAssistantContext";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useSaveConversation } from "@/hooks/useSavedConversations";
import { buildPagePayload } from "@/lib/pageAiContext";
import { ChatTab } from "./ChatTab";
import { VoiceTab } from "./VoiceTab";

/**
 * The global Ask AI panel. Mounted once (in App.tsx); opened by the FAB, the
 * Ask AI chips, or Cmd/Ctrl+K. Chat and Voice share the same seed and page
 * context, so "ask about this sentence" works in either mode.
 */
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

  const aboutLabel = seed
    ? seed.arabic.length > 40
      ? `${seed.arabic.slice(0, 40)}…`
      : seed.arabic
    : pagePayload.title;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        data-feedback-ignore="true"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-2 border-b px-4 pt-4 pb-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Ask AI
          </SheetTitle>
          <SheetDescription className="sr-only">
            Chat with the AI tutor about anything you see in the app — by text or live voice.
          </SheetDescription>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              title={seed ? seed.arabic : pagePayload.title}
            >
              <span className="shrink-0">About:</span>
              <span className={seed ? "font-arabic" : undefined} dir={seed ? "rtl" : undefined}>
                {aboutLabel}
              </span>
              {seed && (
                <button
                  type="button"
                  aria-label="Clear sentence context"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-background"
                  onClick={clearSeed}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
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

          {seed && (
            <div className="rounded-lg bg-muted/40 p-2 text-right">
              <p className="font-arabic text-sm text-foreground" dir="rtl">
                {seed.arabic}
              </p>
              {seed.english && (
                <p className="mt-1 text-left text-xs text-muted-foreground">{seed.english}</p>
              )}
            </div>
          )}

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

        {activeTab === "chat" ? <ChatTab /> : <VoiceTab />}
      </SheetContent>
    </Sheet>
  );
}
