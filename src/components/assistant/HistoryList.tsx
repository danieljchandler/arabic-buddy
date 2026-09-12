import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquare, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import {
  useDeleteConversation,
  useSavedConversations,
  type SavedConversation,
} from "@/hooks/useSavedConversations";
import { cn } from "@/lib/utils";

/**
 * The assistant's own history, inside the panel.
 *
 * A conversation now ends when the learner leaves the page it was about, which
 * is only tolerable because nothing is lost when it does: every completed turn
 * is written to `saved_chat_conversations` as it happens, and this is where
 * they come back. Picking one up loads it into the panel exactly as it was —
 * the same list, and the same gesture, as any other chat app.
 *
 * Rendered as an overlay *over* the tab body rather than in place of it. The
 * panel's body element must never be swapped out: remounting VoiceTab runs its
 * cleanup, which hangs up a live call. Covering it costs nothing and cannot do
 * that.
 */

/** "3m ago", "2d ago" — precise enough to find a conversation by. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function HistoryList({ onClose }: { onClose: () => void }) {
  const { data: conversations, isLoading } = useSavedConversations();
  const deleteConversation = useDeleteConversation();
  const { loadConversation, conversationId } = useAiAssistant();

  const rows = useMemo(() => conversations ?? [], [conversations]);

  const open = (row: SavedConversation) => {
    loadConversation({
      id: row.id,
      seed: row.seed,
      messages: Array.isArray(row.messages) ? row.messages : [],
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <h2 className="mr-auto text-sm font-semibold">History</h2>
        {rows.length > 0 && (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
            <Link to="/saved-chats" onClick={onClose}>
              Manage
            </Link>
          </Button>
        )}
        <button
          type="button"
          aria-label="Close history"
          onClick={onClose}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Everything you ask the tutor is kept here, so you can pick a conversation back up
              later.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => open(row)}
                  className={cn(
                    "min-w-0 flex-1 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted",
                    // The conversation currently in the panel, so re-opening it
                    // doesn't look like it did nothing.
                    row.id === conversationId && "bg-muted/60",
                  )}
                >
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {relativeTime(row.updated_at ?? row.created_at)}
                    {row.page_context?.title ? ` · ${row.page_context.title}` : ""}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${row.title}`}
                  disabled={deleteConversation.isPending}
                  onClick={() =>
                    deleteConversation.mutate(row.id, {
                      onError: () => toast.error("Couldn't delete the conversation"),
                    })
                  }
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
