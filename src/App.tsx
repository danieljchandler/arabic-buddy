import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Learn from "./pages/Learn";
import NotFound from "./pages/NotFound";
import Quiz from "./pages/Quiz";
import Auth from "./pages/Auth";
import Review from "./pages/Review";
import Transcribe from "./pages/Transcribe";
import MyWords from "./pages/MyWords";
import TutorUpload from "./pages/TutorUpload";
import MyWordsReview from "./pages/MyWordsReview";
import MemeAnalyzer from "./pages/MemeAnalyzer";
import Discover from "./pages/Discover";
import DiscoverVideo from "./pages/DiscoverVideo";
import LearnFromX from "./pages/LearnFromX";
import HowDoISay from "./pages/HowDoISay";
import CultureGuide from "./pages/CultureGuide";
import Pricing from "./pages/Pricing";
import PronunciationPractice from "./pages/PronunciationPractice";
import ConversationSimulator from "./pages/ConversationSimulator";
import DialectCompare from "./pages/DialectCompare";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Topics from "./pages/admin/Topics";
import TopicForm from "./pages/admin/TopicForm";
import Words from "./pages/admin/Words";
import WordForm from "./pages/admin/WordForm";
import BulkWordImport from "./pages/admin/BulkWordImport";
import AdminVideos from "./pages/admin/AdminVideos";
import AdminVideoForm from "./pages/admin/AdminVideoForm";
import Stages from "./pages/admin/Stages";
import LessonImport from "./pages/admin/LessonImport";
import LlmLogs from "./pages/admin/LlmLogs";
import CurriculumBuilder from "./pages/admin/CurriculumBuilder";

const queryClient = new QueryClient();

const App = () => {
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
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<ErrorBoundary name="AdminRoute"><AdminLayout /></ErrorBoundary>}>
              <Route index element={<Dashboard />} />
              {/* Curriculum routes */}
              <Route path="curriculum" element={<Stages />} />
              <Route path="lessons/import" element={<LessonImport />} />
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
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
