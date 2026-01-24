import { TopicWithWords, VocabularyWord } from "@/hooks/useTopic";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trophy, RotateCcw, Home, CheckCircle2, XCircle } from "lucide-react";

interface QuizResultsProps {
  topic: TopicWithWords;
  quizState: {
    score: number;
    answers: { word: VocabularyWord; correct: boolean; userAnswer: string }[];
  };
  onRestart: () => void;
  onHome: () => void;
}

export const QuizResults = ({ topic, quizState, onRestart, onHome }: QuizResultsProps) => {
  const percentage = Math.round((quizState.score / quizState.answers.length) * 100);
  
  let message = "";
  let emoji = "";
  
  if (percentage === 100) {
    message = "Perfect! ممتاز!";
    emoji = "🏆";
  } else if (percentage >= 80) {
    message = "Great job! أحسنت!";
    emoji = "🌟";
  } else if (percentage >= 60) {
    message = "Good effort! جيد!";
    emoji = "👍";
  } else if (percentage >= 40) {
    message = "Keep practicing! استمر!";
    emoji = "💪";
  } else {
    message = "Try again! حاول مرة أخرى!";
    emoji = "📚";
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center p-4">
        <div className={cn("px-6 py-3 rounded-2xl", `bg-gradient-to-br ${topic.gradient}`)}>
          <span className="text-2xl mr-2">{topic.icon}</span>
          <span className="text-xl font-bold text-white">{topic.name_arabic}</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-start px-4 py-8 overflow-auto">
        {/* Score card */}
        <div className={cn(
          "w-full max-w-md p-8 rounded-3xl text-center mb-8",
          "bg-card shadow-card"
        )}>
          <p className="text-6xl mb-4">{emoji}</p>
          <h2 className="text-2xl font-bold mb-2">{message}</h2>
          
          <div className={cn(
            "text-6xl font-black my-6",
            `bg-gradient-to-r ${topic.gradient} bg-clip-text text-transparent`
          )}>
            {quizState.score} / {quizState.answers.length}
          </div>
          
          <p className="text-xl text-muted-foreground">
            {percentage}% correct
          </p>
          
          {/* Progress ring */}
          <div className="relative w-32 h-32 mx-auto mt-6">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="currentColor"
                strokeWidth="12"
                fill="none"
                className="text-muted"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="url(#gradient)"
                strokeWidth="12"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${percentage * 3.52} 352`}
                className="transition-all duration-1000"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="100%" stopColor="hsl(var(--secondary))" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Trophy className="h-10 w-10 text-primary" />
            </div>
          </div>
        </div>

        {/* Answer review */}
        <div className="w-full max-w-md mb-8">
          <h3 className="text-lg font-bold mb-4 text-center">Review Answers</h3>
          <div className="space-y-2">
            {quizState.answers.map((answer, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-2xl",
                  answer.correct ? "bg-green-50" : "bg-red-50"
                )}
              >
                {answer.correct ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" dir="rtl">
                    {answer.word.word_arabic}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {answer.correct ? (
                      answer.word.word_english
                    ) : (
                      <>
                        <span className="text-red-600 line-through">{answer.userAnswer}</span>
                        {" → "}
                        <span className="text-green-600">{answer.word.word_english}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="w-full max-w-md flex gap-4">
          <Button
            onClick={onRestart}
            variant="outline"
            className="flex-1 py-6 text-lg font-bold rounded-2xl"
          >
            <RotateCcw className="h-5 w-5 mr-2" />
            Try Again
          </Button>
          <Button
            onClick={onHome}
            className={cn(
              "flex-1 py-6 text-lg font-bold rounded-2xl",
              `bg-gradient-to-r ${topic.gradient}`,
              "text-white"
            )}
          >
            <Home className="h-5 w-5 mr-2" />
            Home
          </Button>
        </div>
      </div>
    </div>
  );
};
