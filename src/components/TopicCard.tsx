import { cn } from "@/lib/utils";
import type { Topic } from "@/data/vocabulary";

interface TopicCardProps {
  topic: Topic;
  onClick: () => void;
}

export const TopicCard = ({ topic, onClick }: TopicCardProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full aspect-square rounded-3xl p-6",
        "flex flex-col items-center justify-center gap-3",
        "transform transition-all duration-300",
        "hover:scale-105 active:scale-95",
        "shadow-card hover:shadow-button",
        topic.gradient
      )}
    >
      <span className="text-6xl md:text-7xl animate-bounce-gentle">
        {topic.icon}
      </span>
      <div className="text-center">
        <p className="text-2xl md:text-3xl font-bold text-white drop-shadow-md">
          {topic.nameArabic}
        </p>
        <p className="text-sm md:text-base font-semibold text-white/80">
          {topic.name}
        </p>
      </div>
      <div className="absolute bottom-4 right-4 bg-white/30 backdrop-blur-sm rounded-full px-3 py-1">
        <span className="text-sm font-bold text-white">
          {topic.words.length}
        </span>
      </div>
    </button>
  );
};
