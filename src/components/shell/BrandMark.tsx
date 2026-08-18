import { useState } from "react";
import { cn } from "@/lib/utils";
import hakiyaIconAsset from "@/assets/hakiya-icon.png.asset.json";

/**
 * The Hakiya mark, beside the profile emblem in a page's top row.
 *
 * The mark used to *be* the emblem, which was a nice trick until avatars
 * arrived: the corner can only say one thing, and once you have chosen a
 * picture that thing should be you. So the brand moves one slot right, into
 * the same top-left region it already owned, at the size it already read at —
 * the corner now says "you, in Hakiya" rather than "Hakiya" alone.
 *
 * The three top-level surfaces carry it: the feed (which is home), the chooser
 * and a skill. Interior pages do not, and should not — a logo repeated on
 * every screen of an app you have already opened is decoration, and those
 * pages need their top row for the control that gets you back out.
 *
 * It is the icon rather than the wordmark on purpose. This same mark sat in
 * the emblem over the feed's black video and over the sand-coloured pages
 * everywhere else, so it is already known to read on both; the wordmark has
 * only ever been used on light backgrounds.
 *
 * Not a link. Home is two taps away in the dock and one swipe away on the
 * feed, and a second control pointing at the same place is the mistake the
 * page corner was rebuilt to stop making.
 */
export function BrandMark({ className }: { className?: string }) {
  /**
   * If the artwork does not arrive, say the name in type rather than leave a
   * broken-image glyph where the brand is supposed to be. Chromium renders alt
   * text *outside* the element's box when an image fails, so it cannot simply
   * be clipped — it wraps into whatever the header holds next to it. The mark
   * is served from the asset host rather than from `public/`, which is one
   * more hop than the rest of the page needs, so this is worth handling.
   */
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      // Same role and name as the artwork it stands in for, so whether the
      // brand is on the page is one question with one answer — for a screen
      // reader and for a test alike.
      <span
        role="img"
        aria-label="Hakiya"
        className={cn("shrink-0 font-heading text-base font-bold text-foreground", className)}
      >
        Hakiya
      </span>
    );
  }

  return (
    <img
      src={hakiyaIconAsset.url}
      alt="Hakiya"
      onError={() => setFailed(true)}
      className={cn("h-8 w-8 shrink-0 object-contain", className)}
      draggable={false}
    />
  );
}
