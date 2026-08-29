import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Plays the Lahja arrival move when a section scrolls into view.
 *
 * The motion language (tailwind.config.ts) defines `fade-up` as the arrival of
 * content and pins it to one easing curve, and the app uses it everywhere —
 * except on the landing page, the one screen a stranger judges the product by,
 * where every section was simply *there* from the first frame. This is the
 * missing half: the same 360ms `fade-up`, fired by an IntersectionObserver
 * instead of by mount.
 *
 * Three things it deliberately does not do:
 *
 * - **It never hides content it cannot un-hide.** The pre-reveal state is
 *   `opacity-0`, and everything below decides to skip straight to visible
 *   rather than to stay hidden. A reveal that fails closed turns a marketing
 *   page into a blank sheet, which is a far worse bug than a missing
 *   animation.
 * - **It does not re-fire.** `unobserve` on first intersection: content that
 *   fades again every time you scroll past reads as a glitch, not as polish.
 * - **It respects reduced motion**, matching the global rule in index.css.
 *   Under `prefers-reduced-motion` the content is visible immediately with no
 *   transition at all.
 *
 * Note for tests: `src/test/setup.ts` stubs a MockObserver that never fires,
 * so under Vitest a Reveal stays at `data-revealed="false"` and `opacity-0`.
 * Its children are still mounted and still queryable — the wrapper is
 * transparent, never absent — which is exactly the property the test file
 * pins.
 */

export interface RevealProps {
  children: ReactNode;
  /**
   * Stagger within a group, in milliseconds. Kept small — past about 150ms
   * between siblings the row stops reading as one gesture and starts reading
   * as items loading one at a time.
   */
  delayMs?: number;
  className?: string;
}

export function Reveal({ children, delayMs = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No observer (jsdom, older browsers) or no appetite for motion: show it
    // and stop. Failing open is the whole safety property here.
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const el = ref.current;
    if (!el) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          observer.unobserve(entry.target);
        }
      },
      // A negative bottom margin means a section has to be genuinely on screen
      // rather than one pixel past the fold, so the move is seen rather than
      // finished before it is scrolled to.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-revealed={shown ? "true" : "false"}
      className={cn(
        "transition-[opacity,transform] duration-500 ease-lahja motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
