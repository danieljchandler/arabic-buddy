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

// Brand-aligned gradient mapping for legacy gradients
const brandGradients: Record<string, string> = {
  // Map old Tailwind gradients to brand gradients
  "from-yellow-400 to-orange-500": "bg-gradient-sand",
  "from-orange-400 to-red-500": "bg-gradient-red",
  "from-green-400 to-emerald-600": "bg-gradient-green",
  "from-blue-400 to-cyan-500": "bg-gradient-indigo",
  "from-purple-400 to-pink-500": "bg-gradient-indigo",
  "from-pink-400 to-rose-500": "bg-gradient-red",
  "from-teal-400 to-green-500": "bg-gradient-olive",
  "from-indigo-400 to-purple-500": "bg-gradient-indigo",
  // Additional legacy mappings
  "from-green-500 to-green-700": "bg-gradient-green",
  "from-emerald-500 to-emerald-700": "bg-gradient-green",
  "from-teal-500 to-teal-700": "bg-gradient-green",
  "from-yellow-500 to-yellow-700": "bg-gradient-sand",
  "from-amber-500 to-amber-700": "bg-gradient-sand",
  "from-orange-400 to-orange-600": "bg-gradient-sand",
  "from-lime-500 to-lime-700": "bg-gradient-olive",
  "from-blue-500 to-blue-700": "bg-gradient-indigo",
  "from-slate-500 to-slate-700": "bg-gradient-indigo",
  "from-gray-500 to-gray-700": "bg-gradient-charcoal",
  "from-red-500 to-red-700": "bg-gradient-red",
  "from-rose-500 to-rose-700": "bg-gradient-red",
  "from-pink-500 to-pink-700": "bg-gradient-red",
  "from-purple-500 to-purple-700": "bg-gradient-indigo",
  "from-violet-500 to-violet-700": "bg-gradient-indigo",
  "from-indigo-500 to-indigo-700": "bg-gradient-indigo",
};

// Cycle through brand gradients for topics
const brandGradientCycle = [
  "bg-gradient-green",
  "bg-gradient-sand", 
  "bg-gradient-olive",
  "bg-gradient-indigo",
  "bg-gradient-red",
  "bg-gradient-charcoal",
];

export const TopicCard = ({ topic, onClick }: TopicCardProps) => {
  // Try to map existing gradient to brand gradient, or use cycle based on name hash
  const getBrandGradient = () => {
    // Check if it's already a brand gradient
    if (topic.gradient.startsWith("bg-gradient-")) {
      return topic.gradient;
    }
    
    // Try to map from old gradient
    const mapped = brandGradients[topic.gradient];
    if (mapped) return mapped;
    
    // Fallback: use consistent gradient based on topic name hash
    const hash = topic.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return brandGradientCycle[hash % brandGradientCycle.length];
  };

  const gradientClass = getBrandGradient();

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full aspect-square rounded-2xl p-6",
        "flex flex-col items-center justify-center gap-3",
        "transform transition-all duration-300",
        "hover:scale-[1.03] active:scale-[0.97]",
        "shadow-card hover:shadow-button",
        "border border-white/10",
        gradientClass
      )}
    >
      <span className="text-5xl md:text-6xl">
        {topic.icon}
      </span>
      <div className="text-center">
        <p className="text-xl md:text-2xl font-semibold text-white drop-shadow-md font-arabic">
          {topic.nameArabic}
        </p>
        <p className="text-sm md:text-base font-medium text-white/85 font-heading">
          {topic.name}
        </p>
      </div>
      {topic.wordCount !== undefined && (
        <div className="absolute bottom-4 right-4 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 border border-white/10">
          <span className="text-sm font-semibold text-white">
            {topic.wordCount}
          </span>
        </div>
      )}
    </button>
  );
};
