import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Trash2, Mic, Check, X, Play, Pause, Square } from 'lucide-react';
import { InlineAudioRecorder } from '@/components/admin/InlineAudioRecorder';

interface WordEntry {
  id: string;
  wordArabic: string;
  wordEnglish: string;
  audioUrl: string | null;
  isRecording: boolean;
}

const createEmptyEntry = (): WordEntry => ({
  id: crypto.randomUUID(),
  wordArabic: '',
  wordEnglish: '',
  audioUrl: null,
  isRecording: false,
});

const BulkWordImport = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [entries, setEntries] = useState<WordEntry[]>([
    createEmptyEntry(),
    createEmptyEntry(),
    createEmptyEntry(),
  ]);

  // Fetch topic info
  const { data: topic } = useQuery({
    queryKey: ['topic-info', topicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('name, name_arabic, icon, gradient')
        .eq('id', topicId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      // Filter valid entries
      const validEntries = entries.filter(
        (e) => e.wordArabic.trim() && e.wordEnglish.trim()
      );

      if (validEntries.length === 0) {
        throw new Error('No valid entries to save');
      }

      // Get current max display_order
      const { data: maxOrder } = await supabase
        .from('vocabulary_words')
        .select('display_order')
        .eq('topic_id', topicId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();

      let nextOrder = (maxOrder?.display_order ?? -1) + 1;

      // Insert all entries
      const wordsToInsert = validEntries.map((entry) => ({
        topic_id: topicId,
        word_arabic: entry.wordArabic.trim(),
        word_english: entry.wordEnglish.trim(),
        audio_url: entry.audioUrl,
        image_url: null,
        display_order: nextOrder++,
      }));

      const { error } = await supabase
        .from('vocabulary_words')
        .insert(wordsToInsert);

      if (error) throw error;

      return validEntries.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['topic', topicId] });
      toast({ title: `${count} words added successfully!` });
      navigate(`/admin/topics/${topicId}/words`);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    },
  });

  const updateEntry = (id: string, field: keyof WordEntry, value: any) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      )
    );
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, createEmptyEntry()]);
  };

  const addMultipleEntries = (count: number) => {
    const newEntries = Array.from({ length: count }, () => createEmptyEntry());
    setEntries((prev) => [...prev, ...newEntries]);
  };

  const validCount = entries.filter(
    (e) => e.wordArabic.trim() && e.wordEnglish.trim()
  ).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/admin/topics/${topicId}/words`)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{topic?.icon}</span>
              <div>
                <h1 className="text-xl font-bold">Bulk Import</h1>
                <p className="text-sm text-muted-foreground">{topic?.name}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {validCount} valid {validCount === 1 ? 'word' : 'words'}
            </span>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || validCount === 0}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save All ({validCount})
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add Multiple Words</CardTitle>
            <CardDescription>
              Enter Arabic and English words, then optionally record audio for each.
              Empty rows will be ignored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={addEntry}>
                <Plus className="mr-2 h-4 w-4" />
                Add 1 Row
              </Button>
              <Button variant="outline" size="sm" onClick={() => addMultipleEntries(5)}>
                <Plus className="mr-2 h-4 w-4" />
                Add 5 Rows
              </Button>
              <Button variant="outline" size="sm" onClick={() => addMultipleEntries(10)}>
                <Plus className="mr-2 h-4 w-4" />
                Add 10 Rows
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Word entries */}
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <Card
              key={entry.id}
              className={`transition-opacity ${
                entry.wordArabic.trim() && entry.wordEnglish.trim()
                  ? 'border-primary/30'
                  : 'opacity-80'
              }`}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <span className="text-sm text-muted-foreground font-mono w-8 pt-2.5">
                    {index + 1}.
                  </span>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      placeholder="Arabic word (e.g., أحمر)"
                      value={entry.wordArabic}
                      onChange={(e) =>
                        updateEntry(entry.id, 'wordArabic', e.target.value)
                      }
                      dir="rtl"
                      className="text-lg"
                    />
                    <Input
                      placeholder="English word (e.g., Red)"
                      value={entry.wordEnglish}
                      onChange={(e) =>
                        updateEntry(entry.id, 'wordEnglish', e.target.value)
                      }
                      className="text-lg"
                    />
                  </div>

                  {/* Audio section */}
                  <div className="flex items-center gap-2">
                    {entry.isRecording ? (
                      <InlineAudioRecorder
                        onSave={(url) => {
                          updateEntry(entry.id, 'audioUrl', url);
                          updateEntry(entry.id, 'isRecording', false);
                        }}
                        onCancel={() => updateEntry(entry.id, 'isRecording', false)}
                      />
                    ) : entry.audioUrl ? (
                      <div className="flex items-center gap-1">
                        <AudioPreview url={entry.audioUrl} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateEntry(entry.id, 'audioUrl', null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => updateEntry(entry.id, 'isRecording', true)}
                        title="Record audio"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeEntry(entry.id)}
                    disabled={entries.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={() => addMultipleEntries(5)}>
            <Plus className="mr-2 h-4 w-4" />
            Add More Rows
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || validCount === 0}
            size="lg"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save All ({validCount})
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
};

// Small inline audio preview component
const AudioPreview = ({ url }: { url: string }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useState<HTMLAudioElement | null>(null)[0];

  const togglePlay = () => {
    const audio = new Audio(url);
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      audio.play();
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9 text-success"
      onClick={togglePlay}
      title="Play recording"
    >
      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
};

export default BulkWordImport;
