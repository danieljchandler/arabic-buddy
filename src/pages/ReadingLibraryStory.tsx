import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { TappableArabicText } from '@/components/shared/TappableArabicText';
import { MarkUnknownsProvider } from '@/contexts/MarkUnknownsContext';
import { SaveUnknownsBar } from '@/components/shared/SaveUnknownsBar';
import { ArrowLeft, Loader2, Play, Pause, SkipForward, SkipBack, BookOpen, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStory = Database['public']['Tables']['authentic_stories']['Row'];
type AuthenticStoryLine = Database['public']['Tables']['authentic_story_lines']['Row'];

const useStory = (id: string | undefined) =>
  useQuery({
    queryKey: ['reading-library-story', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('authentic_stories')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as AuthenticStory;
    },
    enabled: Boolean(id),
  });

const useStoryLines = (storyId: string | undefined) =>
  useQuery({
    queryKey: ['reading-library-lines', storyId],
    queryFn: async () => {
      if (!storyId) return [];
      const { data, error } = await supabase
        .from('authentic_story_lines')
        .select('*')
        .eq('story_id', storyId)
        .order('line_index', { ascending: true });
      if (error) throw error;
      return data as AuthenticStoryLine[];
    },
    enabled: Boolean(storyId),
  });

type StorySegment = {
  image_url?: string;
  url?: string;
  audio_url?: string;
  arabic_beat?: string;
  narration_arabic?: string;
  duration_seconds?: number;
  index?: number;
};

const ReadingLibraryStory = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: story, isLoading: loadingStory } = useStory(id);
  const { data: lines, isLoading: loadingLines } = useStoryLines(id);

  useDocumentTitle(story?.title ? `${story.title} — Reading Library` : 'Reading Library');

  const [showDialect, setShowDialect] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const segments: StorySegment[] = Array.isArray(story?.story_video_segments)
    ? (story!.story_video_segments as unknown as StorySegment[]).filter(
        (s) => s && (s.image_url || s.url),
      )
    : [];
  const sceneImages = segments.map((s) => (s.image_url || s.url) as string);
  const heroImage = sceneImages[activeSceneIdx] ?? sceneImages[0];

  const hasAudio = lines?.some((l) => l.audio_url);

  // Sync active scene image to line playback progress
  useEffect(() => {
    if (sceneImages.length === 0 || !lines || lines.length === 0) return;
    if (currentLineIndex < 0) { setActiveSceneIdx(0); return; }
    const idx = Math.min(
      sceneImages.length - 1,
      Math.floor((currentLineIndex / lines.length) * sceneImages.length),
    );
    setActiveSceneIdx(idx);
  }, [currentLineIndex, lines?.length, sceneImages.length]);

  // Auto-scroll to current line
  useEffect(() => {
    if (currentLineIndex >= 0 && lineRefs.current[currentLineIndex]) {
      lineRefs.current[currentLineIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentLineIndex]);

  const playLine = (index: number) => {
    if (!lines || !lines[index]?.audio_url) return;
    const line = lines[index];

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(line.audio_url!);
    audioRef.current = audio;
    setCurrentLineIndex(index);
    setIsPlaying(true);

    audio.onended = () => {
      // Auto-advance to next line
      if (index + 1 < lines.length && lines[index + 1]?.audio_url) {
        playLine(index + 1);
      } else {
        setIsPlaying(false);
        setCurrentLineIndex(-1);
      }
    };

    audio.play().catch(() => {
      setIsPlaying(false);
      toast.error('Failed to play audio');
    });
  };

  const handlePlayPause = () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (currentLineIndex >= 0) {
      audioRef.current?.play();
      setIsPlaying(true);
    } else {
      playLine(0);
    }
  };

  const handleNext = () => {
    if (!lines) return;
    const next = currentLineIndex + 1;
    if (next < lines.length) playLine(next);
  };

  const handlePrev = () => {
    if (!lines) return;
    const prev = Math.max(0, currentLineIndex - 1);
    playLine(prev);
  };

  if (loadingStory || loadingLines) {
    return (
      <AppShell>
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!story) {
    return (
      <AppShell>
        <div className="text-center py-16">
          <p>Story not found</p>
          <Button variant="link" onClick={() => navigate('/reading-library')}>Back to Library</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <MarkUnknownsProvider>
      <AppShell>
        <div className="container mx-auto px-4 py-4 max-w-3xl">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/reading-library')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-lg font-bold">{story.title}</h1>
              {story.title_arabic && (
                <p className="text-base font-arabic text-muted-foreground" dir="rtl">{story.title_arabic}</p>
              )}
            </div>
            <div className="flex gap-1">
              <Badge variant="outline">{story.difficulty}</Badge>
              <Badge variant="secondary">{story.dialect}</Badge>
            </div>
          </div>

          {/* Scene slideshow */}
          {sceneImages.length > 0 && (
            <div className="mb-4">
              <div className="relative rounded-xl overflow-hidden bg-muted aspect-video shadow-sm">
                <img
                  src={heroImage}
                  alt={`Scene ${activeSceneIdx + 1}`}
                  className="w-full h-full object-cover transition-opacity duration-500"
                />
                {sceneImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                    {activeSceneIdx + 1} / {sceneImages.length}
                  </div>
                )}
              </div>
              {sceneImages.length > 1 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {sceneImages.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveSceneIdx(i)}
                      className={cn(
                        'shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 transition',
                        i === activeSceneIdx ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100',
                      )}
                    >
                      <img src={src} alt={`Scene ${i + 1} thumbnail`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <Card className="p-3 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Audio Controls */}
              {hasAudio && (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={handlePrev} disabled={currentLineIndex <= 0}>
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="default" onClick={handlePlayPause}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={handleNext} disabled={!lines || currentLineIndex >= lines.length - 1}>
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Toggle Dialect */}
              {story.body_dialect && (
                <div className="flex items-center gap-2">
                  <Switch checked={showDialect} onCheckedChange={setShowDialect} id="dialect-toggle" />
                  <Label htmlFor="dialect-toggle" className="text-sm">Dialect</Label>
                </div>
              )}

              {/* Toggle English */}
              <div className="flex items-center gap-2">
                <Switch checked={showEnglish} onCheckedChange={setShowEnglish} id="english-toggle" />
                <Label htmlFor="english-toggle" className="text-sm">English</Label>
              </div>
            </div>
          </Card>

          {/* Story Lines */}
          <div className="space-y-4">
            {lines && lines.map((line, idx) => (
              <div
                key={line.id}
                ref={el => { lineRefs.current[idx] = el; }}
                className={cn(
                  'rounded-lg p-3 transition-colors cursor-pointer',
                  currentLineIndex === idx ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50',
                )}
                onClick={() => line.audio_url && playLine(idx)}
              >
                {/* Arabic text (tappable) */}
                <div dir="rtl" className="text-lg leading-relaxed">
                  <TappableArabicText
                    text={showDialect
                      ? (line.dialect_vocalized || line.dialect || line.arabic_vocalized || line.arabic)
                      : (line.arabic_vocalized || line.arabic)
                    }
                    sentenceContext={{ english: line.english ?? undefined }}
                    source="reading-library"
                  />
                </div>

                {/* English translation */}
                {showEnglish && line.english && (
                  <p className="text-sm text-muted-foreground mt-1">{line.english}</p>
                )}
              </div>
            ))}
          </div>

          {/* Story metadata */}
          <div className="mt-8 pt-4 border-t text-sm text-muted-foreground space-y-1">
            {story.author && <p>Author: {story.author} {story.author_arabic && `(${story.author_arabic})`}</p>}
            {story.source_name && <p>Source: {story.source_name}</p>}
            {story.license && <p>License: {story.license}</p>}
          </div>
        </div>

        <SaveUnknownsBar source="reading-library" />
      </AppShell>
    </MarkUnknownsProvider>
  );
};

export default ReadingLibraryStory;
