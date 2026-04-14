import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TranscriptionJobProvider } from "@/contexts/TranscriptionJobContext";
import { DialectProvider } from "@/contexts/DialectContext";

// ─── Lazy-loaded page components ─────────────────────────────────────────────
// Each page is loaded on-demand so the initial bundle stays small.
const Index = lazy(() => import("./pages/Index"));
const Learn = lazy(() => import("./pages/Learn"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Quiz = lazy(() => import("./pages/Quiz"));
const Auth = lazy(() => import("./pages/Auth"));
const Review = lazy(() => import("./pages/Review"));
const Transcribe = lazy(() => import("./pages/Transcribe"));
const MyWords = lazy(() => import("./pages/MyWords"));
const TutorUpload = lazy(() => import("./pages/TutorUpload"));
const MyWordsReview = lazy(() => import("./pages/MyWordsReview"));
const MemeAnalyzer = lazy(() => import("./pages/MemeAnalyzer"));
const Discover = lazy(() => import("./pages/Discover"));
const DiscoverVideo = lazy(() => import("./pages/DiscoverVideo"));
const LearnFromX = lazy(() => import("./pages/LearnFromX"));
const HowDoISay = lazy(() => import("./pages/HowDoISay"));
const CultureGuide = lazy(() => import("./pages/CultureGuide"));
const Pricing = lazy(() => import("./pages/Pricing"));
const PronunciationPractice = lazy(() => import("./pages/PronunciationPractice"));
const ConversationSimulator = lazy(() => import("./pages/ConversationSimulator"));
const DialectCompare = lazy(() => import("./pages/DialectCompare"));
const ListeningPractice = lazy(() => import("./pages/ListeningPractice"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const ReadingPractice = lazy(() => import("./pages/ReadingPractice"));
const DailyChallenge = lazy(() => import("./pages/DailyChallenge"));
const LearningAnalytics = lazy(() => import("./pages/LearningAnalytics"));
const GrammarDrills = lazy(() => import("./pages/GrammarDrills"));
const VocabGames = lazy(() => import("./pages/VocabGames"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Settings = lazy(() => import("./pages/Settings"));
const Friends = lazy(() => import("./pages/Friends"));
const LikedVideos = lazy(() => import("./pages/LikedVideos"));
const Stories = lazy(() => import("./pages/Stories"));
const StoryPlayer = lazy(() => import("./pages/StoryPlayer"));
const VocabBattles = lazy(() => import("./pages/VocabBattles"));
const BattlePlay = lazy(() => import("./pages/BattlePlay"));
const LearningPathSetup = lazy(() => import("./pages/LearningPathSetup"));
const LearningPathDashboard = lazy(() => import("./pages/LearningPathDashboard"));
const PlacementQuiz = lazy(() => import("./pages/PlacementQuiz"));
const SouqNews = lazy(() => import("./pages/SouqNews"));

// Admin pages
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Topics = lazy(() => import("./pages/admin/Topics"));
const TopicForm = lazy(() => import("./pages/admin/TopicForm"));
const Words = lazy(() => import("./pages/admin/Words"));
const WordForm = lazy(() => import("./pages/admin/WordForm"));
const BulkWordImport = lazy(() => import("./pages/admin/BulkWordImport"));
const AdminVideos = lazy(() => import("./pages/admin/AdminVideos"));
const AdminVideoForm = lazy(() => import("./pages/admin/AdminVideoForm"));
const Stages = lazy(() => import("./pages/admin/Stages"));
const LessonWords = lazy(() => import("./pages/admin/LessonWords"));
const LessonImport = lazy(() => import("./pages/admin/LessonImport"));
const LlmLogs = lazy(() => import("./pages/admin/LlmLogs"));
const CurriculumBuilder = lazy(() => import("./pages/admin/CurriculumBuilder"));
const AdminStories = lazy(() => import("./pages/admin/AdminStories"));
const AdminStoryForm = lazy(() => import("./pages/admin/AdminStoryForm"));
const TrendingVideos = lazy(() => import("./pages/admin/TrendingVideos"));

const queryClient = new QueryClient();

const App = () => {
  console.log("[boot] App component rendering");
  useEffect(() => {
    const CRASH_KEY = "__app_last_crash";

    const persistCrash = (payload: unknown) => {
      try {
        sessionStorage.setItem(
          CRASH_KEY,
          JSON.stringify({ at: new Date().toISOString(), url: window.location.href, payload }),
        );
      } catch {
        // ignore
      }
    };

    // If the runtime hard-reloaded due to an error, surface the reason after boot.
    try {
      const raw = sessionStorage.getItem(CRASH_KEY);
      if (raw) {
        sessionStorage.removeItem(CRASH_KEY);
        const parsed = JSON.parse(raw) as { at?: string; url?: string; payload?: unknown };
        const msg =
          parsed?.payload instanceof Error
            ? parsed.payload.message
            : typeof parsed?.payload === "string"
              ? parsed.payload
              : "";

        toast.error("The app crashed recently", {
          description: msg || "Details logged to the console. Please try again.",
        });
        console.error("Recovered last crash:", parsed);
      }
    } catch (e) {
      console.error("Failed to restore last crash:", e);
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event.reason);
      persistCrash(event.reason);
      toast.error("An unexpected error occurred", {
        description: "Please try again. If the problem persists, let me know what you did.",
      });
      // Prevent browser/dev overlay from treating it as fatal.
      event.preventDefault();
    };

    const onError = (event: ErrorEvent) => {
      console.error("Global error:", event.error ?? event.message);
      persistCrash(event.error ?? event.message);
      // Don't spam toasts for every error; but make crashes visible.
      toast.error("A page error occurred", {
        description: "The error was logged to the console. Please try again.",
      });

      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError, true);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <DialectProvider>
      <TranscriptionJobProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
          <Routes>
            {/* Public learning app */}
            <Route path="/" element={<ErrorBoundary name="HomeRoute"><Index /></ErrorBoundary>} />
            <Route path="/auth" element={<ErrorBoundary name="AuthRoute"><Auth /></ErrorBoundary>} />
            <Route path="/review" element={<ErrorBoundary name="ReviewRoute"><Review /></ErrorBoundary>} />
            <Route
              path="/transcribe"
              element={
                <ErrorBoundary name="TranscribeRoute">
                  <Transcribe />
                </ErrorBoundary>
              }
            />
            <Route path="/my-words" element={<ErrorBoundary name="MyWordsRoute"><MyWords /></ErrorBoundary>} />
            <Route path="/review/my-words" element={<ErrorBoundary name="MyWordsReviewRoute"><MyWordsReview /></ErrorBoundary>} />
            <Route path="/tutor-upload" element={<ErrorBoundary name="TutorUploadRoute"><TutorUpload /></ErrorBoundary>} />
            <Route path="/meme" element={
              <ErrorBoundary name="MemeAnalyzerRoute">
                <MemeAnalyzer />
              </ErrorBoundary>
            } />
            <Route path="/learn" element={<ErrorBoundary name="LearnRoute"><Learn /></ErrorBoundary>} />
            <Route path="/learn/:topicId" element={<ErrorBoundary name="LearnTopicRoute"><Learn /></ErrorBoundary>} />
            <Route path="/quiz/:topicId" element={<ErrorBoundary name="QuizRoute"><Quiz /></ErrorBoundary>} />
            <Route path="/discover" element={<ErrorBoundary name="DiscoverRoute"><Discover /></ErrorBoundary>} />
            <Route path="/discover/:videoId" element={<ErrorBoundary name="DiscoverVideoRoute"><DiscoverVideo /></ErrorBoundary>} />
            <Route path="/learn-from-x" element={
              <ErrorBoundary name="LearnFromXRoute">
                <LearnFromX />
              </ErrorBoundary>
            } />
            <Route path="/how-do-i-say" element={
              <ErrorBoundary name="HowDoISayRoute">
                <HowDoISay />
              </ErrorBoundary>
            } />
            <Route path="/culture-guide" element={
              <ErrorBoundary name="CultureGuideRoute">
                <CultureGuide />
              </ErrorBoundary>
            } />
            <Route path="/pricing" element={
              <ErrorBoundary name="PricingRoute">
                <Pricing />
              </ErrorBoundary>
            } />
            <Route path="/pronunciation" element={
              <ErrorBoundary name="PronunciationRoute">
                <PronunciationPractice />
              </ErrorBoundary>
            } />
            <Route path="/conversation" element={
              <ErrorBoundary name="ConversationRoute">
                <ConversationSimulator />
              </ErrorBoundary>
            } />
            <Route path="/dialect-compare" element={
              <ErrorBoundary name="DialectCompareRoute">
                <DialectCompare />
              </ErrorBoundary>
            } />
            <Route path="/listening" element={
              <ErrorBoundary name="ListeningRoute">
                <ListeningPractice />
              </ErrorBoundary>
            } />
            <Route path="/leaderboard" element={
              <ErrorBoundary name="LeaderboardRoute">
                <Leaderboard />
              </ErrorBoundary>
            } />
            <Route path="/reading" element={
              <ErrorBoundary name="ReadingRoute">
                <ReadingPractice />
              </ErrorBoundary>
            } />
            <Route path="/daily-challenge" element={
              <ErrorBoundary name="DailyChallengeRoute">
                <DailyChallenge />
              </ErrorBoundary>
            } />
            <Route path="/analytics" element={
              <ErrorBoundary name="AnalyticsRoute">
                <LearningAnalytics />
              </ErrorBoundary>
            } />
            <Route path="/grammar" element={
              <ErrorBoundary name="GrammarRoute">
                <GrammarDrills />
              </ErrorBoundary>
            } />
            <Route path="/vocab-games" element={
              <ErrorBoundary name="VocabGamesRoute">
                <VocabGames />
              </ErrorBoundary>
            } />
            <Route path="/onboarding" element={
              <ErrorBoundary name="OnboardingRoute">
                <Onboarding />
              </ErrorBoundary>
            } />
            <Route path="/settings" element={
              <ErrorBoundary name="SettingsRoute">
                <Settings />
              </ErrorBoundary>
            } />
            <Route path="/friends" element={
              <ErrorBoundary name="FriendsRoute"><Friends /></ErrorBoundary>
            } />
            <Route path="/liked-videos" element={
              <ErrorBoundary name="LikedVideosRoute"><LikedVideos /></ErrorBoundary>
            } />
            <Route path="/stories" element={
              <ErrorBoundary name="StoriesRoute"><Stories /></ErrorBoundary>
            } />
            <Route path="/stories/:storyId" element={
              <ErrorBoundary name="StoryPlayerRoute"><StoryPlayer /></ErrorBoundary>
            } />
            <Route path="/battles" element={
              <ErrorBoundary name="VocabBattlesRoute"><VocabBattles /></ErrorBoundary>
            } />
            <Route path="/battles/:battleId" element={
              <ErrorBoundary name="BattlePlayRoute"><BattlePlay /></ErrorBoundary>
            } />
            <Route path="/my-path" element={
              <ErrorBoundary name="LearningPathRoute"><LearningPathDashboard /></ErrorBoundary>
            } />
            <Route path="/my-path/setup" element={
              <ErrorBoundary name="LearningPathSetupRoute"><LearningPathSetup /></ErrorBoundary>
            } />
            <Route path="/souq-news" element={
              <ErrorBoundary name="SouqNewsRoute"><SouqNews /></ErrorBoundary>
            } />
            <Route path="/placement" element={
              <ErrorBoundary name="PlacementQuizRoute"><PlacementQuiz /></ErrorBoundary>
            } />

            <Route path="/admin" element={<ErrorBoundary name="AdminRoute"><AdminLayout /></ErrorBoundary>}>
              <Route index element={<Dashboard />} />
              {/* Curriculum routes */}
              <Route path="curriculum" element={<Stages />} />
              <Route path="lessons/import" element={<LessonImport />} />
              <Route path="lessons/:lessonId/words" element={<LessonWords />} />
              {/* Legacy topic routes (still used for word management) */}
              <Route path="topics" element={<Topics />} />
              <Route path="topics/new" element={<TopicForm />} />
              <Route path="topics/:topicId/edit" element={<TopicForm />} />
              <Route path="topics/:topicId/words" element={<Words />} />
              <Route path="topics/:topicId/words/new" element={<WordForm />} />
              <Route
                path="topics/:topicId/words/:wordId/edit"
                element={<WordForm />}
              />
              <Route path="topics/:topicId/words/bulk" element={<BulkWordImport />} />
              <Route path="videos" element={<AdminVideos />} />
              <Route path="videos/new" element={<AdminVideoForm />} />
              <Route path="videos/:videoId/edit" element={<AdminVideoForm />} />
              <Route path="llm-logs" element={<LlmLogs />} />
              <Route path="curriculum-builder" element={<CurriculumBuilder />} />
              <Route path="curriculum-builder/:sessionId" element={<CurriculumBuilder />} />
              <Route path="stories" element={<AdminStories />} />
              <Route path="stories/new" element={<AdminStoryForm />} />
              <Route path="stories/:storyId/edit" element={<AdminStoryForm />} />
              <Route path="trending" element={<TrendingVideos />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
      </TranscriptionJobProvider>
      </DialectProvider>
    </QueryClientProvider>
  );
};

export default App;
