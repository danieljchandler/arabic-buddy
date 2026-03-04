import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bot, User } from 'lucide-react';
import type { ChatMessage } from '@/hooks/useCurriculumChat';
import { getModelName } from './ModelSelector';
import { LessonPreviewCard } from './LessonPreviewCard';
import { VocabPreviewCard } from './VocabPreviewCard';

interface ChatWindowProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  sessionId: string | null;
  onApproveLesson: (messageId: string, data: Record<string, unknown>) => void;
  onApproveVocab: (messageId: string, data: Record<string, unknown>) => void;
}

export const ChatWindow = ({
  messages,
  isGenerating,
  sessionId,
  onApproveLesson,
  onApproveVocab,
}: ChatWindowProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium mb-2">Curriculum Builder</h3>
          <p className="text-sm max-w-md">
            Create a new session or select an existing one to start building
            lessons and vocabulary with AI assistance.
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
            <p className="text-sm">Start the conversation. Try one of the quick actions below, or type freely.</p>
            <div className="mt-4 space-y-2 text-xs">
              <p>&bull; "Create a lesson about greetings and introductions for beginners"</p>
              <p>&bull; "Generate 20 food vocabulary words used in Saudi restaurants"</p>
              <p>&bull; "Compare how people say 'how are you' across all Gulf countries"</p>
              <p>&bull; "What topics should Stage 1 (Foundations) cover?"</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <div
              className={`flex gap-3 ${
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {/* Avatar */}
              <div
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {msg.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              {/* Message bubble */}
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
              </div>
            </div>

            {/* Structured output preview cards */}
            {msg.structured_output && msg.output_type === 'lesson_preview' && (
              <div className="ml-11 mt-2">
                <LessonPreviewCard
                  data={msg.structured_output}
                  onApprove={() => onApproveLesson(msg.id, msg.structured_output!)}
                />
              </div>
            )}
            {msg.structured_output && msg.output_type === 'vocab_preview' && (
              <div className="ml-11 mt-2">
                <VocabPreviewCard
                  data={msg.structured_output}
                  onApprove={() => onApproveVocab(msg.id, msg.structured_output!)}
                />
              </div>
            )}
          </div>
        ))}

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

/** Simple content renderer that strips JSON code blocks from display (they appear as preview cards instead). */
function renderContent(content: string): string {
  // Remove ```json ... ``` blocks since they're rendered as structured preview cards
  return content.replace(/```json[\s\S]*?```/g, '').trim();
}
