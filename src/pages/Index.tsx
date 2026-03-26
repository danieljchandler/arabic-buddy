import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap, Laugh, Play, ChevronRight, Twitter, MessageCircleQuestion, Compass, MessageSquare, Globe2, Headphones, Trophy, FileText, Flame, BarChart3, PenTool, Gamepad2, Users, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { XPDisplay, StreakDisplay, WeeklyGoalCard, AchievementsGrid } from "@/components/gamification";
import lahjaLogo from "@/assets/lahja-logo.png";
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { formatDuration } from "@/lib/videoEmbed";
import { useDialect, DialectModule } from "@/contexts/DialectContext";

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
      <div className="relative aspect-[4/3] bg-foreground/5 overflow-hidden">
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

const DIALECT_MODULES: { id: DialectModule; label: string; flag: string }[] = [
  { id: 'Gulf', label: 'Gulf Arabic', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' },
];

const Index = () => {
  const navigate = useNavigate();
  const { activeDialect, setDialect } = useDialect();
  const {
    user,
    isAuthenticated,
    signOut,
    loading: authLoading
  } = useAuth();
  const { data: myWordsStats } = useUserVocabularyDueCount();
  const { data: stats } = useReviewStats();
  const { data: discoverVideos } = useDiscoverVideos({ dialect: activeDialect });

  const [previewIndex, setPreviewIndex] = useState(0);
  const previewVideos = discoverVideos?.slice(0, 5) ?? [];
  const previewVideo = previewVideos[previewIndex];

  // Check onboarding status for authenticated users
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    const checkOnboarding = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && !(data as any).onboarding_completed) {
        navigate('/onboarding');
      }
    };
    checkOnboarding();
  }, [isAuthenticated, authLoading, user, navigate]);
  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppShell>
      {/* Dialect Module Switcher */}
      <div className="flex gap-2 mb-4">
        {DIALECT_MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => setDialect(mod.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 transition-all duration-200 font-medium text-sm",
              activeDialect === mod.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            )}
          >
            <span className="text-lg">{mod.flag}</span>
            <span>{mod.label}</span>
          </button>
        ))}
      </div>

      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-4">
        <img src={lahjaLogo} alt="Lahja" className="h-20" />
        
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

          {isAuthenticated && (
            <>
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground" title="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-muted-foreground/50 hover:text-muted-foreground" title="Admin">
            <GraduationCap className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ===== GAMIFICATION STATS (for logged in users) ===== */}
      {isAuthenticated && (
        <div className="space-y-3 mb-6">
          <div className="flex gap-3">
            <XPDisplay compact className="flex-1" />
            <StreakDisplay compact />
          </div>
          <WeeklyGoalCard />
          <AchievementsGrid />

          {/* Daily Challenge + Leaderboard + Friends + Analytics row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => navigate("/daily-challenge")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-orange-500/10 to-red-500/10 border border-orange-500/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-orange-500/40 active:scale-[0.98]"
              )}
            >
              <Flame className="h-5 w-5 text-orange-500" />
              <p className="font-semibold text-foreground text-xs">Challenge</p>
            </button>
            <button
              onClick={() => navigate("/leaderboard")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-yellow-500/10 to-orange-500/10 border border-yellow-500/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-yellow-500/40 active:scale-[0.98]"
              )}
            >
              <Trophy className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <p className="font-semibold text-foreground text-xs">Leaderboard</p>
            </button>
            <button
              onClick={() => navigate("/battles")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-red-500/10 to-pink-500/10 border border-red-500/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-red-500/40 active:scale-[0.98]"
              )}
            >
              <Swords className="h-5 w-5 text-red-500" />
              <p className="font-semibold text-foreground text-xs">Battles</p>
            </button>
            <button
              onClick={() => navigate("/friends")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-primary/10 to-primary/5 border border-primary/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-primary/40 active:scale-[0.98]"
              )}
            >
              <Users className="h-5 w-5 text-primary" />
              <p className="font-semibold text-foreground text-xs">Friends</p>
            </button>
            <button
              onClick={() => navigate("/analytics")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-blue-500/10 to-indigo-500/10 border border-blue-500/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-blue-500/40 active:scale-[0.98]"
              )}
            >
              <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <p className="font-semibold text-foreground text-xs">Analytics</p>
            </button>
            <button
              onClick={() => navigate("/my-path")}
              className={cn(
                "p-3 rounded-xl",
                "bg-gradient-to-b from-emerald-500/10 to-teal-500/10 border border-emerald-500/20",
                "flex flex-col items-center gap-1.5",
                "transition-all duration-200",
                "hover:border-emerald-500/40 active:scale-[0.98]"
              )}
            >
              <Compass className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="font-semibold text-foreground text-xs">My Path</p>
            </button>
          </div>
        </div>
      )}

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
          <div>
            <DiscoverPreviewCard
              video={previewVideo}
              onClick={() => navigate(`/discover/${previewVideo.id}`)}
            />
            {previewVideos.length > 1 && (
              <div className="flex justify-center gap-2 mt-3">
                {previewVideos.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => setPreviewIndex(i)}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full transition-all duration-200",
                      i === previewIndex
                        ? "bg-primary scale-125"
                        : "bg-primary/30 hover:bg-primary/50"
                    )}
                    aria-label={`Video ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "w-full p-8 rounded-2xl",
              "bg-muted/50 border-2 border-dashed border-primary/20",
              "flex flex-col items-center gap-3",
              "text-center"
            )}
          >
            <Play className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-lg font-bold text-foreground">Coming Soon</p>
            <p className="text-sm text-muted-foreground">
              {activeDialect === 'Egyptian' ? 'Egyptian Arabic' : activeDialect} videos are on the way!
            </p>
          </div>
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

        {/* Speaking Practice Section */}
        <div className="pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Speaking Practice
          </p>
          
          {/* Pronunciation Practice */}
          <button
            onClick={() => navigate("/pronunciation")}
            className={cn(
              "w-full p-4 rounded-xl mb-2",
              "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:opacity-90 active:scale-[0.98]",
              "shadow-md"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center shrink-0">
              <Mic className="h-5 w-5" />
            </div>
            <div className="text-left">
              <p className="font-bold">Pronunciation Practice</p>
              <p className="text-xs opacity-80">
                Record yourself & get AI feedback
              </p>
            </div>
          </button>

          {/* Conversation Simulator */}
          <button
            onClick={() => navigate("/conversation")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-card border border-primary/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-primary/40"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Conversation Simulator</p>
              <p className="text-xs text-muted-foreground">
                Practice real-world Arabic scenarios
              </p>
            </div>
          </button>

          {/* Interactive Stories */}
          <button
            onClick={() => navigate("/stories")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-amber-500/40 active:scale-[0.98]"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-5 w-5 text-amber-600" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Interactive Stories</p>
              <p className="text-xs text-muted-foreground">
                Choose-your-adventure in Arabic
              </p>
            </div>
          </button>
        </div>

        {/* Grammar Drills */}
        <div className="pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Grammar
          </p>
          <button
            onClick={() => navigate("/grammar")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-violet-500/40 active:scale-[0.98]"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <PenTool className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Grammar Drills</p>
              <p className="text-xs text-muted-foreground">
                AI-powered conjugation, pronouns & more
              </p>
            </div>
          </button>
        </div>

        {/* Vocabulary Games */}
        <div className="pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Games
          </p>
          <button
            onClick={() => navigate("/vocab-games")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-primary/40 active:scale-[0.98]"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Gamepad2 className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Vocabulary Games</p>
              <p className="text-xs text-muted-foreground">
                Word matching, memory cards & fill-in-the-blank
              </p>
            </div>
          </button>
        </div>

        {/* Listening Practice */}
        <div className="pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Comprehension
          </p>
          
          {/* Listening Practice */}
          <button
            onClick={() => navigate("/listening")}
            className={cn(
              "w-full p-4 rounded-xl mb-2",
              "bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-cyan-500/40 active:scale-[0.98]"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <Headphones className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Listening Practice</p>
              <p className="text-xs text-muted-foreground">
                Dictation, comprehension & speed drills
              </p>
            </div>
          </button>

          {/* Reading Practice */}
          <button
            onClick={() => navigate("/reading")}
            className={cn(
              "w-full p-4 rounded-xl",
              "bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/20",
              "flex items-center gap-3",
              "transition-all duration-200",
              "hover:border-indigo-500/40 active:scale-[0.98]"
            )}
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Reading Practice</p>
              <p className="text-xs text-muted-foreground">
                Passages with tap-to-translate & comprehension quiz
              </p>
            </div>
          </button>
        </div>

        {/* Dialect Compare */}
        <button
          onClick={() => navigate("/dialect-compare")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-gradient-to-r from-emerald-500/10 to-sky-500/10 border border-emerald-500/20",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-emerald-500/40 active:scale-[0.98]"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Globe2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Dialect Compare</p>
            <p className="text-xs text-muted-foreground">
              See how words differ across Gulf, Egyptian & Levantine
            </p>
          </div>
        </button>

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

        {/* Learn from X Post */}
        <button
          onClick={() => navigate("/learn-from-x")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Twitter className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Learn from X Post</p>
            <p className="text-xs text-muted-foreground">
              Analyze Arabic posts from X
            </p>
          </div>
        </button>

        {/* How do I say? */}
        <button
          onClick={() => navigate("/how-do-i-say")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">How do I say…?</p>
            <p className="text-xs text-muted-foreground">
              Translate phrases into {activeDialect === 'Egyptian' ? 'Egyptian Arabic' : 'Gulf Arabic'}
            </p>
          </div>
        </button>

        {/* Culture Guide */}
        <button
          onClick={() => navigate("/culture-guide")}
          className={cn(
            "w-full p-4 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-3",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Compass className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">What should I do?</p>
            <p className="text-xs text-muted-foreground">
              Get culturally appropriate {activeDialect === 'Egyptian' ? 'Egyptian' : 'Gulf'} advice
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
