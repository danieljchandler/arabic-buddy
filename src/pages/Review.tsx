import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useDueWords,
  useReviewStats,
  useSubmitReview,
} from "@/hooks/useReview";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { useDialect } from "@/contexts/DialectContext";
import { Rating, calculateNextReview } from "@/lib/spacedRepetition";
import { Loader2, Trophy, Brain, Sparkles, LogIn, Shuffle, Eye, Volume2, ImagePlus } from "lucide-react";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";

const DIALECT_FLAGS: Record<string, string> = {
  Gulf: "🇦🇪",
  Egyptian: "🇪🇬",
};

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const [mixAll, setMixAll] = useState(false);

  const { data: dueWords, isLoading: wordsLoading, refetch } = useDueWords(mixAll);
  const { data: stats } = useReviewStats(mixAll);
  const submitReview = useSubmitReview();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  const goToNext = async () => {
    if (!dueWords) return;
    setShowAnswer(false);
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  const handleRate = async (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;
    const word = dueWords[currentIndex];
    const wordCount = dueWords.length;

    await submitReview.mutateAsync({
      wordId: word.id,
      rating,
      currentReview: word.review,
    });

    setSessionCount((prev) => prev + 1);
    setShowAnswer(false);

    // Advance without relying on goToNext (which may read stale dueWords)
    if (currentIndex < wordCount - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  const handleToggleMix = () => {
    setMixAll((prev) => !prev);
    setCurrentIndex(0);
    setSessionCount(0);
    setShowAnswer(false);
  };

  if (authLoading || wordsLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your reviews...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mx-auto mb-6">
            <LogIn className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to track your progress with spaced repetition.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" />
            Login to Review
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!dueWords || dueWords.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleMix}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mixAll
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
              Mix All
            </button>
            {sessionCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{sessionCount}</span>
              </div>
            )}
          </div>
        </div>

        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground mb-3">All Caught Up</h1>
          <p className="text-muted-foreground mb-8">
            You've reviewed all your due {mixAll ? "" : `${activeDialect} `}words. Come back later for more practice.
          </p>

          {stats && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-card rounded-xl p-4 border border-border">
                <Brain className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.learnedCount}</p>
                <p className="text-xs text-muted-foreground">Learning</p>
              </div>
              <div className="bg-card rounded-xl p-4 border border-border">
                <Sparkles className="h-6 w-6 text-accent mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.masteredCount}</p>
                <p className="text-xs text-muted-foreground">Mastered</p>
              </div>
            </div>
          )}

          <Button onClick={() => navigate("/")}>Back to Topics</Button>
        </div>
      </AppShell>
    );
  }

  // Safety: clamp index if list shrank after refetch
  const safeIndex = Math.min(currentIndex, dueWords.length - 1);
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
  }

  const currentWord = dueWords[safeIndex];
  if (!currentWord) return null;

  const progress = ((safeIndex + 1) / dueWords.length) * 100;

  const dialectFlag = DIALECT_FLAGS[currentWord.dialect_module || "Gulf"] || "";
  const dialectLabel = currentWord.dialect_module || "Gulf";

  const stability = currentWord.review?.ease_factor ?? 0;
  const intervalDays = currentWord.review?.interval_days ?? 0;
  const repetitions = currentWord.review?.repetitions ?? 0;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleMix}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              mixAll
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            Mix All
          </button>
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">
              {currentWord.topic?.name || 'Review'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Dialect tag */}
      {mixAll && (
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {dialectFlag} {dialectLabel}
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {currentIndex + 1} / {dueWords.length} due
        </p>
      </div>

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            {/* Image if available */}
            {currentWord.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
                <img
                  src={currentWord.image_url}
                  alt=""
                  className="w-full h-full object-contain"
                  style={currentWord.image_position ? {
                    objectPosition: currentWord.image_position.replace(' ', '% ') + '%',
                  } : undefined}
                />
              </div>
            )}
            {/* Generate image button */}
            <div className="mb-6 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageDialogOpen(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <ImagePlus className="h-4 w-4" />
                {currentWord.image_url ? "Regenerate Image" : "Generate Image"}
              </Button>
            </div>

            <p
              className="text-4xl font-bold text-foreground mb-6"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {currentWord.word_arabic}
            </p>

            {/* Audio button */}
            <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
              {currentWord.audio_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  Word
                </Button>
              )}
            </div>

            {/* Pronunciation practice */}
            <div className="mb-6">
              <PronunciationButton word={currentWord.word_arabic} />
            </div>

            {/* Reveal English */}
            {showAnswer && (
              <div className="animate-in fade-in duration-200 mb-4">
                <p className="text-xl text-muted-foreground">{currentWord.word_english}</p>
              </div>
            )}
            {!showAnswer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Eye className="h-4 w-4" />
                Reveal English
              </Button>
            )}
          </div>
        </div>

        {/* Self-rating always visible */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
            stability={stability}
            difficulty={5.0}
            intervalDays={intervalDays}
            repetitions={repetitions}
            disabled={submitReview.isPending}
          />
        </div>
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          await supabase
            .from("vocabulary_words")
            .update({ image_url: imageUrl })
            .eq("id", wordId);
          refetch();
        }}
      />
    </AppShell>
  );
};

export default Review;
