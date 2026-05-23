import { ChevronRight, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";

interface TaskRowProps {
  title: string;
  subtitle?: string;
  countBadge?: string;
  estMinutes: number;
  icon: LucideIcon;
  done: boolean;
  onClick: () => void;
  hint?: { title: string; body: string };
}

export const TaskRow = ({ title, subtitle, countBadge, estMinutes, icon: Icon, done, onClick, hint }: TaskRowProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left",
        "bg-card hover:shadow-md active:scale-[0.99]",
        done
          ? "border-muted opacity-60"
          : "border-primary/20 hover:border-primary/40"
      )}
    >
      <div
        className={cn(
          "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
          done ? "bg-muted" : "bg-primary/10"
        )}
      >
        {done ? (
          <Check className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Icon className="h-5 w-5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("font-semibold text-foreground", done && "line-through")}>{title}</span>
          {countBadge && !done && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold">
              {countBadge}
            </span>
          )}
          {hint && <InfoHint title={hint.title} body={hint.body} />}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {subtitle} · ~{estMinutes} min
          </div>
        )}
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </button>
  );
};
