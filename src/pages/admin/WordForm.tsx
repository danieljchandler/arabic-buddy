import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, AlertCircle, Eye, Volume2 } from 'lucide-react';
import { ImageUploader } from '@/components/admin/ImageUploader';
import { AudioUploader } from '@/components/admin/AudioUploader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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
    }
  }, [existingWord]);

  // Check for unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!existingWord && (wordArabic || wordEnglish || imageUrl || audioUrl)) {
      return true;
    }
    if (existingWord) {
      return (
        wordArabic !== existingWord.word_arabic ||
        wordEnglish !== existingWord.word_english ||
        imageUrl !== existingWord.image_url ||
        audioUrl !== existingWord.audio_url
      );
    }
    return false;
  }, [wordArabic, wordEnglish, imageUrl, audioUrl, existingWord]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Validate Arabic characters
      const arabicRegex = /[\u0600-\u06FF]/;
      if (!arabicRegex.test(wordArabic)) {
        throw new Error('Arabic word must contain Arabic characters');
      }

      // Check for duplicates
      const { data: existing } = await supabase
        .from('vocabulary_words')
        .select('id')
        .eq('topic_id', topicId)
        .or(`word_arabic.eq.${wordArabic},word_english.ilike.${wordEnglish}`)
        .neq('id', wordId || '');

      if (existing && existing.length > 0) {
        throw new Error('A word with this Arabic or English text already exists in this topic');
      }

      if (isEditing) {
        const { error } = await supabase
          .from('vocabulary_words')
          .update({
            word_arabic: wordArabic.trim(),
            word_english: wordEnglish.trim(),
            image_url: imageUrl,
            audio_url: audioUrl,
          })
          .eq('id', wordId);

        if (error) throw error;
      } else {
        // Get max display_order for this topic - handle empty case
        const { data: maxOrderResult } = await supabase
          .from('vocabulary_words')
          .select('display_order')
          .eq('topic_id', topicId)
          .order('display_order', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextOrder = maxOrderResult?.display_order !== undefined
          ? maxOrderResult.display_order + 1
          : 0;

        const { error } = await supabase
          .from('vocabulary_words')
          .insert({
            topic_id: topicId,
            word_arabic: wordArabic.trim(),
            word_english: wordEnglish.trim(),
            image_url: imageUrl,
            audio_url: audioUrl,
            display_order: nextOrder,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['words', topicId] });
      queryClient.invalidateQueries({ queryKey: ['word-counts'] });
      toast({
        title: isEditing ? 'Word updated!' : 'Word created!',
        description: isEditing
          ? 'Your changes have been saved.'
          : 'The new word is now available.',
      });
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

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setShowCancelDialog(true);
    } else {
      navigate(`/admin/topics/${topicId}/words`);
    }
  };

  const playAudio = () => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(err => {
        toast({
          variant: 'destructive',
          title: 'Error playing audio',
          description: err.message,
        });
      });
    }
  };

  if (loadingWord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading word...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleCancel}
              aria-label="Go back to words list"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl" role="img" aria-label={topic?.name}>
                {topic?.icon}
              </span>
              <div>
                <h1 className="text-xl font-bold">{isEditing ? 'Edit Word' : 'New Word'}</h1>
                {hasUnsavedChanges && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Unsaved changes
                  </p>
                )}
              </div>
            </div>
          </div>
          
          {/* Preview button */}
          {(wordArabic || wordEnglish || imageUrl) && (
            <Dialog open={showPreview} onOpenChange={setShowPreview}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Flashcard Preview</DialogTitle>
                  <DialogDescription>
                    How this word will appear to learners
                  </DialogDescription>
                </DialogHeader>
                <div className={`bg-gradient-to-br ${topic?.gradient || 'from-yellow-400 to-orange-500'} rounded-3xl p-8 shadow-lg`}>
                  {imageUrl && (
                    <div className="mb-4 flex justify-center">
                      <img
                        src={imageUrl}
                        alt={wordEnglish}
                        className="w-32 h-32 object-cover rounded-2xl"
                      />
                    </div>
                  )}
                  <div className="text-center space-y-2">
                    <p className="text-5xl font-bold text-white" dir="rtl">
                      {wordArabic || '...'}
                    </p>
                    <p className="text-2xl text-white/90">
                      {wordEnglish || '...'}
                    </p>
                  </div>
                  {audioUrl && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={playAudio}
                      >
                        <Volume2 className="h-4 w-4 mr-2" />
                        Play Audio
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Word Details</CardTitle>
            <CardDescription>
              {isEditing
                ? 'Update the word information below'
                : `Add a new word to ${topic?.name || 'this topic'}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Word fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wordArabic">
                    Arabic Word *
                    <span className="text-xs text-muted-foreground ml-2">(must contain Arabic)</span>
                  </Label>
                  <Input
                    id="wordArabic"
                    placeholder="e.g., أحمر"
                    value={wordArabic}
                    onChange={(e) => setWordArabic(e.target.value)}
                    dir="rtl"
                    className="text-xl"
                    required
                    disabled={mutation.isPending}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wordEnglish">English Word *</Label>
                  <Input
                    id="wordEnglish"
                    placeholder="e.g., Red"
                    value={wordEnglish}
                    onChange={(e) => setWordEnglish(e.target.value)}
                    className="text-xl"
                    required
                    disabled={mutation.isPending}
                    maxLength={50}
                  />
                </div>
              </div>

              {/* Image upload */}
              <div className="space-y-2">
                <Label>
                  Flashcard Image
                  <span className="text-xs text-muted-foreground ml-2">(optional)</span>
                </Label>
                <ImageUploader
                  currentUrl={imageUrl}
                  onUpload={setImageUrl}
                  onRemove={() => setImageUrl(null)}
                  disabled={mutation.isPending}
                />
              </div>

              {/* Audio upload */}
              <div className="space-y-2">
                <Label>
                  Audio Pronunciation
                  <span className="text-xs text-muted-foreground ml-2">(optional)</span>
                </Label>
                <AudioUploader
                  currentUrl={audioUrl}
                  onUpload={setAudioUrl}
                  onRemove={() => setAudioUrl(null)}
                  disabled={mutation.isPending}
                />
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isEditing ? 'Updating...' : 'Creating...'}
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

      {/* Cancel confirmation dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to leave? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => navigate(`/admin/topics/${topicId}/words`)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WordForm;
