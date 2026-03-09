import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, RotateCcw, MessageCircle, Coffee, MapPin, ShoppingBag, Users, Mic, MicOff, Volume2, UtensilsCrossed, Building2, Stethoscope, Phone, Plane } from "lucide-react";
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
  {
    id: "restaurant",
    title: "Restaurant",
    titleArabic: "المطعم",
    description: "Order food at a Gulf restaurant",
    icon: <UtensilsCrossed className="h-5 w-5" />,
    difficulty: "Beginner",
    systemPrompt: `You are a waiter at a popular restaurant in Jeddah serving traditional Gulf cuisine. Speak ONLY in Gulf Arabic (Saudi dialect). Keep responses short (1-2 sentences). Start by welcoming the guest and asking what they would like to eat. Suggest popular dishes like kabsa, mandi, or machboos. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "hotel",
    title: "Hotel Check-in",
    titleArabic: "تسجيل الفندق",
    description: "Check into a hotel and ask about amenities",
    icon: <Building2 className="h-5 w-5" />,
    difficulty: "Intermediate",
    systemPrompt: `You are a hotel receptionist at a luxury hotel in Abu Dhabi. Speak ONLY in Gulf Arabic (UAE dialect). Keep responses short (1-2 sentences). Start by welcoming the guest and asking for their reservation details. Be helpful about room amenities, breakfast times, and hotel services. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "doctor",
    title: "Doctor's Visit",
    titleArabic: "زيارة الطبيب",
    description: "Describe symptoms to a doctor",
    icon: <Stethoscope className="h-5 w-5" />,
    difficulty: "Advanced",
    systemPrompt: `You are a kind doctor at a clinic in Qatar. Speak ONLY in Gulf Arabic (Qatari dialect). Keep responses short (1-2 sentences). Start by asking the patient what brings them in today and how they're feeling. Use common medical vocabulary but keep it accessible. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "phone-call",
    title: "Phone Call",
    titleArabic: "مكالمة هاتفية",
    description: "Make a phone reservation or inquiry",
    icon: <Phone className="h-5 w-5" />,
    difficulty: "Advanced",
    systemPrompt: `You are answering a phone call at a restaurant in Kuwait. Speak ONLY in Gulf Arabic (Kuwaiti dialect). Keep responses short (1-2 sentences). Start by greeting and asking how you can help. Handle reservation requests or answer questions about hours and menu. After each Arabic response, add a line break then provide the English translation in parentheses.`,
  },
  {
    id: "airport",
    title: "At the Airport",
    titleArabic: "في المطار",
    description: "Navigate check-in and boarding",
    icon: <Plane className="h-5 w-5" />,
    difficulty: "Intermediate",
    systemPrompt: `You are an airline staff member at Kuwait International Airport. Speak ONLY in Gulf Arabic (Kuwaiti dialect). Keep responses short (1-2 sentences). Start by greeting the passenger and asking for their ticket and passport. Help with check-in, baggage, and boarding information. After each Arabic response, add a line break then provide the English translation in parentheses.`,
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
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAutoPlayRef = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Fetch DB scenarios — must be declared here before any conditional returns (Rules of Hooks)
  const { data: dbScenarios } = useQuery({
    queryKey: ['conversation-scenarios'],
    queryFn: async () => {
      const { data } = await supabase
        .from('conversation_scenarios' as any)
        .select('*')
        .eq('status', 'published');
      return (data || []) as any[];
    },
  });

  // Voice recording toggle using browser Web Speech API
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast({
        title: "Voice input not supported",
        description: "Your browser doesn't support voice input. Please use Chrome or Edge, or type instead.",
        variant: "destructive",
      });
      return;
    }

    const recognition: SpeechRecognition = new SpeechRecognition();
    recognition.lang = "ar";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => setIsRecording(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setInput(transcript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast({
          title: "Microphone access blocked",
          description: "Click the lock/info icon in your browser's address bar, set Microphone to 'Allow', then refresh the page.",
          variant: "destructive",
        });
      } else if (event.error !== "aborted") {
        toast({
          title: "Voice input error",
          description: "Could not capture audio. Please type instead.",
          variant: "destructive",
        });
      }
    };

    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
  }, [isRecording, toast]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-play new assistant messages
  useEffect(() => {
    if (pendingAutoPlayRef.current && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === "assistant" && lastMessage.content === pendingAutoPlayRef.current) {
        pendingAutoPlayRef.current = null;
        // Small delay to ensure UI is updated
        setTimeout(() => {
          speakText(lastMessage.content, messages.length - 1);
        }, 300);
      }
    }
  }, [messages]);

  const startScenario = useCallback(async (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setMessages([]);
    setIsGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke("conversation-practice", {
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
      // Queue auto-play for the first message
      if (autoPlay) {
        pendingAutoPlayRef.current = reply;
      }
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

      const { data, error } = await supabase.functions.invoke("conversation-practice", {
        body: { messages: apiMessages },
      });

      if (error) throw error;

      const reply = data?.reply || data?.content || "";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      // Queue auto-play
      if (autoPlay) {
        pendingAutoPlayRef.current = reply;
      }
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

  const speakText = async (text: string, messageIndex: number) => {
    // Extract just the Arabic text (before parentheses/translation)
    const arabicText = text.split("\n")[0].replace(/\(.*?\)/g, "").trim();
    if (!arabicText) return;

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsSpeaking(messageIndex);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            text: arabicText, 
            voiceId: "JBFqnCBsd6RMkjVDRZzb" // George - male Arabic voice
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setIsSpeaking(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      await audio.play();
    } catch (err) {
      console.error("TTS error:", err);
      setIsSpeaking(null);
      
      // Fallback to browser speech synthesis
      const utterance = new SpeechSynthesisUtterance(arabicText);
      utterance.lang = "ar-SA";
      utterance.rate = 0.8;
      utterance.onend = () => setIsSpeaking(null);
      speechSynthesis.speak(utterance);
    }
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

  const ICON_MAP: Record<string, React.ReactNode> = {
    Coffee: <Coffee className="h-5 w-5" />,
    MapPin: <MapPin className="h-5 w-5" />,
    ShoppingBag: <ShoppingBag className="h-5 w-5" />,
    Users: <Users className="h-5 w-5" />,
    UtensilsCrossed: <UtensilsCrossed className="h-5 w-5" />,
    Building2: <Building2 className="h-5 w-5" />,
    Stethoscope: <Stethoscope className="h-5 w-5" />,
    Phone: <Phone className="h-5 w-5" />,
    Plane: <Plane className="h-5 w-5" />,
    MessageCircle: <MessageCircle className="h-5 w-5" />,
  };

  const allScenarios: Scenario[] = [
    ...(dbScenarios || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      titleArabic: s.title_arabic,
      description: s.description,
      icon: ICON_MAP[s.icon_name] || <MessageCircle className="h-5 w-5" />,
      systemPrompt: s.system_prompt,
      difficulty: s.difficulty as "Beginner" | "Intermediate" | "Advanced",
    })),
    ...SCENARIOS,
  ];

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
            {allScenarios.map((scenario) => (
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
          <button
            onClick={() => setAutoPlay(!autoPlay)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
              autoPlay 
                ? "bg-primary/10 text-primary" 
                : "bg-muted text-muted-foreground"
            )}
            title={autoPlay ? "Auto-play is on" : "Auto-play is off"}
          >
            <Volume2 className="h-3 w-3" />
            {autoPlay ? "Auto" : "Manual"}
          </button>
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
                    onClick={() => speakText(msg.content, i)}
                    disabled={isSpeaking !== null}
                    className={cn(
                      "mt-2 flex items-center gap-1 text-xs transition-colors",
                      isSpeaking === i 
                        ? "text-primary" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isSpeaking === i ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Speaking...
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3 w-3" />
                        Listen
                      </>
                    )}
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
          <Button
            onClick={toggleRecording}
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            className={cn(
              "h-11 w-11 rounded-xl shrink-0 transition-all",
              isRecording && "animate-pulse"
            )}
            disabled={isGenerating}
            title={isRecording ? "Stop recording" : "Start voice input"}
          >
            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder={isRecording ? "Listening..." : "Type or tap mic to speak..."}
            className={cn(
              "flex-1 h-11 rounded-xl transition-all",
              isRecording && "border-destructive/50 bg-destructive/5"
            )}
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
          {isRecording 
            ? "🎤 Speak now — your words will appear above" 
            : "Type or use the mic to speak in Arabic or English"}
        </p>
      </div>
    </AppShell>
  );
};

export default ConversationSimulator;
