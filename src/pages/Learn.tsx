import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getTopicById } from "@/data/vocabulary";
import { Flashcard } from "@/components/Flashcard";
import { NavigationArrow } from "@/components/NavigationArrow";
import { ProgressDots } from "@/components/ProgressDots";
import { HomeButton } from "@/components/HomeButton";
import { cn } from "@/lib/utils";

const Learn = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const topic = getTopicById(topicId || "");

  useEffect(() => {
    if (!topic) {
      navigate("/");
    }
  }, [topic, navigate]);

  if (!topic) {
    return null;
  }

  const currentWord = topic.words[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === topic.words.length - 1;

  const goNext = () => {
    if (!isLast) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const goPrevious = () => {
    if (!isFirst) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;

    if (Math.abs(diff) > 50) {
      if (diff > 0 && !isLast) {
        goNext();
      } else if (diff < 0 && !isFirst) {
        goPrevious();
      }
    }

    setTouchStart(null);
  };

  return (
    <div
      className="min-h-screen bg-background flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <HomeButton />
        <div className={cn(
          "px-6 py-3 rounded-2xl",
          topic.gradient
        )}>
          <span className="text-2xl mr-2">{topic.icon}</span>
          <span className="text-xl font-bold text-white">{topic.nameArabic}</span>
        </div>
        <div className="w-14" /> {/* Spacer for alignment */}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        {/* Flashcard */}
        <div className="w-full max-w-md mb-12">
          <Flashcard word={currentWord} gradient={topic.gradient} />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <NavigationArrow
            direction="left"
            onClick={goPrevious}
            disabled={isFirst}
          />
          <NavigationArrow
            direction="right"
            onClick={goNext}
            disabled={isLast}
          />
        </div>

        {/* Progress */}
        <ProgressDots
          total={topic.words.length}
          current={currentIndex}
          gradient={topic.gradient}
        />

        {/* Card counter */}
        <p className="mt-4 text-muted-foreground font-semibold text-lg">
          {currentIndex + 1} / {topic.words.length}
        </p>
      </div>

      {/* Celebration when finished */}
      {isLast && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2">
          <div className={cn(
            "px-8 py-4 rounded-2xl",
            topic.gradient,
            "shadow-button animate-bounce-gentle"
          )}>
            <span className="text-xl font-bold text-white">
              🎉 أحسنت! Great job! 🎉
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Learn;
