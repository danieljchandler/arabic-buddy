import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One group of settings, and the entry the side index makes for it.
 *
 * Settings owns fifteen sections and no grouping at all, which made it a
 * 4,500px column where "where do I change my dialect" could only be answered
 * by scrolling past everything else. The grouping is the fix, and it has to be
 * described in one place: the index down the side and the headings in the
 * page are the same list, so a group added to one and forgotten in the other
 * cannot happen.
 */
export interface SettingsGroupMeta {
  /** Also the anchor the index links to, so it lands in the URL — keep it short. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** One line on what lives here, so the index isn't the only orientation. */
  blurb: string;
}

interface SettingsGroupProps {
  group: SettingsGroupMeta;
  children: ReactNode;
  className?: string;
}

/**
 * A labelled landmark rather than a `<section>`.
 *
 * `<section>` on this page already means "one setting" — Appearance, Privacy,
 * Review Preferences each are one — and both the tests and anyone reading the
 * markup scope to that. Nesting groups as sections too would make
 * `section` ambiguous exactly where precision is cheap: a `role="region"` with
 * an accessible name is the same landmark to a screen reader without taking
 * over a tag that is already doing a job.
 */
export function SettingsGroup({ group, children, className }: SettingsGroupProps) {
  const { id, label, icon: Icon, blurb } = group;

  return (
    <div
      id={id}
      role="region"
      aria-labelledby={`${id}-heading`}
      // The sadu band is a fixed backdrop, not a header in flow, so an anchor
      // jump that stops at the element's true top parks the heading underneath
      // the pattern. Same offset the sticky index uses.
      style={{ scrollMarginTop: "calc(var(--sadu-band-height) + 1.5rem)" }}
      className={cn("space-y-5", className)}
    >
      <div className="border-b border-border/60 pb-3">
        <h2
          id={`${id}-heading`}
          className="flex items-center gap-2 font-heading text-lg font-bold text-foreground"
        >
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          {label}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{blurb}</p>
      </div>

      <div className="space-y-8">{children}</div>
    </div>
  );
}

/**
 * One setting, under the small uppercase caption this page has always used.
 *
 * Extracted because the same six lines of caption markup were repeated fifteen
 * times across the page and two components, and a group heading now sits above
 * them: with the captions inlined there was nothing stopping the two levels
 * from converging on the same weight, which is how a grouping stops reading as
 * one. The rendered result is byte-for-byte what each section had.
 */
export function SettingSection({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Optional control aligned with the caption — currently only Home Layout's Reset. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
