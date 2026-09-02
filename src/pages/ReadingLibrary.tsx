import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingPanel } from '@/components/loading/LoadingPanel';
import { useComprehensionMap } from '@/hooks/useComprehensionMap';
import { ComprehensionBar } from '@/components/shared/ComprehensionBar';
import { EmptyState } from '@/components/shared/EmptyState';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, BookOpen, Clock, Headphones, Sparkles } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStory = Database['public']['Tables']['authentic_stories']['Row'];

const usePublishedStories = (filters: { difficulty?: string; dialect?: string }) =>
  useQuery({
    queryKey: ['reading-library', filters],
    queryFn: async () => {
      let query = supabase
        .from('authentic_stories')
        // body_dialect rides along so coverage can be computed client-side from
        // the decks already in cache, the same way Discover ships transcripts.
        // The library is curated and bounded; if it ever grows past a few
        // hundred stories this wants a stored coverage column instead.
        .select('id, title, title_arabic, author, author_arabic, source_name, dialect, difficulty, duration_seconds, video_status, story_video_url, story_video_approved, body_dialect, created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (filters.difficulty && filters.difficulty !== 'all') {
        query = query.eq('difficulty', filters.difficulty);
      }
      if (filters.dialect && filters.dialect !== 'all') {
        query = query.eq('dialect', filters.dialect);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Pick<AuthenticStory, 'id' | 'title' | 'title_arabic' | 'author' | 'author_arabic' | 'source_name' | 'dialect' | 'difficulty' | 'duration_seconds' | 'video_status' | 'story_video_url' | 'story_video_approved' | 'body_dialect' | 'created_at'>[];
    },
  });

const ReadingLibrary = () => {
  useDocumentTitle('Reading Library — Hakiya');
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState('all');
  const [dialect, setDialect] = useState('all');

  const { data: stories, isLoading } = usePublishedStories({ difficulty, dialect });
  // Silent prose: nothing but the words carries meaning, so the reading
  // floors apply — the strictest of the three modes (95% minimal).
  const comprehensionMap = useComprehensionMap(stories, "reading");
  const [justRightOnly, setJustRightOnly] = useState(false);
  const shelfStories = useMemo(() => {
    if (!stories) return stories;
    if (!justRightOnly || comprehensionMap.size === 0) return stories;
    // Same rule as Discover and Listen: the sweet spot and above, with
    // unmeasured stories excluded rather than guessed at.
    return stories.filter((s) => {
      const c = comprehensionMap.get(s.id);
      return c !== undefined && c.band !== "too-hard";
    });
  }, [stories, justRightOnly, comprehensionMap]);

  // duration_seconds is nullable in the DB, so accept null as well as undefined.
  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-heading">Reading Library</h1>
            <p className="text-sm text-muted-foreground">Authentic Arabic stories for reading & listening practice</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dialect} onValueChange={setDialect}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Dialect" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dialects</SelectItem>
              <SelectItem value="Gulf">Gulf</SelectItem>
              <SelectItem value="Egyptian">Egyptian</SelectItem>
              <SelectItem value="Yemeni">Yemeni</SelectItem>
              <SelectItem value="Levantine">Levantine</SelectItem>
              <SelectItem value="MSA">MSA</SelectItem>
            </SelectContent>
          </Select>

          {comprehensionMap.size > 0 && (
            <Button
              variant={justRightOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setJustRightOnly((v) => !v)}
              aria-pressed={justRightOnly}
              className="gap-1.5 self-center"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Just right for me
            </Button>
          )}
        </div>

        {/* Stories Grid */}
        {isLoading ? (
          <LoadingPanel variant="inline" task="story" className="py-16" />
        ) : shelfStories && shelfStories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shelfStories.map((story) => (
              <Card
                key={story.id}
                className="p-4 cursor-pointer hover:shadow-card transition-shadow"
                onClick={() => navigate(`/reading-library/${story.id}`)}
              >
                <div className="flex gap-3">
                {/* The story's approved preview scene doubles as a cover thumb;
                    unapproved AI imagery never reaches the learner list. */}
                {story.story_video_approved && story.story_video_url && (
                  <img
                    src={story.story_video_url}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    draggable={false}
                    className="h-20 w-20 rounded-xl object-cover shrink-0 select-none ring-1 ring-border/60"
                  />
                )}
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-base">{story.title}</h3>
                    <Badge variant="outline" className="text-xs shrink-0 ml-2">
                      {story.difficulty}
                    </Badge>
                  </div>
                  {story.title_arabic && (
                    <p className="text-base font-arabic text-muted-foreground" dir="rtl">
                      {story.title_arabic}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {story.author && <span>{story.author}</span>}
                    {story.dialect && <Badge variant="secondary" className="text-xs">{story.dialect}</Badge>}
                    {story.video_status === 'ready' && (
                      <span className="flex items-center gap-1">
                        <Headphones className="h-3 w-3" /> Audio
                      </span>
                    )}
                    {formatDuration(story.duration_seconds) && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDuration(story.duration_seconds)}
                      </span>
                    )}
                  </div>
                  {story.source_name && (
                    <p className="text-xs text-muted-foreground">Source: {story.source_name}</p>
                  )}
                  {comprehensionMap.get(story.id) && (
                    <ComprehensionBar
                      comprehension={comprehensionMap.get(story.id)!}
                      className="mb-0 pt-1"
                    />
                  )}
                </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            className="py-16"
            title={justRightOnly ? 'Nothing in your sweet spot yet' : 'No stories available'}
            body={
              justRightOnly
                ? 'No story here sits in your comfortable range right now. Turn the filter off to see everything.'
                : 'Check back soon for authentic Arabic reading material.'
            }
          >
            {justRightOnly && (
              <Button variant="outline" onClick={() => setJustRightOnly(false)}>
                Show all stories
              </Button>
            )}
          </EmptyState>
        )}
      </div>
    </AppShell>
  );
};

export default ReadingLibrary;
