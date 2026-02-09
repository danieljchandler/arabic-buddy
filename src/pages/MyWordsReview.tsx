import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStageReview } from "@/hooks/useStageReview";
import { HomeButton } from "@/components/HomeButton";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, LogIn, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntroCard } from "@/components/exercises/IntroCard";
import { AudioToArabicChoice } from "@/components/exercises/AudioToArabicChoice";
import { ArabicToEnglishChoice } from "@/components/exercises/ArabicToEnglishChoice";
import { EnglishToArabicChoice } from "@/components/exercises/EnglishToArabicChoice";
import { SentenceAudioCloze } from "@/components/exercises/SentenceAudioCloze";
import { SentenceAudioToMeaning } from "@/components/exercises/SentenceAudioToMeaning";

const MyWordsReview = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const {
    isLoading,
    currentCard,
    currentExercise,
    currentOptions,
    currentIndex,
    totalCards,
    progress,
    sessionStats,
    sessionDone,
    handleResult,
    handleIntroDone,
    isPending,
  } = useStageReview('my_words');

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to review your words.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" /> Login
          </Button>
        </div>
      </AppShell>
    );
  }

  // Session complete
  if (sessionDone || !currentCard) {
    const accuracy = sessionStats.total > 0
      ? Math.round((sessionStats.correct / sessionStats.total) * 100)
      : 0;

    return (
      <AppShell compact>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground mb-3">
            {sessionStats.total > 0 ? 'Session Complete!' : 'All Caught Up!'}
          </h1>
          {sessionStats.total > 0 && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-card rounded-xl p-4 border border-border">
                <p className="text-2xl font-bold text-foreground">{sessionStats.correct}</p>
                <p className="text-xs text-muted-foreground">Correct</p>
              </div>
              <div className="bg-card rounded-xl p-4 border border-border">
                <p className="text-2xl font-bold text-foreground">{accuracy}%</p>
                <p className="text-xs text-muted-foreground">Accuracy</p>
              </div>
            </div>
          )}
          {sessionStats.total === 0 && (
            <p className="text-muted-foreground mb-8">No words due for review right now!</p>
          )}
          <Button onClick={() => navigate("/my-words")}>Back to My Words</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">My Words</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionStats.correct}/{sessionStats.total}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          {currentIndex + 1} / {totalCards}
        </p>
      </div>

      {/* Exercise */}
      <div className="py-4 max-w-sm mx-auto">
        {currentExercise === 'intro' && (
          <IntroCard
            wordArabic={currentCard.word_arabic}
            wordEnglish={currentCard.word_english}
            audioUrl={currentCard.audio_url}
            sentenceText={currentCard.sentence_text}
            sentenceEnglish={currentCard.sentence_english}
            sentenceAudioUrl={currentCard.sentence_audio_url}
            onDone={handleIntroDone}
          />
        )}

        {currentExercise === 'audio_to_arabic' && currentCard.audio_url && (
          <AudioToArabicChoice
            key={currentCard.id}
            audioUrl={currentCard.audio_url}
            correctArabic={currentCard.word_arabic}
            options={currentOptions}
            onResult={handleResult}
          />
        )}

        {currentExercise === 'arabic_to_english' && (
          <ArabicToEnglishChoice
            key={currentCard.id}
            wordArabic={currentCard.word_arabic}
            correctEnglish={currentCard.word_english}
            options={currentOptions}
            onResult={handleResult}
          />
        )}

        {currentExercise === 'english_to_arabic' && (
          <EnglishToArabicChoice
            key={currentCard.id}
            wordEnglish={currentCard.word_english}
            correctArabic={currentCard.word_arabic}
            options={currentOptions}
            onResult={handleResult}
          />
        )}

        {currentExercise === 'sentence_cloze' && currentCard.sentence_audio_url && currentCard.sentence_text && (
          <SentenceAudioCloze
            key={currentCard.id}
            sentenceAudioUrl={currentCard.sentence_audio_url}
            sentenceText={currentCard.sentence_text}
            correctWord={currentCard.word_arabic}
            options={currentOptions}
            onResult={handleResult}
          />
        )}

        {currentExercise === 'sentence_to_meaning' && currentCard.sentence_audio_url && (
          <SentenceAudioToMeaning
            key={currentCard.id}
            sentenceAudioUrl={currentCard.sentence_audio_url}
            correctEnglish={currentCard.word_english}
            options={currentOptions}
            onResult={handleResult}
          />
        )}

        {/* Fallback for missing audio */}
        {currentExercise === 'audio_to_arabic' && !currentCard.audio_url && (
          <ArabicToEnglishChoice
            key={currentCard.id}
            wordArabic={currentCard.word_arabic}
            correctEnglish={currentCard.word_english}
            options={currentOptions}
            onResult={handleResult}
          />
        )}
      </div>
    </AppShell>
  );
};

export default MyWordsReview;
