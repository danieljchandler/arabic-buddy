import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export type LLMModelId =
  | 'google/gemini-2.5-flash'
  | 'qwen/qwen3-235b-a22b'
  | 'google/gemma-3-12b-it'
  | 'fanar'
  | 'jais-hf'
  | 'allam-hf'
  | 'falcon-h1r';

interface ModelOption {
  id: LLMModelId;
  name: string;
  provider: string;
  description: string;
  badge?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Lovable',
    description: 'Fast, reliable, good Arabic support',
    badge: 'Recommended',
  },
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen3 235B',
    provider: 'OpenRouter',
    description: 'Strong reasoning, large context',
  },
  {
    id: 'google/gemma-3-12b-it',
    name: 'Gemma 3 12B',
    provider: 'OpenRouter',
    description: 'Good Arabic understanding',
  },
  {
    id: 'fanar',
    name: 'Fanar',
    provider: 'Qatar',
    description: 'Gulf Arabic specialist',
    badge: 'Gulf Expert',
  },
  {
    id: 'jais-hf',
    name: 'Jais 2 8B',
    provider: 'RunPod',
    description: 'Arabic-first, dialect expert',
    badge: 'Arabic Expert',
  },
  {
    id: 'falcon-h1r',
    name: 'Falcon H1R 7B',
    provider: 'RunPod',
    description: 'Arabic-native hybrid model',
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
