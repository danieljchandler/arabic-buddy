import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Learn from "./pages/Learn";
import NotFound from "./pages/NotFound";
import Quiz from "./pages/Quiz";

// Admin pages
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Topics from "./pages/admin/Topics";
import TopicForm from "./pages/admin/TopicForm";
import Words from "./pages/admin/Words";
import WordForm from "./pages/admin/WordForm";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public learning app */}
          <Route path="/" element={<Index />} />
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
            <Route path="topics/:topicId/words/:wordId/edit" element={<WordForm />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
