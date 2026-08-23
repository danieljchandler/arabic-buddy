import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, ThumbsUp, ThumbsDown, RotateCcw, Plus } from 'lucide-react';

// The clip pipeline's channel registry: the curated per-dialect channel corpus
// that harvesting, caption indexing and mining all key off. Rows arrive as
// seeded research candidates or are added here; the harvest/scorer scripts
// fill dialect_score / msa_score, and a human's approve/reject is what gates a
// channel into the mining pool (mine-clip-candidates only searches approved
// channels). Notes carry each candidate's open verification questions.

interface ChannelRow {
  id: string;
  name: string;
  handle: string | null;
  yt_channel_id: string | null;
  dialect: string;
  country: string | null;
  genre: string | null;
  status: string;
  dialect_score: number | null;
  msa_score: number | null;
  notes: string | null;
  last_harvested_at: string | null;
}

const DIALECTS = ['Gulf', 'Egyptian', 'Yemeni'] as const;
type StatusTab = 'candidate' | 'approved' | 'rejected' | 'all';

const scoreBadge = (label: string, value: number | null, goodIsHigh: boolean) => {
  if (value === null) return null;
  const good = goodIsHigh ? value >= 0.3 : value <= 0.15;
  const bad = goodIsHigh ? value < 0.1 : value > 0.3;
  const tone = good
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
    : bad
      ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  return <Badge className={tone}>{label} {(value * 100).toFixed(0)}%</Badge>;
};

const AdminChannels = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState<StatusTab>('candidate');
  const [dialectFilter, setDialectFilter] = useState<string>('all');
  const [newName, setNewName] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [newDialect, setNewDialect] = useState<string>('Gulf');

  const { data: channels, isLoading } = useQuery({
    queryKey: ['content-channels', statusTab],
    queryFn: async () => {
      let query = supabase
        .from('content_channels')
        .select('*')
        .order('dialect')
        .order('name');
      if (statusTab !== 'all') query = query.eq('status', statusTab);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ChannelRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('content_channels')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-channels'] }),
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const addChannel = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error('Channel name is required');
      const { error } = await supabase.from('content_channels').insert({
        name: newName.trim(),
        handle: newHandle.trim() || null,
        dialect: newDialect,
        status: 'candidate',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName('');
      setNewHandle('');
      toast({ title: 'Channel added as candidate' });
      qc.invalidateQueries({ queryKey: ['content-channels'] });
    },
    onError: (e: Error) => toast({ title: 'Add failed', description: e.message, variant: 'destructive' }),
  });

  const visible = (channels ?? []).filter(
    (c) => dialectFilter === 'all' || c.dialect === dialectFilter,
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} aria-label="Back to admin">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Clip Channels</h1>
          <p className="text-muted-foreground">
            The dialect channel corpus. Approving a channel puts it in the harvesting and mining pool.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="text-sm text-muted-foreground" htmlFor="new-channel-name">Channel name</label>
            <Input id="new-channel-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Moshaya Family" />
          </div>
          <div className="flex-1 min-w-40">
            <label className="text-sm text-muted-foreground" htmlFor="new-channel-handle">Handle (optional)</label>
            <Input id="new-channel-handle" value={newHandle} onChange={(e) => setNewHandle(e.target.value)} placeholder="@handle" />
          </div>
          <div className="flex gap-1">
            {DIALECTS.map((d) => (
              <Button key={d} size="sm" variant={newDialect === d ? 'default' : 'outline'} onClick={() => setNewDialect(d)}>
                {d}
              </Button>
            ))}
          </div>
          <Button onClick={() => addChannel.mutate()} disabled={addChannel.isPending}>
            {addChannel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add candidate
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['candidate', 'approved', 'rejected', 'all'] as StatusTab[]).map((tab) => (
          <Button key={tab} size="sm" variant={statusTab === tab ? 'default' : 'outline'} onClick={() => setStatusTab(tab)}>
            {tab}
          </Button>
        ))}
        <span className="mx-2 border-l" />
        {['all', ...DIALECTS].map((d) => (
          <Button key={d} size="sm" variant={dialectFilter === d ? 'secondary' : 'ghost'} onClick={() => setDialectFilter(d)}>
            {d}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">No channels in this view.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((channel) => (
            <Card key={channel.id}>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{channel.name}</h3>
                      {channel.handle && <span className="text-sm text-muted-foreground">{channel.handle}</span>}
                      <Badge variant="outline">{channel.dialect}</Badge>
                      {channel.country && <Badge variant="outline">{channel.country}</Badge>}
                      {channel.genre && <Badge variant="secondary">{channel.genre}</Badge>}
                      {scoreBadge('dialect', channel.dialect_score, true)}
                      {scoreBadge('MSA', channel.msa_score, false)}
                    </div>
                    {channel.notes && <p className="text-sm text-muted-foreground mt-1">{channel.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {channel.yt_channel_id ? `id ${channel.yt_channel_id}` : 'channel id unresolved'}
                      {channel.last_harvested_at
                        ? ` · harvested ${new Date(channel.last_harvested_at).toLocaleDateString()}`
                        : ' · never harvested'}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {channel.status !== 'approved' && (
                      <Button size="sm" onClick={() => setStatus.mutate({ id: channel.id, status: 'approved' })}>
                        <ThumbsUp className="h-4 w-4" /> Approve
                      </Button>
                    )}
                    {channel.status !== 'rejected' && (
                      <Button size="sm" variant="destructive" onClick={() => setStatus.mutate({ id: channel.id, status: 'rejected' })}>
                        <ThumbsDown className="h-4 w-4" /> Reject
                      </Button>
                    )}
                    {channel.status !== 'candidate' && (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: channel.id, status: 'candidate' })}>
                        <RotateCcw className="h-4 w-4" /> Re-vet
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminChannels;
