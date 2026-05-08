import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Laugh, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDialect } from '@/contexts/DialectContext';

interface MemePost {
  id: string;
  title: string;
  title_arabic: string;
  dialect: string;
  media_type: string;
  thumbnail_url: string | null;
  has_speech: boolean;
  has_music: boolean;
  status: string;
  created_at: string;
  vocabulary: unknown[];
}

const AdminMemes = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const [memes, setMemes] = useState<MemePost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('meme_posts')
      .select('id, title, title_arabic, dialect, media_type, thumbnail_url, has_speech, has_music, status, created_at, vocabulary')
      .eq('dialect', activeDialect)
      .order('created_at', { ascending: false });
    if (error) toast.error('Failed to load memes', { description: error.message });
    setMemes((data ?? []) as MemePost[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeDialect]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this meme?')) return;
    const { error } = await supabase.from('meme_posts').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    load();
  };

  return (
    <div className="container mx-auto max-w-5xl p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Laugh className="h-7 w-7 text-primary" /> Memes ({activeDialect})
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Curate memes with on-screen text + optional audio. Music-only clips skip ASR.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/memes/new')} className="gap-2">
          <Plus className="h-4 w-4" /> New Meme
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : memes.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No memes yet. Click "New Meme" to start.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {memes.map((m) => (
            <Card key={m.id} className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate(`/admin/memes/${m.id}`)}>
              <div className="aspect-video bg-muted relative">
                {m.thumbnail_url ? (
                  <img src={m.thumbnail_url} alt={m.title} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Laugh className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex gap-1">
                  <Badge variant={m.status === 'published' ? 'default' : 'outline'}>{m.status}</Badge>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-3 space-y-1">
                <div className="font-medium text-sm truncate">{m.title || 'Untitled meme'}</div>
                <div className="text-xs text-muted-foreground truncate" dir="rtl">{m.title_arabic}</div>
                <div className="flex gap-1 flex-wrap text-[10px] text-muted-foreground pt-1">
                  <Badge variant="outline" className="text-[10px] py-0">{m.media_type}</Badge>
                  {m.has_speech && <Badge variant="outline" className="text-[10px] py-0">speech</Badge>}
                  {m.has_music && <Badge variant="outline" className="text-[10px] py-0">music</Badge>}
                  <Badge variant="outline" className="text-[10px] py-0">{(m.vocabulary as unknown[])?.length ?? 0} words</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminMemes;
