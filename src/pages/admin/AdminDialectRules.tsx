import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Sparkles, Check, Archive, Trash2, ArrowLeft, Pencil, Save, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RuleStatus = 'draft' | 'approved' | 'retired';
type RuleSource = 'manual' | 'ai_generated' | 'corpus_mined';

interface Rule {
  id: string;
  dialect: string;
  category: string;
  rule: string;
  examples: { good?: string[]; bad?: string[] } | null;
  priority: number;
  status: RuleStatus;
  source: RuleSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_BADGE: Record<RuleStatus, string> = {
  draft: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  retired: 'bg-muted text-muted-foreground border-border',
};

const SOURCE_BADGE: Record<RuleSource, string> = {
  manual: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  ai_generated: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  corpus_mined: 'bg-teal-500/10 text-teal-700 border-teal-500/30',
};

const AdminDialectRules = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [category, setCategory] = useState('');
  const [count, setCount] = useState(6);
  const [guidance, setGuidance] = useState('');
  const [generating, setGenerating] = useState(false);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['dialect_rules', activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dialect_rules' as any)
        .select('*')
        .eq('dialect', activeDialect)
        .order('priority', { ascending: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
  });

  const grouped = useMemo(() => {
    const g = { draft: [], approved: [], retired: [] } as Record<RuleStatus, Rule[]>;
    (rules ?? []).forEach((r) => g[r.status]?.push(r));
    return g;
  }, [rules]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-dialect-rules', {
        body: {
          dialect: activeDialect,
          category: category.trim() || undefined,
          guidance: guidance.trim() || undefined,
          count,
        },
      });
      if (error) throw error;
      toast({
        title: 'Drafts created',
        description: `${data?.inserted ?? 0} new candidate rule(s) added for review.`,
      });
      setGuidance('');
      qc.invalidateQueries({ queryKey: ['dialect_rules', activeDialect] });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to draft rules',
        description: (err as Error)?.message ?? 'Unknown error',
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="text-right">
            <h1 className="text-2xl font-semibold">Dialect Rulebook</h1>
            <p className="text-sm text-muted-foreground">
              Rules powering every AI generation for{' '}
              <span className="font-medium">{activeDialect}</span>
            </p>
          </div>
        </div>

        {/* AI drafter */}
        <Card className="border-purple-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Ask the AI council to propose new rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Category (optional)</label>
                <Input
                  placeholder="e.g. negation, pronouns"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Count</label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={generate}
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Draft rules
                </Button>
              </div>
            </div>
            <Textarea
              placeholder="Guidance for the council (optional). e.g. 'Focus on Saudi vs Emirati differences in question words.'"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={2}
            />
          </CardContent>
        </Card>

        {/* Rules tabs */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="draft" className="w-full">
            <TabsList>
              <TabsTrigger value="draft">
                Drafts <Badge variant="outline" className="ml-2">{grouped.draft.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="approved">
                Approved <Badge variant="outline" className="ml-2">{grouped.approved.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="retired">
                Retired <Badge variant="outline" className="ml-2">{grouped.retired.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {(['draft', 'approved', 'retired'] as RuleStatus[]).map((s) => (
              <TabsContent key={s} value={s} className="space-y-3 mt-4">
                {grouped[s].length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No {s} rules.
                  </p>
                ) : (
                  grouped[s].map((r) => <RuleRow key={r.id} rule={r} dialect={activeDialect} />)
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
};

interface RuleRowProps {
  rule: Rule;
  dialect: string;
}

const RuleRow = ({ rule, dialect }: RuleRowProps) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    rule: rule.rule,
    category: rule.category,
    priority: rule.priority,
    notes: rule.notes ?? '',
    good: (rule.examples?.good ?? []).join('\n'),
    bad: (rule.examples?.bad ?? []).join('\n'),
  });

  useEffect(() => {
    setDraft({
      rule: rule.rule,
      category: rule.category,
      priority: rule.priority,
      notes: rule.notes ?? '',
      good: (rule.examples?.good ?? []).join('\n'),
      bad: (rule.examples?.bad ?? []).join('\n'),
    });
  }, [rule]);

  const updateStatus = useMutation({
    mutationFn: async (status: RuleStatus) => {
      const patch: any = { status };
      if (status === 'approved') {
        const { data: u } = await supabase.auth.getUser();
        patch.approved_by = u.user?.id;
        patch.approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from('dialect_rules' as any).update(patch).eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      toast({ title: `Rule ${status}` });
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('dialect_rules' as any).delete().eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule deleted' });
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('dialect_rules' as any)
        .update({
          rule: draft.rule.trim(),
          category: draft.category.trim() || 'general',
          priority: Math.max(1, Math.min(5, Number(draft.priority) || 3)),
          notes: draft.notes.trim() || null,
          examples: {
            good: draft.good.split('\n').map((s) => s.trim()).filter(Boolean),
            bad: draft.bad.split('\n').map((s) => s.trim()).filter(Boolean),
          },
          version: undefined, // let it stay; could bump if desired
        })
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule saved' });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE[rule.status]}>{rule.status}</Badge>
          <Badge variant="outline" className={SOURCE_BADGE[rule.source]}>{rule.source}</Badge>
          <Badge variant="outline">P{rule.priority}</Badge>
          <Badge variant="outline">{rule.category}</Badge>
          <div className="flex-1" />
          {!editing && (
            <>
              {rule.status !== 'approved' && (
                <Button size="sm" variant="default" onClick={() => updateStatus.mutate('approved')}>
                  <Check className="h-4 w-4 mr-1" /> Approve
                </Button>
              )}
              {rule.status !== 'retired' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('retired')}>
                  <Archive className="h-4 w-4 mr-1" /> Retire
                </Button>
              )}
              {rule.status === 'retired' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('draft')}>
                  Reopen
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm('Delete this rule permanently?')) remove.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <Textarea value={draft.rule} onChange={(e) => setDraft({ ...draft, rule: e.target.value })} rows={3} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="category"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
              <Select
                value={String(draft.priority)}
                onValueChange={(v) => setDraft({ ...draft, priority: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>Priority {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Good examples (one per line)</label>
                <Textarea
                  dir="rtl"
                  className="font-arabic"
                  value={draft.good}
                  onChange={(e) => setDraft({ ...draft, good: e.target.value })}
                  rows={4}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bad examples (one per line)</label>
                <Textarea
                  dir="rtl"
                  className="font-arabic"
                  value={draft.bad}
                  onChange={(e) => setDraft({ ...draft, bad: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed">{rule.rule}</p>
            {(rule.examples?.good?.length || rule.examples?.bad?.length) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {rule.examples?.good?.length ? (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
                    <div className="text-xs text-emerald-700 font-medium mb-1">Good</div>
                    <ul dir="rtl" className="space-y-0.5">
                      {rule.examples.good.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  </div>
                ) : null}
                {rule.examples?.bad?.length ? (
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                    <div className="text-xs text-red-700 font-medium mb-1">Bad / MSA</div>
                    <ul dir="rtl" className="space-y-0.5">
                      {rule.examples.bad.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {rule.notes && (
              <p className="text-xs text-muted-foreground italic">{rule.notes}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminDialectRules;
