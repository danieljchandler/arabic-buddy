import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Loader2,
  Pickaxe,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Play,
  Send,
} from 'lucide-react';

// The clip pipeline's workbench. Mining (mine-clip-candidates) turns caption
// index hits into pending candidates; the verification stack
// (verify-clip-candidate) tiers them verified / needs_review / rejected. This
// page drives both and works the needs_review queue — the only part of the
// pipeline a human is meant to touch routinely. Each card shows every
// verifier's evidence so a hold is explainable at a glance.

interface ClipCandidate {
  id: string;
  concept_id: string | null;
  start_ms: number;
  end_ms: number;
  status: string;
  rank_score: number | null;
  created_at: string;
  verification: {
    mined?: {
      term?: string;
      concept_key?: string;
      line_text?: string;
      channel?: string;
      yt_video_id?: string;
      caption_source?: string;
    };
    term?: { pass?: boolean; matched?: string | null };
    markers?: { pass?: boolean; contextMsa?: number; contextBest?: string | null };
    playability?: { pass?: boolean; durationMs?: number };
    judge?: {
      is_target_dialect?: boolean;
      contains_target?: boolean;
      family_friendly?: boolean;
      beginner_friendly?: boolean;
      reason?: string;
      error?: string;
    };
  } | null;
}

const DIALECTS = ['Gulf', 'Egyptian', 'Yemeni'] as const;
type StatusTab = 'pending' | 'needs_review' | 'verified' | 'rejected' | 'published';

const checkChip = (label: string, pass: boolean | undefined) =>
  pass === undefined ? null : (
    <Badge
      className={
        pass
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      }
    >
      {label} {pass ? '✓' : '✗'}
    </Badge>
  );

const AdminClips = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState<StatusTab>('needs_review');
  const [mineDialect, setMineDialect] = useState<string>('Gulf');
  const [mineTerms, setMineTerms] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['clip-candidates', statusTab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clip_candidates')
        .select('id, concept_id, start_ms, end_ms, status, rank_score, created_at, verification')
        .eq('status', statusTab)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ClipCandidate[];
    },
  });

  // A count on every tab, so "the page is empty" is distinguishable from
  // "this queue is empty" without clicking through all five.
  const { data: statusCounts } = useQuery({
    queryKey: ['clip-candidate-counts'],
    queryFn: async () => {
      const statuses: StatusTab[] = ['pending', 'needs_review', 'verified', 'rejected', 'published'];
      const entries = await Promise.all(
        statuses.map(async (s) => {
          const { count } = await supabase
            .from('clip_candidates')
            .select('id', { count: 'exact', head: true })
            .eq('status', s);
          return [s, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<StatusTab, number>;
    },
  });

  // The last pipeline run's own explanation, kept on screen — a zero-mined
  // toast disappears before its reason can be read.
  const [lastRun, setLastRun] = useState<{ title: string; description?: string } | null>(null);

  const mine = useMutation({
    mutationFn: async () => {
      const terms = mineTerms
        .split(/[,،\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const body = terms.length > 0
        ? { dialect: mineDialect, terms }
        : { dialect: mineDialect };
      const { data, error } = await supabase.functions.invoke('mine-clip-candidates', { body });
      if (error) throw error;
      return data as { mined: number; note?: string };
    },
    onSuccess: (data) => {
      const result = { title: `Mined ${data.mined} candidate(s)`, description: data.note };
      setLastRun(result);
      toast({
        ...result,
        // A zero with its reason needs to be read, not glimpsed.
        duration: data.mined === 0 ? 12000 : undefined,
      });
      qc.invalidateQueries({ queryKey: ['clip-candidates'] });
      qc.invalidateQueries({ queryKey: ['clip-candidate-counts'] });
    },
    onError: (e: Error) => toast({ title: 'Mining failed', description: e.message, variant: 'destructive' }),
  });

  const verifySweep = useMutation({
    mutationFn: async (candidateId?: string) => {
      const { data, error } = await supabase.functions.invoke('verify-clip-candidate', {
        body: candidateId ? { candidateId } : { limit: 10 },
      });
      if (error) throw error;
      return data as { processed: number; outcomes?: Record<string, number>; pending?: number };
    },
    onSuccess: (data) => {
      const outcomes = Object.entries(data.outcomes ?? {})
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      const result = {
        title: `Verified ${data.processed} candidate(s)`,
        description: outcomes ? `${outcomes}; ${data.pending ?? 0} still pending` : undefined,
      };
      setLastRun(result);
      toast(result);
      qc.invalidateQueries({ queryKey: ['clip-candidates'] });
      qc.invalidateQueries({ queryKey: ['clip-candidate-counts'] });
    },
    onError: (e: Error) => toast({ title: 'Verification failed', description: e.message, variant: 'destructive' }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('publish-verified-clips', {
        body: { limit: 10 },
      });
      if (error) throw error;
      return data as { published: number; skipped?: Array<{ reason: string }>; remaining?: number };
    },
    onSuccess: (data) => {
      const held = (data.skipped ?? []).length;
      toast({
        title: `Published ${data.published} clip(s)`,
        description:
          `${data.remaining ?? 0} verified remaining` + (held ? `; ${held} held (see queue)` : ''),
      });
      qc.invalidateQueries({ queryKey: ['clip-candidates'] });
    },
    onError: (e: Error) => toast({ title: 'Publish failed', description: e.message, variant: 'destructive' }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('clip_candidates')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clip-candidates'] }),
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} aria-label="Back to admin">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Clip Candidates</h1>
          <p className="text-muted-foreground">
            Mine the caption index, run the verification stack, and work the review queue.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {DIALECTS.map((d) => (
              <Button key={d} size="sm" variant={mineDialect === d ? 'default' : 'outline'} onClick={() => setMineDialect(d)}>
                {d}
              </Button>
            ))}
          </div>
          <div className="flex-1 min-w-56">
            <label className="text-sm text-muted-foreground" htmlFor="mine-terms">
              Arabic word(s) to mine — empty sweeps concepts without clips
            </label>
            <Input id="mine-terms" dir="rtl" value={mineTerms} onChange={(e) => setMineTerms(e.target.value)} placeholder="كلب، الكلب" />
          </div>
          <Button onClick={() => mine.mutate()} disabled={mine.isPending}>
            {mine.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}
            Mine
          </Button>
          <Button variant="secondary" onClick={() => verifySweep.mutate(undefined)} disabled={verifySweep.isPending}>
            {verifySweep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Run verification
          </Button>
          <Button variant="secondary" onClick={() => publish.mutate()} disabled={publish.isPending}>
            {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish verified
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['needs_review', 'pending', 'verified', 'rejected', 'published'] as StatusTab[]).map((tab) => (
          <Button key={tab} size="sm" variant={statusTab === tab ? 'default' : 'outline'} onClick={() => setStatusTab(tab)}>
            {tab.replace('_', ' ')}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (candidates ?? []).length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">Nothing in this queue.</p>
      ) : (
        <div className="space-y-3">
          {(candidates ?? []).map((candidate) => {
            const mined = candidate.verification?.mined ?? {};
            const judge = candidate.verification?.judge;
            const startSec = Math.floor(candidate.start_ms / 1000);
            const endSec = Math.ceil(candidate.end_ms / 1000);
            return (
              <Card key={candidate.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p dir="rtl" className="text-lg font-medium">{mined.line_text ?? '—'}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {mined.concept_key && <Badge variant="outline">{mined.concept_key}</Badge>}
                        {mined.term && <Badge variant="secondary" dir="rtl">{mined.term}</Badge>}
                        {mined.channel && <span className="text-sm text-muted-foreground">{mined.channel}</span>}
                        <span className="text-sm text-muted-foreground">
                          {startSec}s–{endSec}s ({((candidate.end_ms - candidate.start_ms) / 1000).toFixed(1)}s)
                        </span>
                        {mined.caption_source && <Badge variant="outline">{mined.caption_source}</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {checkChip('term', candidate.verification?.term?.pass)}
                        {checkChip('markers', candidate.verification?.markers?.pass)}
                        {checkChip('playable', candidate.verification?.playability?.pass)}
                        {judge && !judge.error && (
                          <>
                            {checkChip('dialect', judge.is_target_dialect)}
                            {checkChip('target', judge.contains_target)}
                            {checkChip('safe', judge.family_friendly)}
                            {checkChip('beginner', judge.beginner_friendly)}
                          </>
                        )}
                        {judge?.error && <Badge variant="destructive">judge unavailable</Badge>}
                      </div>
                      {judge?.reason && <p className="text-sm text-muted-foreground mt-1">{judge.reason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {mined.yt_video_id && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPreviewId(previewId === candidate.id ? null : candidate.id)}
                          >
                            <Play className="h-4 w-4" /> Preview
                          </Button>
                          <Button size="sm" variant="ghost" asChild>
                            <a
                              href={`https://www.youtube.com/watch?v=${mined.yt_video_id}&t=${startSec}s`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open on YouTube"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </>
                      )}
                      {candidate.status === 'pending' && (
                        <Button size="sm" variant="secondary" onClick={() => verifySweep.mutate(candidate.id)}>
                          <ShieldCheck className="h-4 w-4" /> Verify
                        </Button>
                      )}
                      {candidate.status !== 'verified' && candidate.status !== 'published' && (
                        <Button size="sm" onClick={() => setStatus.mutate({ id: candidate.id, status: 'verified' })}>
                          <ThumbsUp className="h-4 w-4" /> Approve
                        </Button>
                      )}
                      {candidate.status !== 'rejected' && (
                        <Button size="sm" variant="destructive" onClick={() => setStatus.mutate({ id: candidate.id, status: 'rejected' })}>
                          <ThumbsDown className="h-4 w-4" /> Reject
                        </Button>
                      )}
                    </div>
                  </div>
                  {previewId === candidate.id && mined.yt_video_id && (
                    <div className="mt-4 aspect-video max-w-xl">
                      {/* Official iframe embed with start/end — the ToS-compliant clip surface. */}
                      <iframe
                        className="w-full h-full rounded-md border"
                        src={`https://www.youtube.com/embed/${mined.yt_video_id}?start=${startSec}&end=${endSec}`}
                        title="Clip preview"
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminClips;
