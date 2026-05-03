import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, X } from 'lucide-react';
import { QuickActionsMenu } from './QuickActionsMenu';

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
  | 'generate_picture_scene'
  | 'suggest_lessons'
  | 'suggest_vocab';

interface ChatInputProps {
  onSend: (message: string, mode?: ChatMode) => void;
  disabled?: boolean;
  isGenerating?: boolean;
}

const QUICK_ACTIONS = [
  {
    label: 'Suggest Lessons',
    icon: Lightbulb,
    mode: 'suggest_lessons' as const,
    prompt: 'Suggest lesson ideas for: ',
  },
  {
    label: 'Suggest Vocab',
    icon: Sparkles,
    mode: 'suggest_vocab' as const,
    prompt: 'Suggest vocabulary themes for: ',
  },
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
    label: 'Picture Scene',
    icon: ImageIcon,
    mode: 'generate_picture_scene' as const,
    prompt: 'Create a picture scene for the theme: ',
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

  const handleQuickAction = (action: { prompt: string; mode: ChatMode }) => {
    setValue(action.prompt);
    setCurrentMode(action.mode);
    textareaRef.current?.focus();
  };

  const clearMode = () => setCurrentMode('chat');

  return (
    <div className="border-t bg-card p-3 sm:p-4">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-2 shrink-0">
          <QuickActionsMenu
            currentMode={currentMode}
            onSelect={handleQuickAction}
            disabled={disabled || isGenerating}
          />
          {currentMode !== 'chat' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearMode}
              className="h-6 px-1.5 text-[10px] text-muted-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              clear
            </Button>
          )}
        </div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGenerating
              ? 'Waiting for AI response...'
              : currentMode !== 'chat'
                ? 'Describe what to generate…'
                : 'Message the curriculum AI…  (Enter to send)'
          }
          disabled={disabled || isGenerating}
          className="min-h-[44px] max-h-[200px] resize-none"
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!value.trim() || disabled || isGenerating}
          size="icon"
          className="shrink-0 h-9 w-9"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
