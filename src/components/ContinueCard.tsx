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
import { useDialect } from "@/contexts/DialectContext";
import { useResumableLesson } from "@/hooks/useLessonProgress";

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
  const { activeDialect } = useDialect();
  const [entry, setEntry] = useState<ContinueEntry | null>(() => getContinue());
  const { data: resumable } = useResumableLesson(activeDialect);
  // Dismissing clears localStorage, but the server row survives by design — the
  // learner really is mid-lesson. Without this the card would reappear
  // instantly and the dismiss button would look broken.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const refresh = () => setEntry(getContinue());
    window.addEventListener("hakiya:continue-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("hakiya:continue-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // localStorage is the fast path — it's instant on load and works signed-out —
  // but it holds one entry with a 7-day TTL and doesn't cross devices. Fall back
  // to the server-side lesson progress so resuming survives a new device or a
  // cleared cache.
  const localEntry =
    entry && (!entry.dialect || entry.dialect === activeDialect) ? entry : null;
  const resolved: ContinueEntry | null = dismissed ? null : localEntry ?? (resumable
    ? {
        kind: "lesson",
        route: `/learn/${resumable.lessonId}`,
        title: resumable.title,
        subtitle: resumable.wordsTotal
          ? `Word ${Math.min(resumable.lastWordIndex + 1, resumable.wordsTotal)} of ${resumable.wordsTotal}`
          : undefined,
        dialect: activeDialect,
        updatedAt: new Date(resumable.updatedAt).getTime(),
      }
    : null);

  if (!resolved) return null;

  const { icon: Icon, label } = KIND_META[resolved.kind];

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
        onClick={() => navigate(resolved.route)}
        aria-label={`Continue ${label}: ${resolved.title}`}
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
              · {formatRelativeTime(resolved.updatedAt)}
            </span>
          </div>
          <p className="font-semibold text-foreground text-sm truncate">
            {resolved.title}
          </p>
          {resolved.subtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {resolved.subtitle}
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
          setDismissed(true);
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
