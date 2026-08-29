import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SettingsGroupMeta } from "@/components/settings/SettingsGroup";

interface SettingsGroupNavProps {
  groups: SettingsGroupMeta[];
  className?: string;
}

/**
 * The index of the Settings page — a sticky rail from lg, a strip of chips
 * below it.
 *
 * Two presentations rather than one, because the constraint differs by width.
 * On a phone the page has to stay a single column, so the index can only be
 * something you scroll past once; at desktop widths the column occupies about
 * a third of the screen and the rest was empty, which is the space the rail
 * costs nothing to live in and where it earns its keep — it stays on screen
 * for the whole 4,000px of scroll.
 *
 * Both are plain anchors. Scrolling to a heading rather than swapping panels
 * keeps every setting present in the document at once: you can still find
 * something by scrolling if you don't know which group it landed in, ⌘F still
 * works, and nothing depends on JavaScript having run.
 */
export function SettingsGroupNav({ groups, className }: SettingsGroupNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    // Some environments (jsdom, an old browser) have no observer. The rail is
    // still a working index without one — it just doesn't highlight — so this
    // returns rather than throwing on mount.
    if (typeof IntersectionObserver === "undefined") return;

    // Which groups are currently inside the reading band. Local to the
    // observer rather than React state: it changes on every scroll and only
    // the winner it implies is worth a render.
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // The topmost group still in the band wins. Taking the first *entry*
        // instead would make the highlight depend on callback order, which
        // jumps around when several groups cross the band in one scroll.
        const first = groups.find((g) => visible.has(g.id));
        // No group in the band (mid-scroll through a tall one) leaves the last
        // answer standing rather than blanking the rail.
        if (first) setActiveId(first.id);
      },
      {
        // A band across the upper third of the viewport, not the whole of it:
        // with the full viewport as root, four short groups can all intersect
        // at once and the highlight sticks to whichever is first in the DOM
        // no matter where the learner actually is.
        rootMargin: "-15% 0px -70% 0px",
      },
    );

    for (const group of groups) {
      const el = document.getElementById(group.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [groups]);

  return (
    <nav
      aria-label="Settings sections"
      // Sticks below the sadu band, which is a fixed backdrop: at `top-0` the
      // rail would scroll up under the pattern rather than stopping short of it.
      style={{ top: "calc(var(--sadu-band-height) + 1.5rem)" }}
      className={cn("lg:sticky lg:self-start", className)}
    >
      {/* Phone and tablet: one horizontal run, scrollable rather than wrapped,
          so it stays a single line above the first group instead of becoming a
          block of its own to scroll past. */}
      <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group) => (
          <li key={group.id} className="snap-start">
            <a
              href={`#${group.id}`}
              aria-current={activeId === group.id ? "true" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                activeId === group.id
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <group.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {group.label}
            </a>
          </li>
        ))}
      </ul>

      {/* Desktop: the same list down the left, holding its place while the
          content scrolls beside it. */}
      <ul className="hidden lg:block lg:space-y-1">
        {groups.map((group) => (
          <li key={group.id}>
            <a
              href={`#${group.id}`}
              aria-current={activeId === group.id ? "true" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border-l-2 py-2 pl-3 pr-2 text-sm transition-colors",
                activeId === group.id
                  ? "border-l-primary bg-primary/10 font-semibold text-foreground"
                  : "border-l-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <group.icon className="h-4 w-4 shrink-0" aria-hidden />
              {group.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
