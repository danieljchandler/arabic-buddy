import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import lahjaLogo from "@/assets/lahja-logo.png";

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

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppShell>
      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-10">
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

      {/* Tagline */}
      <div className="mb-10 text-center" />

      {/* New Words - main CTA */}
      <button
        onClick={() => navigate("/learn")}
        className={cn(
          "w-full mb-6 p-6 rounded-xl",
          "bg-primary text-primary-foreground",
          "flex items-center gap-4",
          "transition-all duration-200",
          "hover:opacity-90 active:scale-[0.98]",
          "shadow-lg"
        )}
      >
        <div className="w-12 h-12 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
          <Sparkles className="h-6 w-6" />
        </div>
        <div className="text-left">
          <p className="text-lg font-bold">New Words</p>
          <p className="text-sm opacity-80">
            {stats ? `${stats.newCount} words to discover` : "Start learning vocabulary"}
          </p>
        </div>
      </button>

      {/* Review - combines all categories */}
      {isAuthenticated && stats && stats.dueCount > 0 && (
        <button
          onClick={() => navigate("/review")}
          className={cn(
            "w-full mb-6 p-5 rounded-xl",
            "bg-card border border-primary/20",
            "flex items-center justify-between",
            "transition-all duration-200",
            "hover:border-primary/40"
          )}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">Review</p>
              <p className="text-sm text-muted-foreground">
                {stats.dueCount} {stats.dueCount === 1 ? "word" : "words"} due
              </p>
            </div>
          </div>
          <div className="px-3 py-1.5 bg-primary/10 rounded-full">
            <span className="text-sm font-semibold text-primary">{stats.dueCount}</span>
          </div>
        </button>
      )}

      {isAuthenticated && stats && stats.dueCount === 0 && stats.learnedCount > 0 && (
        <button
          onClick={() => navigate("/review")}
          className={cn(
            "w-full mb-6 p-5 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-4",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            <Brain className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">All caught up</p>
            <p className="text-sm text-muted-foreground">
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
            "w-full mb-6 p-5 rounded-xl",
            "bg-card border border-border",
            "flex items-center justify-between",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-foreground">My Words</p>
              <p className="text-sm text-muted-foreground">
                {myWordsStats?.dueCount ? `${myWordsStats.dueCount} due for review` : "Saved vocabulary"}
              </p>
            </div>
          </div>
          {myWordsStats && myWordsStats.dueCount > 0 && (
            <div className="px-3 py-1.5 bg-primary/10 rounded-full">
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
            "w-full mb-6 p-5 rounded-xl",
            "bg-card border border-border",
            "flex items-center gap-4",
            "transition-all duration-200",
            "hover:border-primary/20"
          )}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Tutor Upload</p>
            <p className="text-sm text-muted-foreground">
              Extract flashcards from tutor audio
            </p>
          </div>
        </button>
      )}

      {/* Transcription Tool */}
      <button
        onClick={() => navigate("/transcribe")}
        className={cn(
          "w-full mb-6 p-5 rounded-xl",
          "bg-card border border-border",
          "flex items-center gap-4",
          "transition-all duration-200",
          "hover:border-primary/20"
        )}
      >
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Mic className="h-5 w-5 text-primary" />
        </div>
        <div className="text-left">
          <p className="font-semibold text-foreground">Transcribe Audio</p>
          <p className="text-sm text-muted-foreground">
            Convert Arabic audio to text
          </p>
        </div>
      </button>
    </AppShell>
  );
};

export default Index;
