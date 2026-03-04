import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, BookOpen, Languages, GraduationCap, GitCompare } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, mode?: 'chat' | 'generate_lesson' | 'generate_vocab') => void;
  disabled?: boolean;
  isGenerating?: boolean;
}

const QUICK_ACTIONS = [
  {
    label: 'Generate Lesson',
    icon: GraduationCap,
    mode: 'generate_lesson' as const,
    prompt: 'Create a complete lesson about: ',
  },
  {
    label: 'Generate Vocabulary',
    icon: BookOpen,
    mode: 'generate_vocab' as const,
    prompt: 'Generate vocabulary words for the topic: ',
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(
    (mode: 'chat' | 'generate_lesson' | 'generate_vocab' = 'chat') => {
      const trimmed = value.trim();
      if (!trimmed || disabled || isGenerating) return;
      onSend(trimmed, mode);
      setValue('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [value, disabled, isGenerating, onSend],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    setValue(action.prompt);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t bg-card p-4">
      {/* Quick action buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction(action)}
            disabled={disabled || isGenerating}
            className="text-xs"
          >
            <action.icon className="h-3.5 w-3.5 mr-1.5" />
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
          onClick={() => handleSend(value.startsWith('Create a complete lesson') ? 'generate_lesson' : value.startsWith('Generate vocabulary') ? 'generate_vocab' : 'chat')}
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
