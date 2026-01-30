import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopics } from '@/hooks/useTopics';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Edit, Trash2, GripVertical, Search } from 'lucide-react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TopicWithWordCount {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  wordCount: number;
}

const SortableTopicCard = ({ 
  topic, 
  isAdmin, 
  onEdit, 
  onDelete, 
  onManageWords 
}: { 
  topic: TopicWithWordCount;
  isAdmin: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onManageWords: (id: string) => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card 
      ref={setNodeRef} 
      style={style} 
      className={`flex items-center ${isDragging ? 'shadow-lg z-50' : ''}`}
    >
      {isAdmin && (
        <div 
          className="p-4 cursor-move text-muted-foreground hover:text-foreground touch-none"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-5 w-5" />
        </div>
      )}
      <CardContent className="flex-1 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <span className="text-4xl flex-shrink-0" role="img" aria-label={topic.name}>
            {topic.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-lg truncate">{topic.name}</h3>
            <p className="text-sm text-muted-foreground truncate" dir="rtl">
              {topic.name_arabic}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {topic.wordCount} word{topic.wordCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onManageWords(topic.id)}
            className="flex-1 sm:flex-initial"
          >
            Manage Words
          </Button>
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onEdit(topic.id)}
                aria-label="Edit topic"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(topic.id)}
                aria-label="Delete topic"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const Topics = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminAuth();
  const { data: topics, isLoading } = useTopics();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [localTopics, setLocalTopics] = useState<TopicWithWordCount[]>([]);

  // Get word counts for all topics
  const { data: wordCounts } = useQuery({
    queryKey: ['word-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('topic_id');

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(word => {
        counts[word.topic_id] = (counts[word.topic_id] || 0) + 1;
      });
      return counts;
    },
  });

  // Get word count for topic being deleted
  const topicToDelete = localTopics.find(t => t.id === deleteId);
  const wordsToDelete = topicToDelete?.wordCount || 0;

  // Combine topics with word counts
  useState(() => {
    if (topics && wordCounts) {
      const topicsWithCounts = topics.map(topic => ({
        ...topic,
        wordCount: wordCounts[topic.id] || 0,
      }));
      setLocalTopics(topicsWithCounts);
    }
  });

  // Update local topics when data changes
  useState(() => {
    if (topics && wordCounts) {
      setLocalTopics(topics.map(topic => ({
        ...topic,
        wordCount: wordCounts[topic.id] || 0,
      })));
    }
  }, [topics, wordCounts]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const reorderMutation = useMutation({
    mutationFn: async (reorderedTopics: TopicWithWordCount[]) => {
      const updates = reorderedTopics.map((topic, index) => ({
        id: topic.id,
        display_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('topics')
          .update({ display_order: update.display_order })
          .eq('id', update.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
      toast({ title: 'Topics reordered successfully' });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error reordering topics',
        description: error.message,
      });
      // Revert to original order
      if (topics && wordCounts) {
        setLocalTopics(topics.map(topic => ({
          ...topic,
          wordCount: wordCounts[topic.id] || 0,
        })));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (topicId: string) => {
      // Delete all words first (cascade)
      const { error: wordsError } = await supabase
        .from('vocabulary_words')
        .delete()
        .eq('topic_id', topicId);

      if (wordsError) throw wordsError;

      // Then delete the topic
      const { error: topicError } = await supabase
        .from('topics')
        .delete()
        .eq('id', topicId);

      if (topicError) throw topicError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
      queryClient.invalidateQueries({ queryKey: ['word-counts'] });
      toast({ title: 'Topic deleted successfully' });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error deleting topic',
        description: error.message,
      });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localTopics.findIndex(t => t.id === active.id);
      const newIndex = localTopics.findIndex(t => t.id === over.id);

      const reordered = arrayMove(localTopics, oldIndex, newIndex);
      setLocalTopics(reordered);
      reorderMutation.mutate(reordered);
    }
  };

  const filteredTopics = localTopics.filter(topic =>
    topic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    topic.name_arabic.includes(searchQuery)
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading topics...</p>
        </div>
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
                onClick={() => navigate('/admin')}
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold">Manage Topics</h1>
                <p className="text-sm text-muted-foreground">
                  {localTopics.length} topic{localTopics.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={() => navigate('/admin/topics/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Add Topic
              </Button>
            )}
          </div>

          {/* Search */}
          {localTopics.length > 0 && (
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {filteredTopics.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredTopics.map(t => t.id)}
              strategy={verticalListSortingStrategy}
              disabled={!isAdmin}
            >
              <div className="space-y-3">
                {filteredTopics.map((topic) => (
                  <SortableTopicCard
                    key={topic.id}
                    topic={topic}
                    isAdmin={isAdmin}
                    onEdit={(id) => navigate(`/admin/topics/${id}/edit`)}
                    onDelete={setDeleteId}
                    onManageWords={(id) => navigate(`/admin/topics/${id}/words`)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : searchQuery ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No topics found matching "{searchQuery}"
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">
                {isAdmin ? 'No topics yet. Create your first topic!' : 'No topics available.'}
              </p>
              {isAdmin && (
                <Button onClick={() => navigate('/admin/topics/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Topic
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{topicToDelete?.name}</strong> and all <strong>{wordsToDelete}</strong> of its vocabulary word{wordsToDelete !== 1 ? 's' : ''}. This action cannot be undone.
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

export default Topics;
