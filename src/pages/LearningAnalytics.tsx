import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useLearningAnalytics } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  BookOpen,
  Brain,
  Target,
  Flame,
  Trophy,
  TrendingUp,
  Loader2,
  Zap,
  Star,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";

const StatCard = ({
  icon: Icon,
  label,
  value,
  sublabel,
  className,
}: {
  icon: any;
  label: string;
  value: string | number;
  sublabel?: string;
  className?: string;
}) => (
  <div className={cn("bg-card border border-border rounded-xl p-4 space-y-1", className)}>
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
  </div>
);

const STAGE_COLORS = [
  "hsl(var(--muted-foreground))",
  "hsl(210, 80%, 60%)",
  "hsl(190, 70%, 50%)",
  "hsl(160, 70%, 45%)",
  "hsl(130, 65%, 45%)",
  "hsl(80, 70%, 45%)",
];

const LearningAnalytics = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: analytics, isLoading } = useLearningAnalytics();

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center space-y-4">
          <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Sign in to see your learning analytics</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  if (isLoading || !analytics) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  const masteryPercent = analytics.totalWords > 0
    ? Math.round((analytics.masteredWords / analytics.totalWords) * 100)
    : 0;

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Learning Analytics</h1>
            <p className="text-sm text-muted-foreground">Your progress at a glance</p>
          </div>
        </div>

        {/* Key Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={BookOpen} label="Total Words" value={analytics.totalWords} />
          <StatCard icon={Star} label="Mastered" value={analytics.masteredWords} sublabel={`${masteryPercent}% of total`} />
          <StatCard icon={Target} label="Accuracy" value={`${analytics.accuracy}%`} sublabel={`${analytics.totalReviews} reviews`} />
          <StatCard icon={Zap} label="Total XP" value={analytics.totalXP.toLocaleString()} sublabel={`Level ${analytics.level}`} />
          <StatCard icon={Flame} label="Current Streak" value={analytics.currentStreak} sublabel={`Best: ${analytics.longestStreak}`} />
          <StatCard icon={Trophy} label="Challenges" value={analytics.challengesCompleted} sublabel="completed" />
        </div>

        {/* Mastery Progress */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Word Mastery
            </h2>
            <span className="text-sm text-primary font-medium">{masteryPercent}%</span>
          </div>
          <Progress value={masteryPercent} className="h-3" />

          {/* Stage breakdown bars */}
          <div className="space-y-2 pt-2">
            {analytics.stageBreakdown.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{stage.stage}</span>
                <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: analytics.totalWords > 0 ? `${(stage.count / analytics.totalWords) * 100}%` : "0%",
                      backgroundColor: STAGE_COLORS[i],
                      minWidth: stage.count > 0 ? "8px" : "0px",
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-foreground w-8 text-right">{stage.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Chart */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Daily Activity (14 days)
          </h2>

          {analytics.dailyActivity.some((d) => d.reviews > 0) ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.dailyActivity}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => {
                      const date = new Date(d);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <Tooltip
                    formatter={(value: number) => [`${value} reviews`, "Reviews"]}
                    labelFormatter={(label: string) =>
                      new Date(label).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <Bar dataKey="reviews" radius={[4, 4, 0, 0]}>
                    {analytics.dailyActivity.map((_, index) => (
                      <Cell key={index} fill="hsl(var(--primary))" opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">No activity yet — start reviewing!</p>
            </div>
          )}
        </div>

        {/* Insights */}
        <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-2xl p-4 space-y-2">
          <h2 className="font-semibold text-foreground">💡 Insights</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {analytics.totalWords === 0 && (
              <li>• Start learning to see your progress here!</li>
            )}
            {analytics.accuracy < 60 && analytics.totalReviews > 10 && (
              <li>• Your accuracy is below 60% — try reviewing at a slower pace</li>
            )}
            {analytics.accuracy >= 80 && analytics.totalReviews > 10 && (
              <li>• Great accuracy ({analytics.accuracy}%)! You're retaining well 💪</li>
            )}
            {analytics.currentStreak >= 7 && (
              <li>• Amazing {analytics.currentStreak}-day streak! Keep it up! 🔥</li>
            )}
            {analytics.currentStreak === 0 && analytics.longestStreak > 0 && (
              <li>• Your best streak was {analytics.longestStreak} days — start a new one today!</li>
            )}
            {analytics.masteredWords > 0 && (
              <li>• You've mastered {analytics.masteredWords} words — that's real progress! ⭐</li>
            )}
            {analytics.learningWords > analytics.masteredWords && analytics.totalWords > 5 && (
              <li>• {analytics.learningWords} words in progress — keep reviewing daily</li>
            )}
          </ul>
        </div>
      </div>
    </AppShell>
  );
};

export default LearningAnalytics;
