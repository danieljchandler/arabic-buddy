import { useNavigate } from "react-router-dom";
import { topics } from "@/data/vocabulary";
import { TopicCard } from "@/components/TopicCard";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background py-8 px-4">
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {topics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onClick={() => navigate(`/learn/${topic.id}`)}
            />
          ))}
        </div>
      </div>

      {/* Footer decoration */}
      <div className="text-center mt-12">
        <p className="text-6xl">📚✨🎓</p>
      </div>
    </div>
  );
};

export default Index;
