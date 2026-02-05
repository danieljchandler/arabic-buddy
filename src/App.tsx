import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import Index from "./pages/Index";
import Learn from "./pages/Learn";
import NotFound from "./pages/NotFound";
import Quiz from "./pages/Quiz";
import Auth from "./pages/Auth";
import Review from "./pages/Review";
import Transcribe from "./pages/Transcribe";

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
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event.reason);
      toast.error("حدث خطأ غير متوقع", {
        description: "حاول مرة أخرى. إذا استمرت المشكلة، أخبرني بما فعلته بالضبط.",
      });
      // Prevent browser/dev overlay from treating it as fatal.
      event.preventDefault();
    };

    const onError = (event: ErrorEvent) => {
      console.error("Global error:", event.error ?? event.message);
      // Don't spam toasts for every error; but make crashes visible.
      toast.error("حدث خطأ في الصفحة", {
        description: "تم تسجيل الخطأ في الكونسول. حاول إعادة المحاولة.",
      });
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
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
            <Route path="/transcribe" element={<Transcribe />} />
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
