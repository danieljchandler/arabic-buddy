import { useNavigate } from "react-router-dom";
import { useTopics } from "@/hooks/useTopics";
import { TopicCard } from "@/components/TopicCard";
import { Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();
  const { data: topics, isLoading, error } = useTopics();

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
      {/* Admin link */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/admin')}
          className="opacity-30 hover:opacity-100 transition-opacity"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-black text-foreground mb-2">
          تعلم العربية 🌟
        </h1>
        <p className="text-xl text-muted-foreground font-semibold">
          Learn Arabic!
        </p>
      </div>

      {/* Topic Grid */}
      <div className="max-w-4xl mx-auto">
        {topics && topics.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
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
        ) : (
          <div className="text-center py-12">
            <p className="text-6xl mb-4">📚</p>
            <p className="text-xl text-muted-foreground mb-4">No topics yet!</p>
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

      {/* Footer decoration */}
      {topics && topics.length > 0 && (
        <div className="text-center mt-12">
          <p className="text-6xl">📚✨🎓</p>
        </div>
      )}
    </div>
  );
};

export default Index;
