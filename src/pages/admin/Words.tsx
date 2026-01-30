import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTopic } from '@/hooks/useTopic';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Edit, Trash2, Volume2, Search, GripVertical, Image as ImageIcon } from 'lucide-react';
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
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Word {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  display_order: number;
}

const SortableWordCard = ({
  word,
  topicGradient,
  topicId,
  isAdmin,
  playingAudio,
  onPlayAudio,
  onEdit,
  onDelete,
}: {
  word: Word;
  topicGradient: string;
  topicId: string;
  isAdmin: boolean;
  playingAudio: string | null;
  onPlayAudio: (audioUrl: string | null, wordId: string) => void;
  onEdit: (wordId: string) => void;
  onDelete: (wordId: string) => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: word.id });
  
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={`overflow-hidden ${isDragging ? 'shadow-2xl z-50' : ''}`}
    >
      {/* Drag handle - only for admins */}
      {isAdmin && (
        <div 
          className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-lg p-1 cursor-move touch-none"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Image */}
      <div className={`aspect-square bg-gradient-to-br ${topicGradient} flex items-center justify-center relative`}>
        {word.image_url ? (
          <>
            {imageLoading && !imageError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-white/50" />
              </div>
            )}
            {imageError ? (
              <div className="flex flex-col items-center gap-2 text-white/50">
                <ImageIcon className="h-12 w-12" />
                <span className="text-xs">Image unavailable</span>
              </div>
            ) : (
              <img
                src={word.image_url}
                alt={word.word_english}
                className={`w-full h-full object-cover transition-opacity ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setImageLoading(false)}
                onError={() => {
                  setImageLoading(false);
                  setImageError(true);
                }}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/50">
            <ImageIcon className="h-12 w-12" />
            <span className="text-xs">No image</span>
          </div>
        )}
      </div>

      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-xl truncate" dir="rtl">
              {word.word_arabic}
            </p>
            <p className="text-muted-foreground truncate">
              {word.word_english}
            </p>
            <div className="flex gap-1 mt-1">
              {word.audio_url && (
                <Badge variant="secondary" className="text-xs">
                  <Volume2 className="h-3 w-3 mr-1" />
                  Audio
                </Badge>
              )}
              {word.image_url && (
                <Badge variant="secondary" className="text-xs">
                  <ImageIcon className="h-3 w-3 mr-1" />
                  Image
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={`flex-shrink-0 ${playingAudio === word.id ? 'animate-pulse text-primary' : ''}`}
            onClick={() => onPlayAudio(word.audio_url, word.id)}
            aria-label={word.audio_url ? 'Play audio' : 'No audio available'}
          >
            <Volume2 className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onEdit(word.id)}
          >
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(word.id)}
              aria-label="Delete word"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const Words = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminAuth();
  const { data: topic, isLoading } = useTopic(topicId);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [localWords, setLocalWords] = useState<Word[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Update local words when topic data changes
  useEffect(() => {
    if (topic?.words) {
      setLocalWords(topic.words as Word[]);
    }
  }, [topic?.words]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const reorderMutation = useMutation({
    mutationFn: async (reorderedWords: Word[]) => {
      const updates = reorderedWords.map((word, index) => ({
        id: word.id,
        display_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('vocabulary_words')
          .update({ display_order: update.display_order })
          .eq('id', update.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['words', topicId] });
      toast({ title: 'Words reordered successfully' });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error reordering words',
        description: error.message,
      });
      // Revert to original order
      if (topic?.words) {
        setLocalWords(topic.words as Word[]);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (wordId: string) => {
      const { error } = await supabase
        .from('vocabulary_words')
        .delete()
        .eq('id', wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['words', topicId] });
      queryClient.invalidateQueries({ queryKey: ['word-counts'] });
      toast({ title: 'Word deleted successfully' });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error deleting word',
        description: error.message,
      });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localWords.findIndex(w => w.id === active.id);
      const newIndex = localWords.findIndex(w => w.id === over.id);

      const reordered = arrayMove(localWords, oldIndex, newIndex);
      setLocalWords(reordered);
      reorderMutation.mutate(reordered);
    }
  };

  const playAudio = (audioUrl: string | null, wordId: string) => {
    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingAudio(null);
    }

    if (!audioUrl) {
      toast({
        variant: 'destructive',
        title: 'No audio',
        description: 'This word has no audio file yet.',
      });
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingAudio(wordId);
    
    audio.play().catch((err) => {
      setPlayingAudio(null);
      toast({
        variant: 'destructive',
        title: 'Audio error',
        description: 'Could not play audio file.',
      });
    });

    audio.onended = () => {
      setPlayingAudio(null);
      audioRef.current = null;
    };

    audio.onerror = () => {
      setPlayingAudio(null);
      audioRef.current = null;
      toast({
        variant: 'destructive',
        title: 'Audio error',
        description: 'Could not play audio file.',
      });
    };
  };

  const filteredWords = localWords.filter(word =>
    word.word_arabic.includes(searchQuery) ||
    word.word_english.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const wordToDelete = localWords.find(w => w.id === deleteId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading words...</p>
        </div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8">
          <p className="text-muted-foreground">Topic not found</p>
          <Button className="mt-4" onClick={() => navigate('/admin/topics')}>
            Back to Topics
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate('/admin/topics')}
                aria-label="Back to topics"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-2xl" role="img" aria-label={topic.name}>
                  {topic.icon}
                </span>
                <div>
                  <h1 className="text-xl font-bold">{topic.name}</h1>
                  <p className="text-sm text-muted-foreground" dir="rtl">
                    {topic.name_arabic} • {localWords.length} word{localWords.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
            <Button onClick={() => navigate(`/admin/topics/${topicId}/words/new`)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Word
            </Button>
          </div>

          {/* Search */}
          {localWords.length > 0 && (
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search words..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {filteredWords.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredWords.map(w => w.id)}
              strategy={rectSortingStrategy}
              disabled={!isAdmin}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredWords.map((word) => (
                  <SortableWordCard
                    key={word.id}
                    word={word}
                    topicGradient={topic.gradient}
                    topicId={topicId!}
                    isAdmin={isAdmin}
                    playingAudio={playingAudio}
                    onPlayAudio={playAudio}
                    onEdit={(wordId) => navigate(`/admin/topics/${topicId}/words/${wordId}/edit`)}
                    onDelete={setDeleteId}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : searchQuery ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No words found matching "{searchQuery}"
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <span className="text-6xl mb-4 block" role="img" aria-label="Notebook">
                📝
              </span>
              <p className="text-muted-foreground mb-4">No vocabulary words yet. Add your first word!</p>
              <Button onClick={() => navigate(`/admin/topics/${topicId}/words/new`)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Word
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Word?</AlertDialogTitle>
            <AlertDialogDescription>
              {wordToDelete && (
                <>
                  This will permanently delete <strong>{wordToDelete.word_english}</strong> ({wordToDelete.word_arabic}). This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Words;
