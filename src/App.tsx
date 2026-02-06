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

// Admin pages
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Topics from "./pages/admin/Topics";
import TopicForm from "./pages/admin/TopicForm";
import Words from "./pages/admin/Words";
import WordForm from "./pages/admin/WordForm";
import BulkWordImport from "./pages/admin/BulkWordImport";

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

        toast.error("تعطّل التطبيق قبل قليل", {
          description: msg || "تم تسجيل التفاصيل في الكونسول. جرّب مرة ثانية.",
        });
        console.error("Recovered last crash:", parsed);
      }
    } catch (e) {
      console.error("Failed to restore last crash:", e);
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event.reason);
      persistCrash(event.reason);
      toast.error("حدث خطأ غير متوقع", {
        description: "حاول مرة أخرى. إذا استمرت المشكلة، أخبرني بما فعلته بالضبط.",
      });
      // Prevent browser/dev overlay from treating it as fatal.
      event.preventDefault();
    };

    const onError = (event: ErrorEvent) => {
      console.error("Global error:", event.error ?? event.message);
      persistCrash(event.error ?? event.message);
      // Don't spam toasts for every error; but make crashes visible.
      toast.error("حدث خطأ في الصفحة", {
        description: "تم تسجيل الخطأ في الكونسول. حاول إعادة المحاولة.",
      });

      // In some hosted runtimes, letting this bubble can trigger a hard reload.
      event.preventDefault();
      (event as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
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
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/review" element={<Review />} />
            <Route
              path="/transcribe"
              element={
                <ErrorBoundary name="TranscribeRoute">
                  <Transcribe />
                </ErrorBoundary>
              }
            />
            <Route path="/my-words" element={<MyWords />} />
            <Route path="/learn/:topicId" element={<Learn />} />
            <Route path="/quiz/:topicId" element={<Quiz />} />

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
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
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
