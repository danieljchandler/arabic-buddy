import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Archive, MessageSquare } from 'lucide-react';
import type { ChatSession } from '@/hooks/useCurriculumChat';
import { DIALECT_OPTIONS } from './DialectSelector';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onArchiveSession: (id: string) => void;
}

export const ChatSidebar = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onArchiveSession,
}: ChatSidebarProps) => {
  const getDialectFlag = (dialect: string) => {
    return DIALECT_OPTIONS.find((d) => d.value === dialect)?.flag ?? '';
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="w-72 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b">
        <Button onClick={onNewSession} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          New Session
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No conversations yet.</p>
              <p className="text-xs mt-1">Start a new session to begin building curriculum.</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`w-full text-left p-3 rounded-lg text-sm transition-colors group ${
                  activeSessionId === session.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-muted/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{session.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs">
                        {getDialectFlag(session.target_dialect)} {session.target_dialect}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(session.updated_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
                    title="Archive session"
                  >
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
