import { useNavigate } from "react-router-dom";
import { useTopics } from "@/hooks/useTopics";
import { useAuth } from "@/hooks/useAuth";
import { useReviewStats } from "@/hooks/useReview";
import { TopicCard, Button, SectionFrame } from "@/components/design-system";
import { Loader2, Settings, Brain, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import lahjaLogo from "@/assets/lahja-logo.png";

const Index = () => {
  const navigate = useNavigate();
  const { data: topics, isLoading, error } = useTopics();
  const { user, isAuthenticated, signOut, loading: authLoading } = useAuth();
  const { data: stats } = useReviewStats();

  const handleSignOut = async () => {
    await signOut();
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-lg text-destructive mb-4">Error loading topics</p>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Decorative header border pattern */}
      <div 
        className="fixed top-0 left-0 right-0 w-full pointer-events-none z-10"
        style={{
          height: "56px",
          backgroundImage: "url('/assets/lahja-border-primary.png')",
          backgroundPosition: "top center",
          backgroundRepeat: "repeat-x",
        }}
      />
      
      {/* Subtle fade beneath header */}
      <div 
        className="fixed left-0 right-0 w-full pointer-events-none z-10"
        style={{
          top: "56px",
          height: "20px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.03) 0%, transparent 100%)",
        }}
      />
      
      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-10 mt-[72px]">
        <img src={lahjaLogo} alt="Lahja" className="h-12" />
        
        <div className="flex items-center gap-3">
          {!authLoading && (
            isAuthenticated ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user?.email?.split("@")[0]}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  className="text-muted-foreground hover:text-foreground"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/auth")}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogIn className="h-4 w-4 mr-1.5" />
                Login
              </Button>
            )
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="text-muted-foreground/50 hover:text-muted-foreground"
            title="Admin"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tagline */}
      <div className="mb-10 text-center">
        <p className="text-muted-foreground">Learn Arabic the way it's spoken</p>
      </div>

      {/* Review prompt - when logged in with due words */}
      {isAuthenticated && stats && stats.dueCount > 0 && (
        <button
          onClick={() => navigate("/review")}
          className={cn(
            "w-full mb-8 p-5 rounded-xl",
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
              <p className="font-semibold text-foreground">Review Time</p>
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

      {/* Review status - when caught up */}
      {isAuthenticated && stats && stats.dueCount === 0 && stats.learnedCount > 0 && (
        <button
          onClick={() => navigate("/review")}
          className={cn(
            "w-full mb-8 p-5 rounded-xl",
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

      {/* Topic Grid - with subtle watercolor frame */}
      {topics && topics.length > 0 ? (
        <SectionFrame className="py-4">
          <div className="grid grid-cols-2 gap-4 md:gap-6">
            {topics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={{
                  id: topic.id,
                  name: topic.name,
                  nameArabic: topic.name_arabic,
                  icon: topic.icon,
                  gradient: topic.gradient,
                }}
                onClick={() => navigate(`/learn/${topic.id}`)}
              />
            ))}
          </div>
        </SectionFrame>
      ) : (
        <div className="text-center py-16">
          <p className="text-lg text-muted-foreground mb-3">No topics yet</p>
          <p className="text-sm text-muted-foreground mb-6">
            Add vocabulary topics in the admin panel to get started.
          </p>
          <Button onClick={() => navigate("/admin")} variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            Go to Admin
          </Button>
        </div>
      )}
    </AppShell>
  );
};

export default Index;
