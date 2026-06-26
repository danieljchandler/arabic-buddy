import { GraduationCap, BookOpen, Globe2, PenTool, MessageCircle, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";

const LearnHub = () => {
  return (
    <AppShell>
      <HubHeader title="Learn" subtitle="Build your foundation, step by step." />

      <HubSection
        title="Start here"
        tiles={[
          {
            id: "placement",
            label: "Placement Quiz",
            description: "20 adaptive questions to find your CEFR level",
            icon: GraduationCap,
            to: "/placement",
            accent: "bg-primary/15 text-primary",
          },
          {
            id: "alphabet",
            label: "Alphabet Journey",
            description: "Learn all 28 letters — trace, hear & play",
            icon: BookOpen,
            to: "/alphabet",
            accent: "bg-amber-500/15 text-amber-600",
          },
        ]}
      />

      <HubSection
        title="Curriculum"
        tiles={[
          {
            id: "lessons",
            label: "Lessons",
            description: "Your personalized path at your level",
            icon: Sparkles,
            to: "/learn",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "bridge",
            label: "MSA → Dialect Bridge",
            description: "Translate your formal Arabic into dialect",
            icon: Globe2,
            to: "/bridge",
            accent: "bg-[#5C3A46]/10 text-[#5C3A46]",
          },
          {
            id: "grammar",
            label: "Grammar Drills",
            description: "AI conjugation, pronouns & structure practice",
            icon: PenTool,
            to: "/grammar",
            accent: "bg-violet-500/10 text-violet-600",
          },
          {
            id: "set-phrases",
            label: "Set Phrases",
            description: "Greetings, weddings, Eid wishes & more",
            icon: MessageCircle,
            to: "/set-phrases",
            accent: "bg-emerald-500/10 text-emerald-600",
          },
        ]}
      />
    </AppShell>
  );
};

export default LearnHub;
