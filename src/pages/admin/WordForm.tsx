import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft } from 'lucide-react';
import { ImageUploader } from '@/components/admin/ImageUploader';
import { AudioUploader } from '@/components/admin/AudioUploader';
import { ImagePositionEditor } from '@/components/admin/ImagePositionEditor';

const WordForm = () => {
  const navigate = useNavigate();
  const { topicId, wordId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!wordId;

  const [wordArabic, setWordArabic] = useState('');
  const [wordEnglish, setWordEnglish] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imagePosition, setImagePosition] = useState('50 50');

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

  // Fetch existing word if editing
  const { data: existingWord, isLoading: loadingWord } = useQuery({
    queryKey: ['word', wordId],
    queryFn: async () => {
      if (!wordId) return null;
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('id', wordId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingWord) {
      setWordArabic(existingWord.word_arabic);
      setWordEnglish(existingWord.word_english);
      setImageUrl(existingWord.image_url);
      setAudioUrl(existingWord.audio_url);
      setImagePosition((existingWord as any).image_position || '50 50');
    }
  }, [existingWord]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEditing) {
        const { error } = await supabase
          .from('vocabulary_words')
          .update({
            word_arabic: wordArabic,
            word_english: wordEnglish,
            image_url: imageUrl,
            audio_url: audioUrl,
            image_position: imagePosition,
          } as any)
          .eq('id', wordId);

        if (error) throw error;
      } else {
        // Get max display_order for this topic
        const { data: maxOrder } = await supabase
          .from('vocabulary_words')
          .select('display_order')
          .eq('topic_id', topicId)
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxOrder?.display_order ?? -1) + 1;

        const { error } = await supabase
          .from('vocabulary_words')
          .insert({
            topic_id: topicId,
            word_arabic: wordArabic,
            word_english: wordEnglish,
            image_url: imageUrl,
            audio_url: audioUrl,
            image_position: imagePosition,
            display_order: nextOrder,
          } as any);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topic', topicId] });
      toast({ title: isEditing ? 'Word updated!' : 'Word created!' });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wordArabic.trim() || !wordEnglish.trim()) {
      toast({
        variant: 'destructive',
        title: 'Missing fields',
        description: 'Please fill in both word fields',
      });
      return;
    }
    mutation.mutate();
  };

  if (loadingWord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/topics/${topicId}/words`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{topic?.icon}</span>
            <h1 className="text-xl font-bold">{isEditing ? 'Edit Word' : 'New Word'}</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Word Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Word fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wordArabic">Arabic Word</Label>
                  <Input
                    id="wordArabic"
                    placeholder="e.g., أحمر"
                    value={wordArabic}
                    onChange={(e) => setWordArabic(e.target.value)}
                    dir="rtl"
                    className="text-xl"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wordEnglish">English Word</Label>
                  <Input
                    id="wordEnglish"
                    placeholder="e.g., Red"
                    value={wordEnglish}
                    onChange={(e) => setWordEnglish(e.target.value)}
                    className="text-xl"
                    required
                  />
                </div>
              </div>

              {/* Image upload */}
              <div className="space-y-2">
                <Label>Flashcard Image</Label>
                <ImageUploader
                  currentUrl={imageUrl}
                  onUpload={setImageUrl}
                  onRemove={() => setImageUrl(null)}
                />
              </div>

              {/* Image position editor - only show when image is uploaded */}
              {imageUrl && (
                <div className="space-y-2">
                  <Label>Image Position</Label>
                  <ImagePositionEditor
                    imageUrl={imageUrl}
                    position={imagePosition}
                    onPositionChange={setImagePosition}
                  />
                </div>
              )}

              {/* Audio upload */}
              <div className="space-y-2">
                <Label>Audio Pronunciation</Label>
                <AudioUploader
                  currentUrl={audioUrl}
                  onUpload={setAudioUrl}
                  onRemove={() => setAudioUrl(null)}
                />
              </div>

              {/* Submit */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/admin/topics/${topicId}/words`)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    isEditing ? 'Update Word' : 'Create Word'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default WordForm;
