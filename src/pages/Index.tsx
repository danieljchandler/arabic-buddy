import { useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { supabase } from "@/integrations/supabase/client";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useSRSStats } from "@/hooks/useSRSStats";
import { useUserXP } from "@/hooks/useGamification";
import { useTodayQueue } from "@/hooks/useTodayQueue";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogOut, Sparkles, GraduationCap, ChevronRight, Globe2, Users, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { XPDisplay, StreakDisplay, WeeklyGoalCard } from "@/components/gamification";
import { SparkleBurst } from "@/components/gamification/SparkleBurst";
import { BrandMark } from "@/components/shell/BrandMark";
import { EmptyState } from "@/components/shared/EmptyState";
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { useDialect, DialectModule } from "@/contexts/DialectContext";
import { DialectRitualSwitcher } from "@/components/DialectRitualSwitcher";
import { MajlisWelcome } from "@/components/MajlisWelcome";
import { PhraseOfTheDay } from "@/components/PhraseOfTheDay";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { HomeSectionId, isSectionVisible } from "@/lib/homeLayout";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { InfoHint } from "@/components/InfoHint";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";
import { ARABIC_LETTERS } from "@/data/arabicAlphabet";
import { DailyLetterGoalRing } from "@/components/alphabet/DailyLetterGoalRing";
import { DailyGoalRing } from "@/components/today/DailyGoalRing";
import { TaskRow } from "@/components/today/TaskRow";
import { WatchTodayCard } from "@/components/today/WatchTodayCard";
import { getDailyGoal, setDailyGoal } from "@/lib/todayCompletion";
import { ContinueCard } from "@/components/ContinueCard";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";


// Daily-queue task hints, keyed by useTodayQueue's TodayTaskId — moved here
// from the old standalone Today.tsx page now that the queue is inline.
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
  // No "listening" entry: today's video renders as WatchTodayCard at the top of
  // the page rather than as a queue row, and carries its own hint.
  souq: {
    title: "Souq News",
    body: "Today's headlines, retold like a friend gossiping in dialect. Casual Arabic + current events in one go.",
  },
  "set-phrases": {
    title: "Set phrases",
    body: "Greetings, weddings, Eid wishes — the go-to expressions natives use on autopilot. Voice-quiz yourself.",
  },
};

const DIALECT_MODULES: { id: DialectModule; label: string; flag: string }[] = [
  { id: 'Gulf', label: 'Gulf Arabic', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' },
  { id: 'Yemeni', label: 'Yemeni Arabic', flag: '🇾🇪' },
];

const Index = () => {
  const navigate = useNavigate();
  const { activeDialect, setDialect } = useDialect();
  const {
    user,
    isAuthenticated,
    signOut,
    loading: authLoading
  } = useAuth();
  const { data: myWordsStats } = useUserVocabularyDueCount();
  const { data: stats } = useReviewStats();
  const { data: srsStats } = useSRSStats();
  // Dialect-aware placement level (see the profile fetch below) — decides
  // whether the placement banner is still worth showing.
  const [placementLevel, setPlacementLevel] = useState<string | null>(null);
  const { hasAccess: hasBibleAccess } = useBibleAccess();

  const { state: homeLayout } = useHomeLayout();
  const { progress: alphabetProgress, masteredCount: alphabetMastered, isUnlocked: alphabetUnlocked } = useAlphabetProgress();
  const currentLetter = isAuthenticated
    ? ARABIC_LETTERS.find((l) => alphabetUnlocked(l.order_index) && !alphabetProgress[l.code]?.mastered_at) ?? ARABIC_LETTERS[0]
    : null;
  const { isAdmin } = useAdminAuth();

  // Daily queue — inlined here (was previously a separate /today page the
  // user had to navigate to via a "Start today" card).
  const { data: xp } = useUserXP();
  const todayTasks = useTodayQueue();
  const [dailyGoal, setDailyGoalState] = useState<number>(() => getDailyGoal());
  const [goalDraft, setGoalDraft] = useState<string>(String(dailyGoal));

  useEffect(() => {
    const onGoalChange = () => setDailyGoalState(getDailyGoal());
    window.addEventListener("today:goal-changed", onGoalChange);
    return () => window.removeEventListener("today:goal-changed", onGoalChange);
  }, []);

  const xpToday = useMemo(() => {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (!xp || xp.xp_today_date !== todayUtc) return 0;
    return xp.xp_today;
  }, [xp]);

  const visibleTasks = todayTasks.filter((t) => !t.hidden);
  const tasksCompleted = visibleTasks.filter((t) => t.done).length;
  const tasksTotal = visibleTasks.length;

  // Video leads the page as a full card at the very top rather than as a row
  // buried in the queue, so it is pulled out of the list here — it still counts
  // towards the totals above, and WatchTodayCard handles its own navigation and
  // completion.
  const videoTask = visibleTasks.find((t) => t.id === "listening");
  const queueRows = visibleTasks.filter((t) => t.id !== "listening");

  // Check onboarding + placement status for authenticated users (per active dialect)
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    const checkProfile = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('onboarding_completed, placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && !(data as any).onboarding_completed) {
        navigate('/onboarding');
      }
      if (data) {
        const d = activeDialect.toLowerCase();
        const perDialect = (data as any)[`placement_level_${d}`];
        const fallback = activeDialect === 'Gulf' ? (data as any).placement_level : null;
        setPlacementLevel(perDialect || fallback || null);
      }
    };
    checkProfile();
  }, [isAuthenticated, authLoading, user, navigate, activeDialect]);
  const handleSignOut = async () => {
    await signOut();
  };

  // Logged-out visitors get the landing hero instead of the authed home.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  return (
    <AppShell>



      {/* Top bar — the same BrandMark corner the feed, chooser and skills use,
          with the utility icons gathered into one quiet group on the right.
          (Signed-out visitors never reach this: they get the landing hero.) */}
      <div className="flex items-center justify-between mb-4">
        <BrandMark />

        <div className="flex items-center gap-0.5">
          {isAuthenticated && (
            <>
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={() => navigate("/profile")} className="text-muted-foreground hover:text-foreground" title="Profile" aria-label="Profile">
                <Users className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground" title="Settings" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-muted-foreground/50 hover:text-muted-foreground" title="Admin" aria-label="Admin">
              <GraduationCap className="h-4 w-4" />
            </Button>
          )}
          {!authLoading && isAuthenticated && (
            <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground" title="Sign out" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* A — Majlis welcome panel */}
      <MajlisWelcome />

      {/* Dialect Module Switcher — ritual chip + flip-card overlay */}
      <div className="mb-3">
        <DialectRitualSwitcher />
      </div>

      {(() => {
        const sections: Partial<Record<HomeSectionId, React.ReactNode>> = {
          "phrase-of-the-day": <PhraseOfTheDay key="phrase-of-the-day" />,

          "placement-banner":
            isAuthenticated && !placementLevel ? (
              <button
                key="placement-banner"
                onClick={() => navigate("/placement")}
                className={cn(
                  "w-full p-5 rounded-2xl",
                  "bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5",
                  "border border-primary/30",
                  "flex items-start gap-4 text-left",
                  "transition-all duration-200",
                  "hover:border-primary/50 hover:shadow-elegant active:scale-[0.99]",
                  "relative overflow-hidden"
                )}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0 relative z-10">
                  {/* No InfoHint here: the tile IS a <button>, and InfoHint is
                      deliberately a real <button> too (see its comment), so
                      nesting one inside violates DOM nesting and made the
                      routes sweep red. The tile's own copy carries the hint's
                      content. */}
                  <p className="font-bold text-foreground text-base mb-1 flex items-center gap-1.5">Take the Placement Quiz</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Answer 20 adaptive questions so we can tailor lessons, vocabulary, and exercises to your exact level.
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">~5 minutes</Badge>
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">CEFR A1–C2</Badge>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-primary shrink-0 mt-1" />
              </button>
            ) : null,

          // The daily task queue — the app's single "what do I do today" surface.
          // This used to be a separate /today page reached via a "Start today"
          // card; it's now inline so Home doesn't compete with a second home.
          "daily-queue": isAuthenticated ? (
            <div key="daily-queue" className="space-y-3">
              {/* The day's work sits in its own frame.
                  Everything on this page used to be a card of the same weight,
                  so the daily queue — the reason the page exists — read as a
                  peer of the MSA-bridge footnote. The progress widgets below
                  stay outside it, which is what makes the queue the spine
                  rather than one more item in a stack of ten. */}
              <div className="rounded-3xl border border-desert-red/15 bg-desert-red/[0.035] p-3 sm:p-4 space-y-3">
              <div className="flex items-center gap-4">
                <DailyGoalRing current={xpToday} goal={dailyGoal} size={100} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-heading text-lg font-bold text-foreground">
                      Today
                    </h2>
                    <InfoHint
                      size="md"
                      title="Your daily queue"
                      body="Everything Hakiya recommends for you today — reviews, a challenge, listening, reading and more. Knock them out to hit your goal and grow your streak."
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {tasksCompleted} of {tasksTotal} tasks done
                  </p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-1 -ml-2 h-7 text-xs">
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
                              setDailyGoalState(n);
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Today's video — sits just below the daily goals and above the
                  task queue / flashcard review. Watching native video is the
                  core of the app; it used to lead the page, but now follows the
                  goals so learners see their target first. */}
              {isAuthenticated && <WatchTodayCard done={videoTask?.done} />}

              {/* Every row left in the queue marks itself complete on its own
                  real completion event, so opening one is a plain navigation —
                  marking on click would let a learner clear the day by tapping
                  through it. */}
              <div className="space-y-3">
                {queueRows.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    index={i + 1}
                    title={task.title}
                    subtitle={task.subtitle}
                    countBadge={task.countBadge}
                    estMinutes={task.estMinutes}
                    icon={task.icon}
                    done={task.done}
                    hint={TASK_HINTS[task.id]}
                    onClick={() => navigate(task.route)}
                  />
                ))}
                {visibleTasks.length === 0 && (
                  <EmptyState
                    art="caught-up"
                    size="sm"
                    className="py-8"
                    title="All caught up!"
                    body="No tasks due today. Explore something new below."
                  />
                )}
              </div>

              {tasksCompleted > 0 && tasksCompleted === tasksTotal && (
                <div className="relative rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center animate-scale-in">
                  <SparkleBurst />
                  <Sparkles className="h-6 w-6 mx-auto mb-1 text-primary" />
                  <p className="font-semibold text-foreground text-sm">Daily goal complete</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Come back tomorrow to keep your streak.</p>
                </div>
              )}

              </div>

              {/* One entry point into the review session — "/review" walks
                  every deck with cards due (curriculum, saved words, saved
                  phrases) rather than stranding cards in a deck the learner
                  would have to remember to visit. */}
              {srsStats && srsStats.totalDueNow > 0 && (
                <button
                  onClick={() => navigate("/review")}
                  className="w-full p-3 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-between transition-all hover:border-primary/40 active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">
                      {srsStats.totalDueNow} {srsStats.totalDueNow === 1 ? "card" : "cards"} due for review
                    </span>
                  </div>
                  <span className="text-xs text-primary font-semibold">Review now →</span>
                </button>
              )}

              {/* Secondary progression tracks — distinct from the daily queue */}
              {currentLetter && (
                <button
                  onClick={() => navigate(alphabetMastered === 0 ? "/alphabet" : `/alphabet/${currentLetter.code}`)}
                  className="w-full p-4 rounded-2xl bg-gradient-to-br from-card-cream via-muted to-muted border border-plum/25 flex items-center gap-3 transition-all hover:border-plum/50 hover:shadow-card active:scale-[0.99] text-left relative overflow-hidden"
                >
                  <div className="h-12 w-12 rounded-full bg-card-cream border-2 border-plum flex items-center justify-center shrink-0 shadow-soft">
                    <span
                      className="text-2xl text-plum"
                      style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
                    >
                      {currentLetter.isolated}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-plum">
                      {alphabetMastered === 0 ? "Start the Alphabet Journey" : "Continue Alphabet Journey"}
                    </p>
                    <p className="text-xs text-plum mt-0.5">
                      {alphabetMastered === 0
                        ? "Stop 1 of 28 — Alif"
                        : `Stop ${currentLetter.order_index + 1} of 28 — ${currentLetter.name_translit} • ${alphabetMastered} mastered`}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-plum shrink-0" />
                </button>
              )}
              <div className="flex gap-3">
                <XPDisplay compact className="flex-1" />
                <StreakDisplay compact />
              </div>
              <DailyLetterGoalRing />
              <WeeklyGoalCard />
            </div>
          ) : null,
        };

        return (
          <div className="space-y-3">
            {homeLayout.order.map((id) => {
              if (!isSectionVisible(id, homeLayout)) return null;
              const node = sections[id];
              if (!node) return null;
              return <div key={id}>{node}</div>;
            })}
          </div>
        );
      })()}

      {/* Explore — secondary browsing content, below the daily queue rather
          than competing with it for the first screen. */}
      <div className="mt-6 space-y-4">
        {isAuthenticated && <ContinueCard />}

        <button
          onClick={() => navigate("/bridge")}
          className={cn(
            "w-full px-4 py-3 rounded-2xl text-left",
            "bg-gradient-to-r from-plum/8 via-card to-plum/8",
            "border border-plum/25 hover:border-plum/50",
            "flex items-center gap-3 transition-all active:scale-[0.99]"
          )}
        >
          <div className="h-9 w-9 rounded-xl bg-plum/10 flex items-center justify-center shrink-0">
            <Globe2 className="h-4 w-4 text-plum" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-plum">Coming from MSA?</p>
            <p className="text-[11px] text-plum truncate">
              Bridge <span className="font-arabic" dir="rtl">الفصحى</span> into {activeDialect} dialect
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-plum/60 shrink-0" />
        </button>
      </div>

    </AppShell>
  );
};

export default Index;

