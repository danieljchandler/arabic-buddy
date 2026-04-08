import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useStoryScenes,
  useStoryProgress,
  useUpsertStoryProgress,
  type StoryScene,
} from '@/hooks/useInteractiveStories';
import { useAddUserVocabulary } from '@/hooks/useUserVocabulary';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { HomeButton } from '@/components/HomeButton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RotateCcw, BookOpen, Trophy, ArrowLeft, Sparkles, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const StoryPlayer = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: scenes, isLoading: scenesLoading } = useStoryScenes(storyId);
  const { data: progress } = useStoryProgress(storyId);
  const upsertProgress = useUpsertStoryProgress();
  const addVocab = useAddUserVocabulary();

  const [currentSceneOrder, setCurrentSceneOrder] = useState(0);
  const [pathTaken, setPathTaken] = useState<number[]>([0]);
  const [showTranslation, setShowTranslation] = useState(false);
  const [storyTitle, setStoryTitle] = useState('');
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  // Load story title
  useEffect(() => {
    if (!storyId) return;
    supabase
      .from('interactive_stories')
      .select('title, title_arabic')
      .eq('id', storyId)
      .single()
      .then(({ data }) => {
        if (data) setStoryTitle(data.title);
      });
  }, [storyId]);

  // Restore progress
  useEffect(() => {
    if (progress && !progress.completed && scenes) {
      const restoredPath = Array.isArray(progress.path_taken) ? progress.path_taken as number[] : [0];
      setPathTaken(restoredPath);
      setCurrentSceneOrder(restoredPath[restoredPath.length - 1] ?? 0);
    }
  }, [progress, scenes]);

  const sceneMap = useMemo(() => {
    if (!scenes) return new Map<number, StoryScene>();
    return new Map(scenes.map((s) => [s.scene_order, s]));
  }, [scenes]);

  const currentScene = sceneMap.get(currentSceneOrder);

  const handleChoice = (nextSceneOrder: number) => {
    setShowTranslation(false);
    const newPath = [...pathTaken, nextSceneOrder];
    setPathTaken(newPath);
    setCurrentSceneOrder(nextSceneOrder);

    const nextScene = sceneMap.get(nextSceneOrder);

    if (user && storyId) {
      upsertProgress.mutate({
        storyId,
        currentSceneId: nextScene?.id || null,
        completed: nextScene?.is_ending || false,
        pathTaken: newPath,
      });
    }
  };

  const handleRestart = () => {
    setCurrentSceneOrder(0);
    setPathTaken([0]);
    setShowTranslation(false);

    if (user && storyId) {
      upsertProgress.mutate({
        storyId,
        currentSceneId: scenes?.[0]?.id || null,
        completed: false,
        pathTaken: [0],
      });
    }
  };

  if (scenesLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!scenes || scenes.length === 0) {
    return (
      <AppShell>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center py-16">
          <BookOpen className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-muted-foreground">This story has no scenes yet.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/stories')}>
            Back to Stories
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <HomeButton />
        <Button variant="ghost" size="sm" onClick={() => navigate('/stories')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Stories
        </Button>
      </div>

      <div className="max-w-lg mx-auto">
        {/* Story title */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold font-heading">{storyTitle}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Scene {pathTaken.length} · {scenes.length} total scenes
          </p>
        </div>

        {currentScene ? (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-400">
            {/* Narrative card */}
            <div className="bg-card border-2 border-border rounded-2xl p-6 mb-6 relative overflow-hidden">
              {/* Decorative corner */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-bl-full" />

              {/* Arabic narrative */}
              <p className="text-2xl leading-relaxed mb-4 font-medium" dir="rtl">
                {currentScene.narrative_arabic}
              </p>

              {/* English toggle */}
              <button
                onClick={() => setShowTranslation(!showTranslation)}
                className="text-xs text-primary hover:underline mb-3"
              >
                {showTranslation ? 'Hide translation' : 'Show translation'}
              </button>

              {showTranslation && (
                <p className="text-base text-muted-foreground animate-in fade-in duration-200">
                  {currentScene.narrative_english}
                </p>
              )}

              {/* Vocabulary pills */}
              {currentScene.vocabulary.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Key Words
                  </p>
                  <div className="flex flex-wrap gap-2" dir="rtl">
                    {currentScene.vocabulary.map((v, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-sm"
                      >
                        <span className="font-medium">{v.word_arabic}</span>
                        {showTranslation && <span className="text-muted-foreground text-xs">({v.word_english})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ending */}
            {currentScene.is_ending ? (
              <div className="text-center animate-in fade-in zoom-in-95 duration-500">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4">
                  <Trophy className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-xl font-bold mb-2">Story Complete!</h2>
                {currentScene.ending_message && (
                  <p className="text-muted-foreground mb-1">{currentScene.ending_message}</p>
                )}
                {currentScene.ending_message_arabic && (
                  <p className="text-lg mb-4" dir="rtl">{currentScene.ending_message_arabic}</p>
                )}
                <div className="flex gap-3 justify-center mt-6">
                  <Button variant="outline" onClick={handleRestart} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Play Again
                  </Button>
                  <Button onClick={() => navigate('/stories')}>
                    More Stories
                  </Button>
                </div>
              </div>
            ) : (
              /* Choices */
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center mb-4">
                  What do you do?
                </p>
                {currentScene.choices.map((choice, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleChoice(choice.next_scene_order)}
                    className={cn(
                      'w-full text-left rounded-xl border-2 border-border bg-card p-4',
                      'transition-all duration-200 hover:border-primary hover:shadow-md',
                      'active:scale-[0.98] group'
                    )}
                  >
                    <p className="text-lg font-medium group-hover:text-primary transition-colors" dir="rtl">
                      {choice.text_arabic}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">{choice.text_english}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Scene not found. The story may have a broken link.</p>
            <Button variant="outline" className="mt-4" onClick={handleRestart}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart Story
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default StoryPlayer;
