import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  BookOpen,
  GraduationCap,
  PenLine,
  Headphones,
  BookOpenCheck,
  Flame,
  MessageCircle,
  Gamepad2,
  Lightbulb,
  Sparkles,
  
  Languages,
  GitCompare,
  Plus,
} from 'lucide-react';
import type { ChatMode } from './ChatInput';

interface QuickAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  mode: ChatMode;
  prompt: string;
}

const GROUPS: { label: string; actions: QuickAction[] }[] = [
  {
    label: 'Brainstorm',
    actions: [
      { label: 'Suggest Lessons', icon: Lightbulb, mode: 'suggest_lessons', prompt: 'Suggest lesson ideas for: ' },
      { label: 'Suggest Vocab', icon: Sparkles, mode: 'suggest_vocab', prompt: 'Suggest vocabulary themes for: ' },
    ],
  },
  {
    label: 'Generate content',
    actions: [
      { label: 'Lesson', icon: GraduationCap, mode: 'generate_lesson', prompt: 'Create a complete lesson about: ' },
      { label: 'Vocabulary', icon: BookOpen, mode: 'generate_vocab', prompt: 'Generate vocabulary words for the topic: ' },
      
    ],
  },
  {
    label: 'Exercises',
    actions: [
      { label: 'Grammar', icon: PenLine, mode: 'generate_grammar', prompt: 'Create grammar drill exercises for: ' },
      { label: 'Listening', icon: Headphones, mode: 'generate_listening', prompt: 'Create listening exercises about: ' },
      { label: 'Reading', icon: BookOpenCheck, mode: 'generate_reading', prompt: 'Create a reading passage about: ' },
      { label: 'Daily Challenge', icon: Flame, mode: 'generate_daily_challenge', prompt: 'Create a daily challenge set about: ' },
      { label: 'Conversation', icon: MessageCircle, mode: 'generate_conversation', prompt: 'Create a conversation practice scenario for: ' },
      { label: 'Game Set', icon: Gamepad2, mode: 'generate_game_set', prompt: 'Create a vocabulary game set for: ' },
    ],
  },
  {
    label: 'Reference',
    actions: [
      { label: 'Compare Dialects', icon: GitCompare, mode: 'chat', prompt: 'Compare how the following concept/phrase differs across Saudi, Kuwaiti, Emirati, Qatari, Bahraini, and Omani dialects: ' },
      { label: 'Translate', icon: Languages, mode: 'chat', prompt: 'How would you say the following in Gulf Arabic (give multiple variations): ' },
    ],
  },
];

interface QuickActionsMenuProps {
  currentMode: ChatMode;
  onSelect: (action: QuickAction) => void;
  disabled?: boolean;
}

export const QuickActionsMenu = ({ currentMode, onSelect, disabled }: QuickActionsMenuProps) => {
  const activeAction = GROUPS.flatMap((g) => g.actions).find(
    (a) => a.mode === currentMode && a.mode !== 'chat',
  );
  const ActiveIcon = activeAction?.icon ?? Plus;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={activeAction ? 'default' : 'outline'}
          size="sm"
          disabled={disabled}
          className="h-9 gap-1.5"
        >
          <ActiveIcon className="h-3.5 w-3.5" />
          <span className="text-xs">{activeAction?.label ?? 'Generate'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-2">
        <div className="space-y-3">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">
                {group.label}
              </p>
              <div className="grid grid-cols-2 gap-1">
                {group.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => onSelect(action)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left hover:bg-muted transition-colors ${
                      action.mode === currentMode && action.mode !== 'chat'
                        ? 'bg-muted ring-1 ring-primary/40'
                        : ''
                    }`}
                  >
                    <action.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
