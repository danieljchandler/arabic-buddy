import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HubTile {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  to: string;
  /** Optional accent class on the icon bubble, e.g. "bg-amber-500/10 text-amber-600". */
  accent?: string;
  /** Render only if true. Use to hide entitlement-gated tiles. */
  show?: boolean;
  badge?: ReactNode;
}

interface HubSectionProps {
  title: string;
  subtitle?: string;
  tiles: HubTile[];
}

export function HubSection({ title, subtitle, tiles }: HubSectionProps) {
  const navigate = useNavigate();
  const visible = tiles.filter((t) => t.show !== false);
  if (visible.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="px-1 mb-2">
        <h2
          className="text-xs font-semibold text-[#5C3A46]/70 uppercase tracking-wider"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          {title}
        </h2>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2">
        {visible.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => navigate(t.to)}
              className={cn(
                "w-full p-4 rounded-xl bg-card border border-border",
                "flex items-center gap-3 text-left",
                "transition-all duration-200 hover:border-primary/30 active:scale-[0.99]",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  t.accent ?? "bg-primary/10 text-primary",
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm flex items-center gap-2">
                  {t.label}
                  {t.badge}
                </p>
                {t.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface HubHeaderProps {
  title: string;
  subtitle?: string;
}

export function HubHeader({ title, subtitle }: HubHeaderProps) {
  return (
    <header className="mb-5">
      <h1
        className="text-2xl font-bold text-foreground"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        {title}
      </h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </header>
  );
}
