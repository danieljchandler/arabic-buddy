import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import hakiyaLockup from "@/assets/hakiya-lockup.webp";
import { useIsInk } from "@/hooks/useBrandPreview";
import { HikayaInkMark } from "@/components/brand/HikayaInkMark";
import inkAppIcon from "@/assets/brand/hikaya-sadu-harakat-icon.svg";

/**
 * The Hikaya mark, back in the top-left corner where it belongs.
 *
 * It briefly shared that corner with the avatar and lost. A corner can only
 * say one thing, so the two were separated: the mark keeps the corner, and
 * your face moved to the right — the feed's action rail, the far end of a
 * page header.
 *
 * It is the supplied lockup now, and that file already contains everything
 * this component used to assemble: the mark, the Arabic, the English, and a
 * plate of its own. So the CSS plate went, and so did the wordmark set beside
 * it — both existed only because the artwork had neither.
 *
 * 48px rather than the 40 the old lockup settled on. The artwork is square and
 * carries three things instead of one, and below about this size the English
 * inside it stops resolving. It is the smallest size at which this file is
 * still the logo rather than a smudge of it.
 *
 * The plate it used to ride is gone with the rest. That plate existed because
 * the mark had a transparent ground and an open silhouette, so on the chooser
 * it landed directly on the sadu border the page draws across its top edge and
 * pattern showed through pattern. The lockup has an opaque plate of its own, so
 * the CSS one is now a second ground behind a first.
 *
 * Not a link. Home is two taps away in the dock and one swipe away on the
 * feed, and a second control pointing at the same place is the mistake the
 * page corner was rebuilt to stop making.
 *
 * Under Ink (the default brand) the corner draws the redrawn Ink mark
 * instead. The feed ("/") keeps its layout exactly — a square tile in the
 * corner over the clip — so there the tile is the Ink app icon at the same
 * 48px footprint rather than the wide mark, which would crowd the dialect
 * control. Same accessible name either way.
 */
export function BrandMark({ className }: { className?: string }) {
  const ink = useIsInk();
  const onFeed = useLocation().pathname === "/";
  if (ink && onFeed) {
    return (
      <img
        src={inkAppIcon}
        alt="Hikaya"
        className={cn("h-12 w-12 shrink-0 select-none", className)}
        draggable={false}
      />
    );
  }
  if (ink) {
    // 48px tall, the raster's height: the corner keeps its footprint.
    return <HikayaInkMark size={48} className={className} />;
  }
  return (
    <img
      src={hakiyaLockup}
      alt="Hikaya"
      className={cn("h-12 w-12 shrink-0 select-none", className)}
      draggable={false}
    />
  );
}
