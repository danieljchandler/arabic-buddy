import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Play, GraduationCap, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContinueEntry,
  clearContinue,
  formatRelativeTime,
  getContinue,
} from "@/lib/continueProgress";

const KIND_META: Record<
  ContinueEntry["kind"],
  { icon: typeof BookOpen; label: string }
> = {
  story: { icon: BookOpen, label: "Story" },
  video: { icon: Play, label: "Video" },
  lesson: { icon: GraduationCap, label: "Lesson" },
};

export const ContinueCard = () => {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<ContinueEntry | null>(() => getContinue());

  useEffect(() => {
    const refresh = () => setEntry(getContinue());
    window.addEventListener("lahja:continue-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("lahja:continue-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!entry) return null;

  const { icon: Icon, label } = KIND_META[entry.kind];

  return (
    <div
      className={cn(
        "w-full mb-4 rounded-2xl",
        "bg-gradient-to-r from-primary/10 via-card to-primary/5",
        "border-2 border-primary/25",
        "flex items-stretch overflow-hidden",
        "transition-all hover:border-primary/50 hover:shadow-md"
      )}
    >
      <button
        onClick={() => navigate(entry.route)}
        className="flex-1 min-w-0 flex items-center gap-3 p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
              Continue {label.toLowerCase()}
            </span>
            <span className="text-[10px] text-muted-foreground">
              · {formatRelativeTime(entry.updatedAt)}
            </span>
          </div>
          <p className="font-semibold text-foreground text-sm truncate">
            {entry.title}
          </p>
          {entry.subtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {entry.subtitle}
            </p>
          )}
        </div>
        <ChevronRight className="h-5 w-5 text-primary shrink-0" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          clearContinue();
          setEntry(null);
        }}
        className="px-2 text-muted-foreground/60 hover:text-foreground transition-colors"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
