import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Bot, User, Eye, FileText } from 'lucide-react';
import type { ChatMessage } from '@/hooks/useCurriculumChat';
import { getModelName } from './ModelSelector';

interface ChatWindowProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  sessionId: string | null;
  selectedMessageId: string | null;
  onSelectPreview: (messageId: string) => void;
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  lesson_preview: { label: 'Lesson', icon: '📚' },
  vocab_preview: { label: 'Vocabulary', icon: '📖' },
  grammar_preview: { label: 'Grammar', icon: '📝' },
  listening_preview: { label: 'Listening', icon: '🎧' },
  reading_preview: { label: 'Reading', icon: '📰' },
  daily_challenge_preview: { label: 'Daily Challenge', icon: '🔥' },
  conversation_preview: { label: 'Conversation', icon: '💬' },
  game_set_preview: { label: 'Game Set', icon: '🎮' },
  picture_scene_preview: { label: 'Picture Scene', icon: '🖼️' },
};

export const ChatWindow = ({
  messages,
  isGenerating,
  sessionId,
  selectedMessageId,
  onSelectPreview,
}: ChatWindowProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-6">
        <div className="text-center max-w-sm">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium mb-2">Curriculum Builder</h3>
          <p className="text-sm">
            Create a new session or pick one from the sidebar to start building
            lessons, exercises, and vocabulary with AI.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {messages.length === 0 && !isGenerating && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm font-medium mb-1">Tell the AI what to build</p>
            <p className="text-xs">Use the <strong>Generate</strong> button below or just type a request.</p>
          </div>
        )}

        {messages.map((msg) => {
          const meta = msg.output_type ? TYPE_META[msg.output_type] : null;
          const isSelected = selectedMessageId === msg.id;
          return (
            <div key={msg.id}>
              <div className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>

                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {msg.llm_model && msg.role === 'assistant' && (
                    <Badge variant="outline" className="text-[10px] mb-2">
                      {getModelName(msg.llm_model)}
                    </Badge>
                  )}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {renderContent(msg.content)}
                  </div>

                  {meta && msg.structured_output && (
                    <Button
                      type="button"
                      variant={isSelected ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => onSelectPreview(msg.id)}
                      className="mt-3 h-8 gap-1.5"
                    >
                      <span>{meta.icon}</span>
                      <FileText className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">{meta.label} ready</span>
                      <Eye className="h-3.5 w-3.5 ml-1 opacity-70" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isGenerating && (
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted">
              <Bot className="h-4 w-4" />
            </div>
            <div className="bg-muted rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating response...
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
};

function renderContent(content: string): string {
  return content.replace(/```json[\s\S]*?```/g, '').trim();
}
