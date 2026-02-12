import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/videoEmbed";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DIALECTS = ["All", "Gulf", "MSA", "Egyptian", "Levantine", "Maghrebi"];
const DIFFICULTIES = ["All", "Beginner", "Intermediate", "Advanced", "Expert"];

const Discover = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [dialect, setDialect] = useState("All");
  const [difficulty, setDifficulty] = useState("All");

  const { data: videos, isLoading } = useDiscoverVideos({
    dialect: dialect === "All" ? undefined : dialect,
    difficulty: difficulty === "All" ? undefined : difficulty,
    search: search || undefined,
  });

  const difficultyColor = (d: string) => {
    switch (d) {
      case "Beginner": return "bg-primary/10 text-primary border-primary/20";
      case "Intermediate": return "bg-accent/10 text-accent border-accent/20";
      case "Advanced": return "bg-secondary/10 text-secondary border-secondary/20";
      case "Expert": return "bg-destructive/10 text-destructive border-destructive/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <AppShell>
      <HomeButton />

      <h1
        className="text-2xl font-bold text-foreground mb-2"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        Discover
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Watch Arabic videos with synced subtitles and translations
      </p>

      {/* Filters */}
      <div className="space-y-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search videos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
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

      {/* Video Grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : videos && videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {videos.map((video) => (
            <button
              key={video.id}
              onClick={() => navigate(`/discover/${video.id}`)}
              className={cn(
                "rounded-xl overflow-hidden border border-border bg-card",
                "text-left transition-all duration-200",
                "hover:shadow-md hover:border-primary/20 active:scale-[0.98]"
              )}
            >
              {/* Thumbnail */}
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
              </div>

              {/* Info */}
              <div className="p-3">
                <h3 className="font-semibold text-sm text-foreground line-clamp-2 mb-2">
                  {video.title}
                </h3>
                <div className="flex gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {video.dialect}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs", difficultyColor(video.difficulty))}>
                    {video.difficulty}
                  </Badge>
                  <Badge variant="outline" className="text-xs capitalize">
                    {video.platform}
                  </Badge>
                </div>
              </div>
            </button>
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
    </AppShell>
  );
};

export default Discover;
