import { useNavigate } from 'react-router-dom';
import { usePublishedStories } from '@/hooks/useInteractiveStories';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingPanel } from '@/components/loading/LoadingPanel';
import { PageCorner } from '@/components/shell/PageCorner';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/InfoHint';
import { EmptyState } from '@/components/shared/EmptyState';
import { PAGE_HINTS } from '@/lib/pageHints';

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: 'bg-green-500/10 text-green-700 border-green-500/20',
  Intermediate: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  Advanced: 'bg-red-500/10 text-red-700 border-red-500/20',
};

const Stories = () => {
  const navigate = useNavigate();
  const { data: stories, isLoading } = usePublishedStories();

  return (
    <AppShell>
      <div className="mb-6"><PageCorner /></div>

      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-heading mb-1 inline-flex items-center gap-2 justify-center">Interactive Stories <InfoHint {...PAGE_HINTS["stories"]} size="md" /></h1>
          <p className="text-muted-foreground">Choose your adventure and learn Arabic through immersive scenarios</p>
        </div>

        {isLoading ? (
          <LoadingPanel variant="inline" task="story" className="py-16" />
        ) : stories && stories.length > 0 ? (
          <div className="space-y-3">
            {stories.map((story) => (
              <button
                key={story.id}
                onClick={() => navigate(`/stories/${story.id}`)}
                className={cn(
                  'w-full text-left rounded-2xl border-2 border-border bg-card overflow-hidden',
                  'transition-all duration-200 hover:border-primary/40 hover:shadow-elegant',
                  'active:scale-[0.98] group'
                )}
              >
                {/* Watercolor cover, generated per story from the admin
                    console (generate-story-cover). Rows without one keep the
                    text-only layout. */}
                {story.cover_image_url && (
                  <img
                    src={story.cover_image_url}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    draggable={false}
                    className="aspect-[5/2] w-full object-cover select-none"
                  />
                )}
                <div className="flex items-start justify-between gap-3 p-5">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg group-hover:text-primary transition-colors">
                      {story.title}
                    </h3>
                    {story.title_arabic && (
                      <p className="text-base text-muted-foreground mt-0.5" dir="rtl">
                        {story.title_arabic}
                      </p>
                    )}
                    {story.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {story.description}
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-3">
                      <Badge variant="outline" className="text-xs">{story.dialect}</Badge>
                      <Badge variant="outline" className={cn('text-xs', DIFFICULTY_COLORS[story.difficulty])}>
                        {story.difficulty}
                      </Badge>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors mt-1 shrink-0" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            className="py-16"
            title="No stories yet"
            body="No stories available yet. Check back soon!"
          />
        )}
      </div>
    </AppShell>
  );
};

export default Stories;
