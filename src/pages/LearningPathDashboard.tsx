import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { useLearningPath, useWeeklyRecommendation, useRequestCoaching, useAdvanceWeek } from "@/hooks/useLearningPath";
import { Loader2, Sparkles, CheckCircle2, ChevronRight, Brain, BookOpen, Headphones, Mic, RotateCcw, Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const ACTIVITY_ICONS: Record<string, any> = {
  vocab: BookOpen,
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  review: RotateCcw,
};

export default function LearningPathDashboard() {
  const navigate = useNavigate();
  const { data: path, isLoading } = useLearningPath();
  const { data: recommendation } = useWeeklyRecommendation(path?.id);
  const coaching = useRequestCoaching();
  const advanceWeek = useAdvanceWeek();

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!path) {
    return (
      <AppShell>
        <HomeButton />
        <div className="text-center py-16 space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">No Learning Path Yet</h1>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Let AI create a personalized Gulf Arabic curriculum tailored to your goals.
          </p>
          <Button onClick={() => navigate("/my-path/setup")} size="lg">
            <Sparkles className="h-4 w-4 mr-2" /> Create My Path
          </Button>
        </div>
      </AppShell>
    );
  }

  const curriculum = path.curriculum?.curriculum || path.curriculum || [];
  const overview = path.curriculum?.overview;
  const currentWeekData = Array.isArray(curriculum) ? curriculum.find((w: any) => w.week === path.current_week) : null;
  const progressPercent = Math.round((path.current_week / path.timeline_weeks) * 100);

  return (
    <AppShell>
      <HomeButton />

      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-foreground">My Learning Path</h1>
            <Badge variant="secondary">Week {path.current_week}/{path.timeline_weeks}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{path.goal_description}</p>
          <Progress value={progressPercent} className="h-2" />
          {overview?.final_outcome && (
            <p className="text-xs text-muted-foreground">🎯 {overview.final_outcome}</p>
          )}
        </div>

        {/* Weekly Coach Card */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" /> AI Coach
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => coaching.mutate(path.id)}
              disabled={coaching.isPending}
            >
              {coaching.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Get Advice"}
            </Button>
          </div>

          {recommendation ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">{recommendation.motivation_message}</p>
              {recommendation.motivation_message_arabic && (
                <p className="text-sm text-muted-foreground" dir="rtl">{recommendation.motivation_message_arabic}</p>
              )}

              {/* Difficulty adjustment indicator */}
              {recommendation.difficulty_adjustment && recommendation.difficulty_adjustment !== "maintain" && (
                <div className="flex items-center gap-2 text-xs">
                  {recommendation.difficulty_adjustment === "increase" ? (
                    <><TrendingUp className="h-3.5 w-3.5 text-green-600" /><span className="text-green-600">Difficulty increasing — you're crushing it!</span></>
                  ) : (
                    <><TrendingDown className="h-3.5 w-3.5 text-amber-600" /><span className="text-amber-600">Slowing down to reinforce foundations</span></>
                  )}
                </div>
              )}

              {/* Focus areas */}
              {Array.isArray(recommendation.focus_areas) && recommendation.focus_areas.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(recommendation.focus_areas as string[]).map((area, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{area}</Badge>
                  ))}
                </div>
              )}

              {/* Suggested activities */}
              {Array.isArray(recommendation.suggested_content) && (recommendation.suggested_content as any[]).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Suggested This Week</p>
                  {(recommendation.suggested_content as any[]).map((item: any, i: number) => {
                    const Icon = ACTIVITY_ICONS[item.type] || Target;
                    return (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-background/50">
                        <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.reason}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Tap "Get Advice" for personalized weekly recommendations.</p>
          )}
        </div>

        {/* Current Week */}
        {currentWeekData && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">
                Week {currentWeekData.week}: {currentWeekData.theme}
              </h2>
            </div>
            {currentWeekData.theme_arabic && (
              <p className="text-sm text-muted-foreground" dir="rtl">{currentWeekData.theme_arabic}</p>
            )}
            {currentWeekData.milestone && (
              <p className="text-xs text-primary flex items-center gap-1">
                <Target className="h-3.5 w-3.5" /> {currentWeekData.milestone}
              </p>
            )}

            {/* Daily activities */}
            {Array.isArray(currentWeekData.activities) && (
              <div className="space-y-2">
                {currentWeekData.activities.map((act: any, i: number) => {
                  const Icon = ACTIVITY_ICONS[act.type] || Target;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border",
                        "bg-card border-border",
                        "transition-all hover:border-primary/30"
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{act.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">Day {act.day} • {act.type}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Advance week */}
            <Button
              onClick={() => advanceWeek.mutate(path.id)}
              disabled={advanceWeek.isPending}
              variant="outline"
              className="w-full"
            >
              {advanceWeek.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Complete Week {path.current_week}
            </Button>
          </div>
        )}

        {/* Curriculum overview */}
        {Array.isArray(curriculum) && curriculum.length > 0 && (
          <div className="space-y-2">
            <h2 className="font-semibold text-foreground text-sm">Full Curriculum</h2>
            <div className="space-y-1.5">
              {curriculum.map((week: any) => (
                <div
                  key={week.week}
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg text-sm",
                    week.week === path.current_week
                      ? "bg-primary/10 border border-primary/20 font-medium"
                      : week.week < path.current_week
                        ? "bg-muted/50 text-muted-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                    week.week < path.current_week
                      ? "bg-primary text-primary-foreground"
                      : week.week === path.current_week
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                  )}>
                    {week.week < path.current_week ? "✓" : week.week}
                  </div>
                  <span className="flex-1">{week.theme}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reset path */}
        <div className="text-center pt-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/my-path/setup")} className="text-muted-foreground">
            Create a new path
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
