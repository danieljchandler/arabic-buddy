import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { useAuth } from "@/hooks/useAuth";
import { useUserXP } from "@/hooks/useGamification";
import { useTodayQueue } from "@/hooks/useTodayQueue";
import { useSRSStats } from "@/hooks/useSRSStats";
import { DailyGoalRing } from "@/components/today/DailyGoalRing";
import { TaskRow } from "@/components/today/TaskRow";
import { StreakDisplay } from "@/components/gamification";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Settings2, Loader2, LogIn, Sparkles, Brain } from "lucide-react";
import { getDailyGoal, setDailyGoal, markTaskCompletedToday } from "@/lib/todayCompletion";
import { InfoHint } from "@/components/InfoHint";

const TASK_HINTS: Record<string, { title: string; body: string }> = {
  flashcards: {
    title: "Flashcards review",
    body: "We surface only the words your brain is about to forget — quick taps now mean long-term memory later.",
  },
  "daily-challenge": {
    title: "Daily challenge",
    body: "A fresh bite-sized mission every day. Finish it to fire up your streak multiplier and earn bonus XP.",
  },
  reading: {
    title: "Reading practice",
    body: "Short passages with tap-to-translate. Build comprehension without ever reaching for a dictionary.",
  },
  "daily-story": {
    title: "Today's story",
    body: "A fresh ~200-word story written around words you already know, with a few new ones gently introduced. Tap any word for an instant gloss.",
  },
  listening: {
    title: "Listening clip",
    body: "Real native videos with synced subtitles — train your ear on how Arabic actually sounds in the wild.",
  },
  souq: {
    title: "Souq News",
    body: "Today's headlines, retold like a friend gossiping in dialect. Casual Arabic + current events in one go.",
  },
  "set-phrases": {
    title: "Set phrases",
    body: "Greetings, weddings, Eid wishes — the go-to expressions natives use on autopilot. Voice-quiz yourself.",
  },
};

const TodayPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: xp } = useUserXP();
  const { data: srsStats } = useSRSStats();
  const tasks = useTodayQueue();

  const [goal, setGoalState] = useState<number>(() => getDailyGoal());
  const [goalDraft, setGoalDraft] = useState<string>(String(goal));

  useEffect(() => {
    const onGoalChange = () => setGoalState(getDailyGoal());
    window.addEventListener("today:goal-changed", onGoalChange);
    return () => window.removeEventListener("today:goal-changed", onGoalChange);
  }, []);

  const xpToday = useMemo(() => {
    // Approximate "today's XP" from weekly XP; if unavailable fall back to 0.
    // Backend tracks daily totals via gamification.add_xp; we don't have a
    // dedicated daily field on UserXP, so this is best-effort. We use the
    // weekly value capped at goal as a visible signal until a dedicated
    // daily field is wired.
    const weekly = xp?.xp_this_week ?? 0;
    return Math.min(weekly, goal);
  }, [xp?.xp_this_week, goal]);

  const visibleTasks = tasks.filter((t) => !t.hidden);
  const completed = visibleTasks.filter((t) => t.done).length;
  const total = visibleTasks.length;

  const handleTaskClick = (taskId: string, route: string) => {
    // Mark non-SRS one-shot tasks as completed when the user starts them.
    // SRS tasks (flashcards, set-phrases) auto-complete when due count hits 0.
    if (["daily-challenge", "reading", "listening", "souq"].includes(taskId)) {
      markTaskCompletedToday(taskId);
    }
    navigate(route);
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

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <Sparkles className="h-12 w-12 text-primary" />
          <h2 className="text-xl font-semibold">Sign in to see your day</h2>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" />
            Sign in
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <HomeButton />
          <StreakDisplay />
        </div>

        <header className="flex items-center gap-5">
          <DailyGoalRing current={xpToday} goal={goal} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Today
              </h1>
              <InfoHint
                size="md"
                title="Your daily queue"
                body="Everything Lahja recommends for you today — reviews, a challenge, listening, reading and more. Knock them out to hit your goal and grow your streak."
              />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {completed} of {total} tasks done
            </p>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-2 -ml-2 h-8 text-xs">
                  <Settings2 className="h-3.5 w-3.5 mr-1" />
                  Daily goal
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Daily XP goal</label>
                  <Input
                    type="number"
                    min={10}
                    max={1000}
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const n = parseInt(goalDraft, 10);
                      if (Number.isFinite(n) && n > 0) {
                        setDailyGoal(n);
                        setGoalState(n);
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        <section className="space-y-3">
          {srsStats && srsStats.totalDueNow > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
              <Brain className="h-4 w-4 text-primary shrink-0" />
              <span className="text-foreground font-medium">{srsStats.totalDueNow} SRS cards due</span>
              <span className="text-muted-foreground ml-auto">{srsStats.curriculumDue} curriculum · {srsStats.myWordsDue} personal</span>
            </div>
          )}
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              title={task.title}
              subtitle={task.subtitle}
              countBadge={task.countBadge}
              estMinutes={task.estMinutes}
              icon={task.icon}
              done={task.done}
              hint={TASK_HINTS[task.id]}
              onClick={() => handleTaskClick(task.id, task.route)}
            />
          ))}
          {visibleTasks.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Sparkles className="h-10 w-10 mx-auto mb-3 text-primary" />
              <p className="font-semibold text-foreground">All caught up!</p>
              <p className="text-sm mt-1">No tasks due today. Explore something new.</p>
            </div>
          )}
        </section>

        {completed > 0 && completed === total && (
          <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 text-center">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary" />
            <p className="font-semibold text-foreground">Daily goal complete</p>
            <p className="text-sm text-muted-foreground mt-1">Come back tomorrow to keep your streak.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default TodayPage;
