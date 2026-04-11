import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateLearningPath } from "@/hooks/useLearningPath";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Target, Clock, GraduationCap, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const GOAL_TYPES = [
  { value: "travel", label: "Travel", icon: "✈️", desc: "Navigate airports, hotels, restaurants" },
  { value: "business", label: "Business", icon: "💼", desc: "Professional meetings & networking" },
  { value: "social", label: "Social", icon: "🤝", desc: "Make friends & casual conversations" },
  { value: "academic", label: "Academic", icon: "📚", desc: "Study Arabic formally" },
  { value: "culture", label: "Culture", icon: "🕌", desc: "Understand media, music, traditions" },
  { value: "general", label: "General", icon: "🌟", desc: "All-round Arabic skills" },
];

// Map CEFR placement levels to learning path levels
const CEFR_TO_LEVEL: Record<string, { value: string; label: string }> = {
  A1: { value: "complete_beginner", label: "Complete Beginner" },
  A2: { value: "some_basics", label: "Know Some Basics" },
  B1: { value: "elementary", label: "Elementary" },
  B2: { value: "conversational", label: "Conversational" },
  C1: { value: "advanced", label: "Advanced" },
  C2: { value: "near_native", label: "Near Native" },
};

const ALL_LEVELS = [
  { value: "complete_beginner", label: "Complete Beginner", cefr: "A1" },
  { value: "some_basics", label: "Know Some Basics", cefr: "A2" },
  { value: "elementary", label: "Elementary", cefr: "B1" },
  { value: "conversational", label: "Conversational", cefr: "B2" },
  { value: "advanced", label: "Advanced", cefr: "C1" },
  { value: "near_native", label: "Near Native", cefr: "C2" },
];

const DIALECT_LABELS: Record<string, string> = {
  Gulf: "Gulf Arabic",
  Egyptian: "Egyptian Arabic",
  Yemeni: "Yemeni Arabic",
};

export default function LearningPathSetup() {
  const navigate = useNavigate();
  const createPath = useCreateLearningPath();
  const { activeDialect } = useDialect();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [goalType, setGoalType] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [targetLevel, setTargetLevel] = useState("complete_beginner");
  const [timelineWeeks, setTimelineWeeks] = useState(12);
  const [placementLevel, setPlacementLevel] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Fetch user's placement level from profile
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setProfileLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("placement_level, proficiency_level")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        const level = (data as any).placement_level || (data as any).proficiency_level;
        if (level) {
          setPlacementLevel(level);
          // Map CEFR to our level system
          const mapped = CEFR_TO_LEVEL[level];
          if (mapped) {
            setTargetLevel(mapped.value);
          } else {
            // Fallback: use proficiency_level directly if it matches
            const directMatch = ALL_LEVELS.find(l => l.value === level);
            if (directMatch) setTargetLevel(level);
          }
        }
      }
      setProfileLoading(false);
    };
    fetchProfile();
  }, [user]);

  const dialectLabel = DIALECT_LABELS[activeDialect] || "Arabic";
  const currentLevelInfo = ALL_LEVELS.find(l => l.value === targetLevel);

  const handleCreate = () => {
    createPath.mutate(
      {
        goal_type: goalType,
        goal_description: goalDescription || GOAL_TYPES.find(g => g.value === goalType)?.desc || goalType,
        target_dialect: activeDialect,
        target_level: targetLevel,
        timeline_weeks: timelineWeeks,
        placement_level: placementLevel || undefined,
      },
      { onSuccess: () => navigate("/my-path") }
    );
  };

  return (
    <AppShell>
      <HomeButton />

      <div className="max-w-lg mx-auto py-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Create Your Learning Path</h1>
          <p className="text-muted-foreground">AI will design a personalized {dialectLabel} curriculum just for you</p>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5 mb-8">
          {[0, 1, 2].map(i => (
            <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        {/* Step 0: Goal Type */}
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" /> What's your goal?
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {GOAL_TYPES.map(g => (
                <button
                  key={g.value}
                  onClick={() => { setGoalType(g.value); setStep(1); }}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    "hover:border-primary/50 active:scale-[0.98]",
                    goalType === g.value ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <span className="text-2xl">{g.icon}</span>
                  <p className="font-semibold text-foreground mt-2">{g.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Details */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" /> Tell us more
            </h2>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Describe your specific goal (optional)</label>
              <Textarea
                placeholder={`e.g., I'm moving to ${activeDialect === 'Egyptian' ? 'Cairo' : activeDialect === 'Yemeni' ? 'Sana\'a' : 'Dubai'} for work and want to chat with colleagues...`}
                value={goalDescription}
                onChange={e => setGoalDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Your current level</label>
              {placementLevel && (
                <div className="flex items-center gap-2 mb-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-sm text-foreground">
                    Based on your placement test: <Badge variant="secondary" className="ml-1">{placementLevel}</Badge>
                  </p>
                </div>
              )}
              <Select value={targetLevel} onValueChange={setTargetLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_LEVELS.map(l => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label} ({l.cefr})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!placementLevel && !profileLoading && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Take the <button onClick={() => navigate("/placement-quiz")} className="text-primary underline">placement quiz</button> for a more accurate assessment
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1">Back</Button>
              <Button onClick={() => setStep(2)} className="flex-1">Next</Button>
            </div>
          </div>
        )}

        {/* Step 2: Timeline */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> How long?
            </h2>

            {/* Summary before creation */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dialect</span>
                <span className="font-medium text-foreground">{dialectLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Level</span>
                <span className="font-medium text-foreground">
                  {currentLevelInfo?.label}{placementLevel ? ` (${placementLevel})` : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Goal</span>
                <span className="font-medium text-foreground capitalize">{goalType}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[8, 12, 16].map(w => (
                <button
                  key={w}
                  onClick={() => setTimelineWeeks(w)}
                  className={cn(
                    "p-4 rounded-xl border-2 text-center transition-all",
                    "hover:border-primary/50",
                    timelineWeeks === w ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <p className="text-2xl font-bold text-foreground">{w}</p>
                  <p className="text-xs text-muted-foreground">weeks</p>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
              <Button
                onClick={handleCreate}
                disabled={createPath.isPending}
                className="flex-1"
              >
                {createPath.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Create Path</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
