import { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingPanel } from '@/components/loading/LoadingPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { TappableArabicText } from '@/components/shared/TappableArabicText';
import { AskAISentence } from '@/components/shared/AskAISentence';
import { TranslationPair } from '@/components/shared/TranslationPair';
import { MarkUnknownsProvider } from '@/contexts/MarkUnknownsContext';
import { SaveUnknownsBar } from '@/components/shared/SaveUnknownsBar';
import { ArrowLeft, Play, Pause, SkipForward, SkipBack, Volume2, Loader2 } from 'lucide-react';
import { useLineAudio } from '@/hooks/useLineAudio';
import {
  hasDialect,
  storedClipFor,
  storyLineText,
  ttsDialectFor,
  type StoryRegister,
} from '@/lib/storyReading';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePageAiContext } from '@/contexts/AiAssistantContext';
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

  /**
   * Dialect first.
   *
   * The library's source texts are public-domain fusha and the app teaches
   * spoken Arabic, so the dialect rendering is the story — the fusha is the
   * provenance, kept one switch away for a learner who wants to see what the
   * original said. This started the other way round, which is how a feature
   * that had a dialect conversion all along still put MSA in front of
   * everyone. A line the conversion skipped falls back to its fusha on its
   * own; see `storyLineText`.
   */
  const [register, setRegister] = useState<StoryRegister>('dialect');
  const showDialect = register === 'dialect';
  const [showEnglish, setShowEnglish] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const segments: StorySegment[] = Array.isArray(story?.story_video_segments)
    ? (story!.story_video_segments as unknown as StorySegment[]).filter(
        (s) => s && (s.image_url || s.url),
      )
    : [];
  const sceneImages = segments.map((s) => (s.image_url || s.url) as string);
  const heroImage = sceneImages[activeSceneIdx] ?? sceneImages[0];

  /**
   * Speech for the story, in the register on screen.
   *
   * Lines an editor already had narrated are played from storage and cost
   * nothing; everything else is synthesised on demand through `tts-speak`,
   * which picks the voice from the dialect. `storedClipFor` is what keeps the
   * two honest — a recording made from the dialect text is not played under
   * the fusha, and vice versa.
   */
  const readable = useMemo(() => lines ?? [], [lines]);
  const spokenLines = useMemo(
    () => readable.map((l) => storyLineText(l, register)),
    [readable, register],
  );
  const storedClips = useMemo(
    () => readable.map((l) => storedClipFor(l, register)),
    [readable, register],
  );
  /**
   * A story the conversion never reached is a fusha story, whatever it is
   * filed under — so it is read by an MSA voice rather than by a Gulf one
   * doing its best with case endings. Per page and not per line: a story where
   * one line fell back still reads better in one voice than in two.
   */
  const spokenRegister: StoryRegister =
    register === 'dialect' && readable.some(hasDialect) ? 'dialect' : 'fusha';
  const { playingIndex, loadingIndex, isPlayingAll, playLine, playAll } = useLineAudio({
    lines: spokenLines,
    clips: storedClips,
    dialect: ttsDialectFor(story?.dialect, spokenRegister),
  });

  // The line shown as a caption under the picture. Defaults to 0 so the
  // reader always sees the first phrase; follows the audio while it plays and
  // the prev/next controls otherwise.
  useEffect(() => {
    if (playingIndex !== null) setSelectedIdx(playingIndex);
  }, [playingIndex]);
  const focusedIdx = playingIndex ?? selectedIdx;
  const focusedLine = readable[focusedIdx];

  // Sync active scene image to focused line
  useEffect(() => {
    if (sceneImages.length === 0 || !lines || lines.length === 0) return;
    const idx = Math.min(
      sceneImages.length - 1,
      Math.floor((focusedIdx / lines.length) * sceneImages.length),
    );
    setActiveSceneIdx(idx);
  }, [focusedIdx, lines?.length, sceneImages.length]);

  // Auto-scroll to the line that is sounding
  useEffect(() => {
    if (playingIndex !== null && lineRefs.current[playingIndex]) {
      lineRefs.current[playingIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [playingIndex]);

  // What the assistant sees: the whole story with the line the learner is on
  // marked, in whichever register they are reading (the dialect toggle swaps
  // the text on screen, so it swaps what the tutor is shown too).
  usePageAiContext(
    useMemo(() => {
      if (!story || !lines || lines.length === 0) return null;
      const textOf = (l: AuthenticStoryLine) => storyLineText(l, register);
      const focus = lines[focusedIdx];
      return {
        kind: 'story' as const,
        title: story.title,
        summary: `Reading an authentic story from the reading library${story.dialect ? ` (${story.dialect} dialect)` : ''}${showDialect ? ', currently shown in its dialect version' : ''}.`,
        content: focus ? `${textOf(focus)}${focus.english ? ` — ${focus.english}` : ''}` : undefined,
        document: {
          label: 'Full story text',
          sourceId: story.id,
          lines: lines.map((l, i) => ({
            index: i + 1,
            arabic: textOf(l),
            english: l.english ?? undefined,
          })),
        },
        meta: { dialect: story.dialect ?? undefined },
        position: { index: focusedIdx + 1, total: lines.length },
      };
    }, [story, lines, focusedIdx, register, showDialect]),
  );

  const goTo = (index: number) => {
    if (index < 0 || index >= readable.length || index === focusedIdx) return;
    setSelectedIdx(index);
    // Moving through a story is listening to it, so the new line speaks —
    // which is what the prev/next buttons did before they were wired to a
    // stored clip that may not exist.
    playLine(index);
  };

  if (loadingStory || loadingLines) {
    return (
      <AppShell>
        <LoadingPanel variant="page" />
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
            <Button variant="ghost" size="icon" aria-label="Back to the library" onClick={() => navigate('/reading-library')}>
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
              <div className="relative rounded-xl overflow-hidden bg-muted aspect-video shadow-soft">
                <img
                  src={heroImage}
                  alt={`Scene ${activeSceneIdx + 1}`}
                  className="w-full h-full object-cover transition-opacity duration-500"
                />
                {sceneImages.length > 1 && (
                  <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
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

          {/* Caption card: current phrase under the picture, with prev/next */}
          {lines && lines.length > 0 && focusedLine && (
            <Card className="p-4 mb-4 border-2 border-primary/20 shadow-soft">
              <div dir="rtl" className="text-xl leading-loose text-center min-h-[3rem]">
                <TappableArabicText
                  text={spokenLines[focusedIdx]}
                  sentenceContext={{ english: focusedLine.english ?? undefined }}
                  source="reading-library"
                />
              </div>
              {showEnglish && focusedLine.english && (
                <TranslationPair
                  variant="compact"
                  literal={(focusedLine as { english_literal?: string | null }).english_literal}
                  natural={focusedLine.english}
                  className="text-center mt-2"
                />
              )}

              <div className="flex justify-center mt-2">
                <AskAISentence
                  arabic={spokenLines[focusedIdx]}
                  english={focusedLine.english ?? undefined}
                  variant="chip"
                />
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-border">
                <Button size="icon" variant="ghost" aria-label="Previous line" onClick={() => goTo(focusedIdx - 1)} disabled={focusedIdx <= 0}>
                  <SkipBack className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3">
                  {/*
                    Always offered, never gated on a pre-generated recording:
                    an unnarrated story is spoken on demand in its own dialect,
                    which is the whole point of having one.
                  */}
                  <Button
                    size="icon"
                    variant="default"
                    aria-label={isPlayingAll ? 'Stop reading aloud' : 'Read the story aloud'}
                    onClick={() => (isPlayingAll ? playAll() : playAll(focusedIdx))}
                    className="h-11 w-11 rounded-full"
                  >
                    {isPlayingAll ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {focusedIdx + 1} / {lines.length}
                  </span>
                </div>
                <Button size="icon" variant="ghost" aria-label="Next line" onClick={() => goTo(focusedIdx + 1)} disabled={focusedIdx >= lines.length - 1}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          )}

          {/* Display toggles */}
          <Card className="p-3 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              {story.body_dialect && (
                <div className="flex items-center gap-2">
                  {/*
                    Switched on. The label says what turning it off gets you,
                    because the dialect is the story and the fusha is where it
                    came from — not the other way round.
                  */}
                  <Switch
                    checked={showDialect}
                    onCheckedChange={(on) => setRegister(on ? 'dialect' : 'fusha')}
                    id="dialect-toggle"
                  />
                  <Label htmlFor="dialect-toggle" className="text-sm">
                    {showDialect ? `${story.dialect || 'Dialect'} · tap to see the original` : 'Original (فصحى)'}
                  </Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={showEnglish} onCheckedChange={setShowEnglish} id="english-toggle" />
                <Label htmlFor="english-toggle" className="text-sm">English</Label>
              </div>
            </div>
          </Card>


          {/* Story Lines */}
          <div className="space-y-4">
            {readable.map((line, idx) => (
              <div
                key={line.id}
                ref={el => { lineRefs.current[idx] = el; }}
                className={cn(
                  'rounded-lg p-3 transition-colors',
                  playingIndex === idx ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50',
                )}
              >
                {/* Arabic text (tappable) */}
                <div dir="rtl" className="text-lg leading-relaxed">
                  <TappableArabicText
                    text={spokenLines[idx]}
                    sentenceContext={{ english: line.english ?? undefined }}
                    source="reading-library"
                  />
                </div>

                {/* English translation */}
                {showEnglish && line.english && (
                  <TranslationPair
                    variant="compact"
                    literal={(line as { english_literal?: string | null }).english_literal}
                    natural={line.english}
                    className="mt-1"
                  />
                )}

                {/*
                  A speaker per line rather than a tap anywhere on it: the
                  words in the line are themselves tappable for a gloss, so the
                  whole row cannot also be a play button without the two
                  fighting. It was gated on `line.audio_url` before, which
                  meant a story nobody had narrated could not be heard at all.
                */}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => playLine(idx)}
                    disabled={loadingIndex === idx}
                    aria-label={playingIndex === idx ? `Stop line ${idx + 1}` : `Play line ${idx + 1}`}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                      playingIndex === idx
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
                    )}
                  >
                    {loadingIndex === idx ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : playingIndex === idx ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
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
