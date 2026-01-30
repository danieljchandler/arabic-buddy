import { useNavigate } from "react-router-dom";
import { useTopics } from "@/hooks/useTopics";
import { useAuth } from "@/hooks/useAuth";
import { useReviewStats } from "@/hooks/useReview";
import { TopicCard } from "@/components/TopicCard";
import { Loader2, Settings, Brain, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-destructive mb-4">Error loading topics</p>
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      {/* Top bar with auth and admin */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {!authLoading && (
          isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email?.split('@')[0]}
              </span>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleSignOut}
                className="opacity-60 hover:opacity-100 transition-opacity"
                title="Sign out"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          ) : (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigate('/auth')}
              className="opacity-60 hover:opacity-100 transition-opacity"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Login
            </Button>
          )
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/admin')} 
          className="opacity-30 hover:opacity-100 transition-opacity"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      {/* Header with Logo */}
      <div className="text-center mb-10">
        <img 
          src={lahjaLogo} 
          alt="Lahja - Learn Arabic the way it's spoken" 
          className="h-24 md:h-32 mx-auto mb-4"
        />
        <p className="text-lg text-muted-foreground font-heading font-semibold">
          Learn Arabic the way it's spoken
        </p>
      </div>

      {/* Review Button - shows when logged in with due words */}
      {isAuthenticated && stats && stats.dueCount > 0 && (
        <div className="max-w-4xl mx-auto mb-6">
          <button
            onClick={() => navigate('/review')}
            className={cn(
              "w-full p-4 rounded-2xl",
              "bg-gradient-heritage",
              "shadow-lg",
              "flex items-center justify-between",
              "transform transition-all duration-200",
              "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <div className="text-left">
                <p className="text-lg font-bold text-white">Review Time</p>
                <p className="text-sm text-white/80">
                  {stats.dueCount} {stats.dueCount === 1 ? 'word' : 'words'} due for practice
                </p>
              </div>
            </div>
            <div className="px-4 py-2 bg-white/20 rounded-full">
              <span className="text-xl font-bold text-white">{stats.dueCount}</span>
            </div>
          </button>
        </div>
      )}

      {/* Review Link - shows when logged in with no due words */}
      {isAuthenticated && stats && stats.dueCount === 0 && stats.learnedCount > 0 && (
        <div className="max-w-4xl mx-auto mb-6">
          <button
            onClick={() => navigate('/review')}
            className={cn(
              "w-full p-4 rounded-2xl",
              "bg-card border-2 border-border",
              "shadow-card",
              "flex items-center justify-between",
              "transform transition-all duration-200",
              "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <Brain className="h-6 w-6 text-accent" />
              </div>
              <div className="text-left">
                <p className="text-lg font-bold text-foreground">All caught up</p>
                <p className="text-sm text-muted-foreground">
                  {stats.learnedCount} words learned • {stats.masteredCount} mastered
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Topic Grid */}
      <div className="max-w-4xl mx-auto">
        {topics && topics.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
            {topics.map(topic => (
              <TopicCard 
                key={topic.id} 
                topic={{
                  id: topic.id,
                  name: topic.name,
                  nameArabic: topic.name_arabic,
                  icon: topic.icon,
                  gradient: topic.gradient
                }} 
                onClick={() => navigate(`/learn/${topic.id}`)} 
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-4xl mb-4 opacity-50">📚</p>
            <p className="text-xl text-muted-foreground mb-4">No topics yet</p>
            <p className="text-muted-foreground mb-6">
              Add vocabulary topics in the admin panel to get started.
            </p>
            <Button onClick={() => navigate('/admin')}>
              <Settings className="h-4 w-4 mr-2" />
              Go to Admin Panel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
