import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakDisplayProps {
  compact?: boolean;
  className?: string;
}

export function StreakDisplay({ compact = false, className }: StreakDisplayProps) {
  const { user } = useAuth();

  const { data: streak } = useQuery({
    queryKey: ["review-streak", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("review_streaks")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  if (!streak) return null;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1 px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30", className)}>
        <Flame className="h-3 w-3 text-orange-500" />
        <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
          {streak.current_streak} day{streak.current_streak !== 1 ? "s" : ""}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("bg-card rounded-xl p-4 border border-border", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center",
            streak.current_streak > 0 
              ? "bg-gradient-to-br from-orange-400 to-red-500" 
              : "bg-muted"
          )}>
            <Flame className={cn(
              "h-6 w-6",
              streak.current_streak > 0 ? "text-white" : "text-muted-foreground"
            )} />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{streak.current_streak}</p>
            <p className="text-sm text-muted-foreground">day streak</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Best</p>
          <p className="text-lg font-semibold text-foreground">{streak.longest_streak} days</p>
        </div>
      </div>
    </div>
  );
}
