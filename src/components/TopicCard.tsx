import { cn } from "@/lib/utils";

interface TopicCardTopic {
  id: string;
  name: string;
  nameArabic: string;
  icon: string;
  gradient: string;
  wordCount?: number;
}

interface TopicCardProps {
  topic: TopicCardTopic;
  onClick: () => void;
}

export const TopicCard = ({ topic, onClick }: TopicCardProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full aspect-square rounded-2xl p-6",
        "flex flex-col items-center justify-center gap-3",
        "transform transition-all duration-300",
        "hover:scale-105 active:scale-95",
        "shadow-card hover:shadow-button",
        `bg-gradient-to-br ${topic.gradient}`
      )}
    >
      <span className="text-5xl md:text-6xl animate-float">
        {topic.icon}
      </span>
      <div className="text-center">
        <p className="text-xl md:text-2xl font-bold text-white drop-shadow-md font-arabic">
          {topic.nameArabic}
        </p>
        <p className="text-sm md:text-base font-medium text-white/80">
          {topic.name}
        </p>
      </div>
      {topic.wordCount !== undefined && (
        <div className="absolute bottom-4 right-4 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
          <span className="text-sm font-semibold text-white">
            {topic.wordCount}
          </span>
        </div>
      )}
    </button>
  );
};
