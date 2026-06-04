import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export type LLMModelId =
  | 'google/gemini-3.1-pro-preview'
  | 'anthropic/claude-opus-4.1'
  | 'qwen/qwen3-max'
  | 'google/gemini-3-flash-preview'
  | 'google/gemini-2.5-flash'
  | 'google/gemini-2.5-pro'
  | 'anthropic/claude-sonnet-4-5'
  | 'qwen/qwen3-235b-a22b'
  | 'google/gemma-3-12b-it'
  | 'fanar';

interface ModelOption {
  id: LLMModelId;
  name: string;
  provider: string;
  description: string;
  badge?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Lovable',
    description: 'Pipeline-aligned drafter. Top dialect quality.',
    badge: 'Recommended',
  },
  {
    id: 'anthropic/claude-opus-4.1',
    name: 'Claude Opus 4.1',
    provider: 'Lovable',
    description: 'Pipeline-aligned drafter & judge.',
    badge: 'Pipeline',
  },
  {
    id: 'qwen/qwen3-max',
    name: 'Qwen3 Max',
    provider: 'Lovable',
    description: 'Third verifier (weighted lower than Gemini/Claude).',
    badge: 'Verifier',
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'Lovable',
    description: 'Fast preview, lower cost.',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Lovable',
    description: 'Fast, reliable.',
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Lovable',
    description: 'Previous-gen strong Gemini.',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'OpenRouter',
    description: 'Strong reasoning, lower cost than Opus.',
  },
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen3 235B',
    provider: 'OpenRouter',
    description: 'Strong reasoning, large context.',
  },
  {
    id: 'google/gemma-3-12b-it',
    name: 'Gemma 3 12B',
    provider: 'OpenRouter',
    description: 'Good Arabic understanding.',
  },
  {
    id: 'fanar',
    name: 'Fanar',
    provider: 'Qatar',
    description: 'Gulf Arabic specialist',
    badge: 'Gulf Expert',
  },
];

interface ModelSelectorProps {
  value: LLMModelId;
  onChange: (model: LLMModelId) => void;
  className?: string;
}

export const ModelSelector = ({ value, onChange, className }: ModelSelectorProps) => {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LLMModelId)}>
      <SelectTrigger className={className ?? 'w-[220px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_OPTIONS.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            <span className="flex items-center gap-2">
              <span className="font-medium">{opt.name}</span>
              <span className="text-xs text-muted-foreground">({opt.provider})</span>
              {opt.badge && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {opt.badge}
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const getModelName = (id: LLMModelId | string): string => {
  return MODEL_OPTIONS.find((m) => m.id === id)?.name ?? id;
};

export { MODEL_OPTIONS };
