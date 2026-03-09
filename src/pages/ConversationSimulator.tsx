import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, RotateCcw, MessageCircle, Coffee, MapPin, ShoppingBag, Users, Mic, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  translation?: string;
}

interface Scenario {
  id: string;
  title: string;
  titleArabic: string;
  description: string;
  icon: React.ReactNode;
  systemPrompt: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
}

const SCENARIOS: Scenario[] = [
  {
    id: "coffee-shop",
    title: "Coffee Shop",
    titleArabic: "المقهى",
    description: "Order a drink at a Gulf-style café",
    icon: <Coffee className="h-5 w-5" />,
    difficulty: "Beginner",
    systemPrompt: `You are a friendly barista at a popular café in Riyadh. Speak ONLY in Gulf Arabic (Saudi dialect). Keep your responses short (1-2 sentences). Start by greeting the customer and asking what they'd like to order. Use common café vocabulary. After each Arabic response, add a line break then provide the English translation in parentheses. Example format:
أهلاً وسهلاً! وش تبي تشرب؟
(Welcome! What would you like to drink?)`,
  },
  {
    id: "taxi",
    title: "Taxi Ride",
    titleArabic: "التاكسي",
    description: "Give directions to a taxi driver",
    icon: <MapPin className="h-5 w-5" />,
    difficulty: "Beginner",
    systemPrompt: `You are a taxi driver in Dubai. Speak ONLY in Gulf Arabic (UAE dialect). Keep responses short (1-2 sentences). Start by greeting the passenger and asking where they want to go. Use common direction vocabulary. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "souq",
    title: "At the Souq",
    titleArabic: "في السوق",
    description: "Bargain and shop at a traditional market",
    icon: <ShoppingBag className="h-5 w-5" />,
    difficulty: "Intermediate",
    systemPrompt: `You are a shopkeeper at a traditional souq in Kuwait. Speak ONLY in Gulf Arabic (Kuwaiti dialect). Keep responses short (1-2 sentences). Start by welcoming the customer and showing your goods. Be willing to negotiate prices. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "meeting-friends",
    title: "Meeting Friends",
    titleArabic: "لقاء الأصدقاء",
    description: "Casual conversation with new friends",
    icon: <Users className="h-5 w-5" />,
    difficulty: "Intermediate",
    systemPrompt: `You are a friendly local person in Bahrain meeting someone new at a social gathering. Speak ONLY in Gulf Arabic (Bahraini dialect). Keep responses short (1-2 sentences). Start by introducing yourself and asking about the other person. Use common social phrases. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
];

const DIFFICULTY_COLORS = {
  Beginner: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Intermediate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Advanced: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const ConversationSimulator = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const startScenario = useCallback(async (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setMessages([]);
    setIsGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke("how-do-i-say", {
        body: {
          messages: [
            { role: "system", content: scenario.systemPrompt },
            { role: "user", content: "Start the conversation." },
          ],
        },
      });

      if (error) throw error;

      const reply = data?.reply || data?.content || "";
      setMessages([{ role: "assistant", content: reply }]);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to start conversation. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  const sendMessage = async () => {
    if (!input.trim() || !selectedScenario || isGenerating) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsGenerating(true);

    try {
      const apiMessages = [
        { role: "system", content: selectedScenario.systemPrompt },
        ...updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const { data, error } = await supabase.functions.invoke("how-do-i-say", {
        body: { messages: apiMessages },
      });

      if (error) throw error;

      const reply = data?.reply || data?.content || "";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const resetConversation = () => {
    setSelectedScenario(null);
    setMessages([]);
    setInput("");
  };

  const speakText = (text: string) => {
    // Extract just the Arabic text (before parentheses)
    const arabicText = text.split("\n")[0].replace(/\(.*?\)/g, "").trim();
    if (!arabicText) return;

    // Use browser speech synthesis as a fallback
    const utterance = new SpeechSynthesisUtterance(arabicText);
    utterance.lang = "ar-SA";
    utterance.rate = 0.8;
    speechSynthesis.speak(utterance);
  };

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="text-center py-16">
          <MessageCircle className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Conversation Simulator</h1>
          <p className="text-muted-foreground mb-6">Sign in to practice Arabic conversations</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  // Scenario selection screen
  if (!selectedScenario) {
    return (
      <AppShell>
        <div className="mb-6"><HomeButton /></div>

        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold font-heading mb-2">Conversation Simulator</h1>
            <p className="text-muted-foreground">
              Choose a scenario to practice real-world Arabic conversations
            </p>
          </div>

          <div className="grid gap-3">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => startScenario(scenario)}
                className={cn(
                  "w-full text-left bg-card border-2 border-border rounded-xl p-4",
                  "hover:border-primary/40 hover:shadow-md transition-all duration-200",
                  "active:scale-[0.99]"
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    {scenario.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{scenario.title}</h3>
                      <span className="text-base" dir="rtl">{scenario.titleArabic}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{scenario.description}</p>
                    <Badge className={cn("text-xs", DIFFICULTY_COLORS[scenario.difficulty])}>
                      {scenario.difficulty}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  // Active conversation
  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <HomeButton />
        <div className="flex items-center gap-2">
          <Badge variant="outline">{selectedScenario.title}</Badge>
          <Button variant="ghost" size="sm" onClick={resetConversation}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border border-border rounded-bl-sm"
                )}
              >
                <p className="text-sm whitespace-pre-wrap leading-relaxed" dir={msg.role === "assistant" ? "rtl" : "ltr"}>
                  {msg.content}
                </p>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => speakText(msg.content)}
                    className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Volume2 className="h-3 w-3" />
                    Listen
                  </button>
                )}
              </div>
            </div>
          ))}

          {isGenerating && (
            <div className="flex justify-start">
              <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="flex gap-2 pb-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Type in Arabic or English..."
            className="flex-1 h-11 rounded-xl"
            disabled={isGenerating}
            dir="auto"
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isGenerating}
            size="icon"
            className="h-11 w-11 rounded-xl shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Try typing in Arabic or English — the AI will respond in Gulf Arabic with translations
        </p>
      </div>
    </AppShell>
  );
};

export default ConversationSimulator;
