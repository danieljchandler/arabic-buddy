import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap, Laugh, Play, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import lahjaLogo from "@/assets/lahja-logo.png";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/videoEmbed";

const DiscoverPreviewCard = ({ video, onClick }: { video: any; onClick: () => void }) => {
  const [showOverlay, setShowOverlay] = useState(true);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl overflow-hidden border-2 border-primary/20 bg-card",
        "text-left transition-all duration-200",
        "hover:shadow-xl hover:border-primary/40 active:scale-[0.99]",
        "shadow-lg"
      )}
    >
      {/* Video thumbnail styled like a social feed post */}
      <div className="relative aspect-[9/10] bg-foreground/5 overflow-hidden">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Play className="h-16 w-16 text-muted-foreground/20" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/10 to-transparent" />

        {/* Play indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center backdrop-blur-sm shadow-2xl">
            <Play className="h-7 w-7 text-primary-foreground fill-primary-foreground ml-1" />
          </div>
        </div>

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="font-bold text-lg text-background leading-tight mb-2 line-clamp-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            {video.title}
          </h3>
          {video.title_arabic && (
            <p className="text-background/80 text-base mb-3 line-clamp-1" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>
              {video.title_arabic}
            </p>
          )}
          <div className="flex gap-1.5 flex-wrap">
            <Badge className="bg-primary/80 text-primary-foreground border-none text-xs backdrop-blur-sm">
              {video.dialect}
            </Badge>
            <Badge className="bg-background/20 text-background border-none text-xs backdrop-blur-sm">
              {video.difficulty}
            </Badge>
            {video.duration_seconds && (
              <Badge className="bg-background/20 text-background border-none text-xs backdrop-blur-sm">
                {formatDuration(video.duration_seconds)}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* CTA bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Start Watching</span>
        </div>
        <ChevronRight className="h-4 w-4 text-primary" />
      </div>
    </button>
  );
};

const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    isAuthenticated,
    signOut,
    loading: authLoading
  } = useAuth();
  const { data: myWordsStats } = useUserVocabularyDueCount();
  const { data: stats } = useReviewStats();
  const { data: discoverVideos } = useDiscoverVideos();

  // Rotate through videos for the preview
  const [previewIndex, setPreviewIndex] = useState(0);
  useEffect(() => {
    if (!discoverVideos?.length) return;
    const interval = setInterval(() => {
      setPreviewIndex((i) => (i + 1) % discoverVideos.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [discoverVideos]);

  const previewVideo = discoverVideos?.[previewIndex];

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppShell>
      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-8">
        <img src={lahjaLogo} alt="Lahja" className="h-24" />
        
        <div className="flex items-center gap-3">
          {!authLoading && (isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email?.split("@")[0]}
              </span>
              <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground" title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-muted-foreground hover:text-foreground">
              <LogIn className="h-4 w-4 mr-1.5" />
              Login
            </Button>
          ))}

          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-muted-foreground/50 hover:text-muted-foreground" title="Admin">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ===== DISCOVER - Hero Section ===== */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            Discover Videos
          </h2>
          <button
            onClick={() => navigate("/discover")}
            className="text-sm font-medium text-primary hover:underline flex items-center gap-0.5"
          >
            See all <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {previewVideo ? (
          <DiscoverPreviewCard
            video={previewVideo}
            onClick={() => navigate(`/discover/${previewVideo.id}`)}
          />
        ) : (
          <button
            onClick={() => navigate("/discover")}
            className={cn(
              "w-full p-8 rounded-2xl",
              "bg-primary text-primary-foreground",
              "flex flex-col items-center gap-3",
              "transition-all duration-200",
              "hover:opacity-90 active:scale-[0.98]",
              "shadow-lg"
            )}
          >
            <Play className="h-10 w-10" />
            <p className="text-lg font-bold">Discover Arabic Videos</p>
            <p className="text-sm opacity-80">Watch with synced subtitles & translations</p>
          </button>
        )}
      </div>

      {/* ===== Other sections ===== */}
      <div className="space-y-3">
        {/* New Words */}
        <button
          onClick={() => navigate("/learn")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-primary text-primary-foreground",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:opacity-90 active:scale-[0.98]",
            "shadow-md"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-left">
            <p className="font-bold">New Words</p>
            <p className="text-xs opacity-80">
              {stats ? `${stats.newCount} words to discover` : "Start learning vocabulary"}
            </p>
          </div>
        </button>

        {/* Review */}
        {isAuthenticated && stats && stats.dueCount > 0 && (
          <button
            onClick={() => navigate("/review")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-card border border-primary/20",
              "flex items-center justify-between",
              "transition-all duration-200",
              "hover:border-primary/40"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Review</p>
                <p className="text-xs text-muted-foreground">
                  {stats.dueCount} {stats.dueCount === 1 ? "word" : "words"} due
                </p>
              </div>
            </div>
            <div className="px-2.5 py-1 bg-primary/10 rounded-full">
              <span className="text-sm font-semibold text-primary">{stats.dueCount}</span>
            </div>
          </button>
        )}

        {isAuthenticated && stats && stats.dueCount === 0 && stats.learnedCount > 0 && (
          <button
            onClick={() => navigate("/review")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-card border border-border",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-primary/20"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Brain className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">All caught up</p>
              <p className="text-xs text-muted-foreground">
                {stats.learnedCount} learned · {stats.masteredCount} mastered
              </p>
            </div>
          </button>
        )}

        {/* My Words */}
        {isAuthenticated && (
          <button
            onClick={() => navigate("/my-words")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-card border border-border",
              "flex items-center justify-between",
              "transition-all duration-200",
              "hover:border-primary/20"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">My Words</p>
                <p className="text-xs text-muted-foreground">
                  {myWordsStats?.dueCount ? `${myWordsStats.dueCount} due for review` : "Saved vocabulary"}
                </p>
              </div>
            </div>
            {myWordsStats && myWordsStats.dueCount > 0 && (
              <div className="px-2.5 py-1 bg-primary/10 rounded-full">
                <span className="text-sm font-semibold text-primary">{myWordsStats.dueCount}</span>
              </div>
            )}
          </button>
        )}

        {/* Tutor Upload */}
        {isAuthenticated && (
          <button
            onClick={() => navigate("/tutor-upload")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-card border border-border",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-primary/20"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Tutor Upload</p>
              <p className="text-xs text-muted-foreground">
                Extract flashcards from tutor audio
              </p>
            </div>
          </button>
        )}

        {/* Meme Analyzer */}
        <button
          onClick={() => navigate("/meme")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Laugh className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Meme Analyzer</p>
            <p className="text-xs text-muted-foreground">
              Break down Arabic memes
            </p>
          </div>
        </button>

        {/* Transcription Tool */}
        <button
          onClick={() => navigate("/transcribe")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Mic className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Transcribe Audio</p>
            <p className="text-xs text-muted-foreground">
              Convert Arabic audio to text
            </p>
          </div>
        </button>
      </div>
    </AppShell>
  );
};

export default Index;
