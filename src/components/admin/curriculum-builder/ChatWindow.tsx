import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bot, User } from 'lucide-react';
import type { ChatMessage } from '@/hooks/useCurriculumChat';
import { getModelName } from './ModelSelector';
import { LessonPreviewCard } from './LessonPreviewCard';
import { VocabPreviewCard } from './VocabPreviewCard';
import {
  GrammarPreviewCard,
  ListeningPreviewCard,
  ReadingPreviewCard,
  DailyChallengePreviewCard,
  ConversationPreviewCard,
  GameSetPreviewCard,
} from './ContentPreviewCard';

interface ChatWindowProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  sessionId: string | null;
  onApproveLesson: (messageId: string, data: Record<string, unknown>, stageId: string) => void;
  onApproveVocab: (messageId: string, data: Record<string, unknown>, lessonId: string, selectedIndices: number[]) => void;
  onApproveContent: (messageId: string, outputType: string, data: Record<string, unknown>) => void;
}

export const ChatWindow = ({
  messages,
  isGenerating,
  sessionId,
  onApproveLesson,
  onApproveVocab,
  onApproveContent,
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
            lessons, exercises, and vocabulary with AI assistance.
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
            <p className="text-sm">Start the conversation. Use the quick actions below to generate any type of learning content.</p>
            <div className="mt-4 space-y-2 text-xs">
              <p>&bull; <strong>Lessons</strong> — "Create a lesson about greetings for beginners"</p>
              <p>&bull; <strong>Grammar</strong> — "Generate verb conjugation drills for intermediate"</p>
              <p>&bull; <strong>Listening</strong> — "Create dictation exercises about daily routines"</p>
              <p>&bull; <strong>Reading</strong> — "Write a reading passage about Saudi coffee culture"</p>
              <p>&bull; <strong>Challenges</strong> — "Make a daily challenge about food vocabulary"</p>
              <p>&bull; <strong>Conversations</strong> — "Create a conversation scenario at a restaurant"</p>
              <p>&bull; <strong>Games</strong> — "Generate a matching game set for colors and numbers"</p>
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
            {msg.structured_output && (
              <div className="ml-11 mt-2">
                {msg.output_type === 'lesson_preview' && (
                  <LessonPreviewCard
                    data={msg.structured_output}
                    onApprove={(stageId) => onApproveLesson(msg.id, msg.structured_output!, stageId)}
                  />
                )}
                {msg.output_type === 'vocab_preview' && (
                  <VocabPreviewCard
                    data={msg.structured_output}
                    onApprove={(lessonId, selectedIndices) => onApproveVocab(msg.id, msg.structured_output!, lessonId, selectedIndices)}
                  />
                )}
                {msg.output_type === 'grammar_preview' && (
                  <GrammarPreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'grammar_preview', msg.structured_output!)}
                  />
                )}
                {msg.output_type === 'listening_preview' && (
                  <ListeningPreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'listening_preview', msg.structured_output!)}
                  />
                )}
                {msg.output_type === 'reading_preview' && (
                  <ReadingPreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'reading_preview', msg.structured_output!)}
                  />
                )}
                {msg.output_type === 'daily_challenge_preview' && (
                  <DailyChallengePreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'daily_challenge_preview', msg.structured_output!)}
                  />
                )}
                {msg.output_type === 'conversation_preview' && (
                  <ConversationPreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'conversation_preview', msg.structured_output!)}
                  />
                )}
                {msg.output_type === 'game_set_preview' && (
                  <GameSetPreviewCard
                    data={msg.structured_output}
                    onApprove={() => onApproveContent(msg.id, 'game_set_preview', msg.structured_output!)}
                  />
                )}
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

function renderContent(content: string): string {
  return content.replace(/```json[\s\S]*?```/g, '').trim();
}
