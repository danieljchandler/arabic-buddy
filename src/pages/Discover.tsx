import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { useDiscoverFeed, type FeedItem } from "@/hooks/useDiscoverFeed";
import type { DiscoverVideo } from "@/hooks/useDiscoverVideos";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Play, Shuffle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/videoEmbed";
import { ContentRequestBar } from "@/components/discover/ContentRequestBar";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DIALECTS = ["All", "Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"];
const DIFFICULTIES = ["All", "Beginner", "Intermediate", "Advanced", "Expert"];

function difficultyColor(d: string) {
  switch (d) {
    case "Beginner": return "bg-primary/10 text-primary border-primary/20";
    case "Intermediate": return "bg-accent/10 text-accent border-accent/20";
    case "Advanced": return "bg-secondary/10 text-secondary border-secondary/20";
    case "Expert": return "bg-destructive/10 text-destructive border-destructive/20";
    default: return "bg-muted text-muted-foreground";
  }
}

function comprehensionTone(c: number) {
  if (c >= 0.8) return "bg-emerald-500";
  if (c >= 0.5) return "bg-amber-500";
  return "bg-rose-500";
}

interface CardProps {
  video: DiscoverVideo;
  onClick: () => void;
  feed?: FeedItem;
}

function VideoCard({ video, onClick, feed }: CardProps) {
  return (
    <button
      onClick={onClick}
      aria-label={`Video: ${video.title} — ${video.dialect}, ${video.difficulty}`}
      className={cn(
        "rounded-xl overflow-hidden border border-border bg-card",
        "text-left transition-all duration-200",
        "hover:shadow-md hover:border-primary/20 active:scale-[0.98]",
      )}
    >
      <div className="relative aspect-video bg-muted">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {video.duration_seconds && (
          <span className="absolute bottom-2 right-2 bg-foreground/80 text-background text-xs px-1.5 py-0.5 rounded">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
        {feed && (
          <div className="absolute top-2 left-2 bg-background/90 backdrop-blur text-foreground text-[11px] font-medium px-2 py-0.5 rounded-full border border-border flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            {feed.reason}
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm text-foreground line-clamp-2 mb-2">
          {video.title}
        </h3>
        {feed && (
          <div className="mb-2" title={`Comprehension ~ ${Math.round(feed.comprehension * 100)}%`}>
            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full transition-all", comprehensionTone(feed.comprehension))}
                style={{ width: `${Math.max(6, Math.round(feed.comprehension * 100))}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
          <Badge variant="outline" className={cn("text-xs", difficultyColor(video.difficulty))}>
            {video.difficulty}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">{video.platform}</Badge>
        </div>
      </div>
    </button>
  );
}

const Discover = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { user } = useAuth();
  const [tab, setTab] = useState<string>(user ? "feed" : "browse");
  const [seed, setSeed] = useState(() => Math.floor(Date.now() / (15 * 60 * 1000)));

  // Browse state
  const [search, setSearch] = useState("");
  const [dialect, setDialect] = useState<string>(activeDialect);
  const [difficulty, setDifficulty] = useState("All");

  const { data: browseVideos, isLoading: isBrowseLoading } = useDiscoverVideos({
    dialect: dialect === "All" ? undefined : dialect,
    difficulty: difficulty === "All" ? undefined : difficulty,
    search: search || undefined,
  });

  const { data: feed, isLoading: isFeedLoading, isFetching: isFeedFetching } = useDiscoverFeed(seed);

  const feedItems = useMemo(() => feed?.items ?? [], [feed]);

  return (
    <AppShell>
      <HomeButton />

      <h1
        className="text-2xl font-bold text-foreground mb-2 inline-flex items-center gap-2"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        Discover
        <InfoHint {...PAGE_HINTS["discover"]} size="md" />
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Watch Arabic videos with synced subtitles and translations
      </p>

      <div className="mb-6">
        <ContentRequestBar />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="feed" disabled={!user}>
            <Sparkles className="h-4 w-4 mr-1.5" />
            For You
          </TabsTrigger>
          <TabsTrigger value="browse">Browse</TabsTrigger>
        </TabsList>

        <TabsContent value="feed" className="mt-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">
              {feed?.coldStart
                ? "Trending picks — take the placement quiz to personalize."
                : "Ranked by what you know and how you watch."}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeed((s) => s + 1)}
              disabled={isFeedFetching}
            >
              <Shuffle className={cn("h-4 w-4 mr-1.5", isFeedFetching && "animate-spin")} />
              Shuffle
            </Button>
          </div>

          {isFeedLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : feedItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {feedItems.map((item) => (
                <VideoCard
                  key={item.video_id}
                  video={item.video}
                  feed={item}
                  onClick={() => navigate(`/discover/${item.video_id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Sparkles className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No personalized picks yet</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Watch a few videos and save vocab to power your feed.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="browse" className="mt-0">
          <div className="space-y-3 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search videos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search videos"
              />
            </div>
            <div className="flex gap-2">
              <Select value={dialect} onValueChange={setDialect}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Dialect" />
                </SelectTrigger>
                <SelectContent>
                  {DIALECTS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Level" />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isBrowseLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : browseVideos && browseVideos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {browseVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onClick={() => navigate(`/discover/${video.id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Play className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No videos found</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Check back later for new content
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
};

export default Discover;
