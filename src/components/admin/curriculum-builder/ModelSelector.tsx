import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

import {
  CURRICULUM_MODEL_OPTIONS,
  curriculumModelName,
} from "../../../../supabase/functions/_shared/curriculumModels";

// The options come from the same module curriculum-chat builds its registry
// from, so the picker cannot offer an id the function rejects. An id is a
// plain string now rather than a union: the list is the source of truth.
export type LLMModelId = string;

const MODEL_OPTIONS = CURRICULUM_MODEL_OPTIONS;

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

export const getModelName = (id: LLMModelId): string => curriculumModelName(id);

export { MODEL_OPTIONS };
