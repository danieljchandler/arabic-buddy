import { cn } from "@/lib/utils";
import hakiyaMark from "@/assets/hakiya-mark.png";

/**
 * The Hakiya mark, back in the top-left corner where it belongs.
 *
 * It briefly shared that corner with the avatar and lost. A corner can only
 * say one thing, so the two were separated: the mark keeps the corner, and
 * your face moved to the right — the feed's action rail, the far end of a
 * page header.
 *
 * Two things were wrong with how it used to look, and both were in the file
 * rather than the CSS. `hakiya-icon.png` is a 712 kB render whose artwork
 * floats inside a much larger canvas, so `object-contain` in a 40px box drew
 * the mark at roughly half that — small, soft, and sitting high in its own
 * space. This uses the mark from `favicon.png` instead, trimmed to its own
 * ink: the same artwork the browser tab and the installed app icon already
 * show, 7 kB, filling the height it is given. Bundled rather than fetched from
 * the asset host, so it arrives with the page instead of one hop later.
 *
 * Sized by height with a free width, because the mark is wider than it is
 * tall and a square box would have shrunk it again to fit.
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
      <img src={hakiyaMark} alt="" aria-hidden className="h-8 w-auto select-none" draggable={false} />
      <span
        aria-hidden
        className="font-heading text-[15px] font-bold leading-none tracking-tight text-foreground"
      >
        Hakiya
      </span>
    </span>
  );
}
