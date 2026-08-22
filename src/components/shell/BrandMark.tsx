import { cn } from "@/lib/utils";
import { SaduMark } from "@/components/brand/SaduMark";

/**
 * The Hakiya mark, back in the top-left corner where it belongs.
 *
 * It briefly shared that corner with the avatar and lost. A corner can only
 * say one thing, so the two were separated: the mark keeps the corner, and
 * your face moved to the right — the feed's action rail, the far end of a
 * page header.
 *
 * The mark wears its Sadu frame here, in the `clear` variant. The plate is
 * already a light ground, so the sand-filled frame would be a ground sitting
 * on a ground; the open one takes the plate as its floor and contributes only
 * the woven band. Square rather than height-with-free-width, and still 32px,
 * because the plate's job of settling this lockup at 40px to match the emblem
 * opposite it is worth more than the few pixels the frame costs the mark.
 *
 * It rides a quiet plate rather than sitting on the page. The mark has a
 * transparent ground and an open silhouette — a speech bubble with a weave
 * inside it — so on the chooser and a skill it landed directly on the sadu
 * border the page draws across its own top edge, and pattern showed through
 * pattern. The plate is the same idiom the feed already uses for its chrome,
 * and the token background means one rule covers both: near-black under the
 * video, near-sand on the pages. It also settles the height at 40px, matching
 * the emblem opposite it.
 *
 * And it says the name. The weave inside the bubble is fine enough that at
 * 32px it resolves to grey noise — the artwork is doing detail the size cannot
 * spend — so the mark alone read as a smudge no matter which file it came
 * from. Set beside it, the wordmark is what carries recognition at this size,
 * and the mark is what makes the wordmark look like a brand rather than a
 * heading. The pair is announced once, as a single image named Hakiya.
 *
 * Not a link. Home is two taps away in the dock and one swipe away on the
 * feed, and a second control pointing at the same place is the mistake the
 * page corner was rebuilt to stop making.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Hakiya"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1",
        "bg-background/85 ring-1 ring-border/60 backdrop-blur",
        className,
      )}
    >
      <SaduMark variant="clear" className="h-8 w-8 select-none" />
      <span
        aria-hidden
        className="font-heading text-[15px] font-bold leading-none tracking-tight text-foreground"
      >
        Hakiya
      </span>
    </span>
  );
}
