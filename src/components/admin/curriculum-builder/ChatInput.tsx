import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, BookOpen, Languages, GraduationCap, GitCompare, PenLine, Headphones, BookOpenCheck, Flame, MessageCircle, Gamepad2, Lightbulb, Sparkles } from 'lucide-react';

export type ChatMode =
  | 'chat'
  | 'generate_lesson'
  | 'generate_vocab'
  | 'generate_grammar'
  | 'generate_listening'
  | 'generate_reading'
  | 'generate_daily_challenge'
  | 'generate_conversation'
  | 'generate_game_set'
  | 'suggest_lessons'
  | 'suggest_vocab';

interface ChatInputProps {
  onSend: (message: string, mode?: ChatMode) => void;
  disabled?: boolean;
  isGenerating?: boolean;
}

const QUICK_ACTIONS = [
  {
    label: 'Lesson',
    icon: GraduationCap,
    mode: 'generate_lesson' as const,
    prompt: 'Create a complete lesson about: ',
  },
  {
    label: 'Vocabulary',
    icon: BookOpen,
    mode: 'generate_vocab' as const,
    prompt: 'Generate vocabulary words for the topic: ',
  },
  {
    label: 'Grammar',
    icon: PenLine,
    mode: 'generate_grammar' as const,
    prompt: 'Create grammar drill exercises for: ',
  },
  {
    label: 'Listening',
    icon: Headphones,
    mode: 'generate_listening' as const,
    prompt: 'Create listening exercises about: ',
  },
  {
    label: 'Reading',
    icon: BookOpenCheck,
    mode: 'generate_reading' as const,
    prompt: 'Create a reading passage about: ',
  },
  {
    label: 'Challenge',
    icon: Flame,
    mode: 'generate_daily_challenge' as const,
    prompt: 'Create a daily challenge set about: ',
  },
  {
    label: 'Conversation',
    icon: MessageCircle,
    mode: 'generate_conversation' as const,
    prompt: 'Create a conversation practice scenario for: ',
  },
  {
    label: 'Game Set',
    icon: Gamepad2,
    mode: 'generate_game_set' as const,
    prompt: 'Create a vocabulary game set for: ',
  },
  {
    label: 'Compare Dialects',
    icon: GitCompare,
    mode: 'chat' as const,
    prompt:
      'Compare how the following concept/phrase differs across Saudi, Kuwaiti, Emirati, Qatari, Bahraini, and Omani dialects: ',
  },
  {
    label: 'Translate',
    icon: Languages,
    mode: 'chat' as const,
    prompt: 'How would you say the following in Gulf Arabic (give multiple variations): ',
  },
];

export const ChatInput = ({ onSend, disabled, isGenerating }: ChatInputProps) => {
  const [value, setValue] = useState('');
  const [currentMode, setCurrentMode] = useState<ChatMode>('chat');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isGenerating) return;
    onSend(trimmed, currentMode);
    setValue('');
    setCurrentMode('chat');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, currentMode, disabled, isGenerating, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    setValue(action.prompt);
    setCurrentMode(action.mode);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t bg-card p-4">
      {/* Quick action buttons */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant={currentMode === action.mode && action.mode !== 'chat' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleQuickAction(action)}
            disabled={disabled || isGenerating}
            className="text-[11px] h-7 px-2"
          >
            <action.icon className="h-3 w-3 mr-1" />
            {action.label}
          </Button>
        ))}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGenerating
              ? 'Waiting for AI response...'
              : 'Describe what you want to build... (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled || isGenerating}
          className="min-h-[44px] max-h-[200px] resize-none"
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!value.trim() || disabled || isGenerating}
          size="icon"
          className="shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
