import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  BRAND_DIRECTIONS,
  getBrandPreview,
  setBrandPreview,
  subscribeBrandPreview,
  type BrandPreviewState,
} from "@/lib/brandPreview";
import { cn } from "@/lib/utils";

/**
 * The floating control for the opt-in brand preview (src/lib/brandPreview.ts).
 *
 * It renders nothing unless a preview is active, which only a `?brand=` link
 * can start — so for every learner who has not opted in, this component is a
 * null in the tree and nothing else.
 *
 * Placement: a small pill centred above the dock below `lg`, where the two
 * corners already belong to the feedback button (left) and the Ask AI disc
 * (right), both at bottom-20; and bottom-left from `lg`, past the feedback
 * button that sits beside the rail there. The dock is about 59px tall
 * (py-2.5 + icon + 10px label) plus the safe-area inset, hence 4.25rem.
 *
 * Built on tokens, so it re-skins with whichever direction it is showing.
 */

const OPTIONS: { id: BrandPreviewState; label: string; ariaLabel: string; title: string }[] = [
  {
    id: "current",
    label: "Current",
    ariaLabel: "Preview the previous look",
    title: "The previous watercolour look",
  },
  ...BRAND_DIRECTIONS.map((d) => ({
    id: d.id,
    label: d.label,
    ariaLabel: `Preview the ${d.label} direction`,
    title: d.summary,
  })),
];

export function BrandPreviewSwitcher() {
  const active = useSyncExternalStore(subscribeBrandPreview, getBrandPreview, () => null);
  if (active === null) return null;

  return (
    <div
      role="group"
      aria-label="Brand preview"
      data-feedback-ignore="true"
      className={cn(
        "fixed z-[46] flex items-center gap-0.5 rounded-full border border-border p-1",
        "bg-card text-card-foreground shadow-elegant",
        "left-1/2 -translate-x-1/2 bottom-[calc(4.25rem_+_env(safe-area-inset-bottom))]",
        "lg:left-40 lg:translate-x-0 lg:bottom-6",
      )}
    >
      {OPTIONS.map((option) => {
        const pressed = active === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={pressed}
            aria-label={option.ariaLabel}
            title={option.title}
            onClick={() => setBrandPreview(option.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none transition-colors",
              pressed
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Turn off brand preview"
        title="Turn off brand preview"
        onClick={() => setBrandPreview(null)}
        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
