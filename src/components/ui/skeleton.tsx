import { cn } from "@/lib/utils";

/**
 * A placeholder for content that has not arrived.
 *
 * Two things separate this from the stock shadcn skeleton it replaces. It is
 * warm — `bg-muted` is the palette's pale sand rather than a neutral grey, so
 * a loading screen still looks like this app. And it shimmers rather than
 * pulses: `animate-pulse` fades the whole block in and out, which at a column
 * of six placeholders reads as six things blinking out of step, while one
 * light sweeping left-to-right across all of them reads as a single surface
 * with something on its way.
 *
 * The sweep is a child element rather than a background-position animation so
 * it composites on the GPU, and it is skipped entirely under
 * `prefers-reduced-motion` — a loading state is exactly the kind of
 * indefinite, repeating motion that setting exists to stop.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // A stable hook for "a placeholder is on screen". Tests used to assert
      // on `.animate-pulse`, which tied them to the styling rather than the
      // state and broke the moment the pulse became a sweep.
      data-slot="skeleton"
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -translate-x-full motion-safe:animate-shimmer",
          "bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent",
        )}
      />
    </div>
  );
}

export { Skeleton };
